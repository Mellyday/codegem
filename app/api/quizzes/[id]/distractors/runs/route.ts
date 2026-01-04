export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, generateId, toDbDate, toJson, fromJson } from "@/src/lib/sqlite";
import {
  generateDistractorsInBatches,
  LLM_DISTRACTOR_BATCH_SIZE,
  type DistractorProvider,
} from "@/src/lib/llmDistractorProvider";
import {
  registerRunController,
  clearRunController,
} from "@/src/lib/distractorRunRegistry";

type SourceRef = {
  preview?: string;
};

type QuizCard = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  question?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  sourceRef?: SourceRef;
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  llmDistractors?: string[];
  distractorPoolSize?: number;
};

type QuizDoc = {
  id: string;
  user_id: string;
  cards: QuizCard[];
};

type RunDoc = {
  id: string;
  user_id: string;
  quiz_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  updated_cards: number[];
  failures: Array<{ order: number; error: string }>;
  skipped: number;
  provider: string;
  model: string;
  batch_size: number;
  missing_only: boolean;
  error_message?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
};

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const serializeRun = (run: RunDoc) => ({
  runId: run.id,
  quizId: run.quiz_id,
  status: run.status,
  total: toNumber(run.total),
  completed: toNumber(run.completed),
  failed: toNumber(run.failed),
  updatedCards: run.updated_cards,
  failures: run.failures,
  skipped: toNumber(run.skipped),
  provider: run.provider,
  model: run.model,
  batchSize: toNumber(run.batch_size),
  errorMessage: run.error_message,
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const routeParams = await params.catch(() => ({} as { id?: string }));
  const rawId =
    routeParams?.id || body?.id || body?.quizId || url.searchParams.get("id");
  if (!rawId) {
    return NextResponse.json({ error: "Missing quiz id" }, { status: 400 });
  }
  const quizId = String(rawId);

  const db = getDb();
  const row = db.prepare(`
    SELECT id, user_id, cards FROM quizzes WHERE id = ? AND user_id = ?
  `).get(quizId, userId) as { id: string; user_id: string; cards: string } | undefined;

  if (!row) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  const quiz: QuizDoc = {
    id: row.id,
    user_id: row.user_id,
    cards: fromJson<QuizCard[]>(row.cards) || [],
  };

  const provider = (body?.provider ||
    process.env.LLM_DISTRACTOR_PROVIDER ||
    "deepseek") as DistractorProvider;
  const model = body?.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const fullCode =
    typeof body?.fullCode === "string" && body.fullCode.trim()
      ? body.fullCode
      : undefined;
  const missingOnly = Boolean(body?.missingOnly);

  const updatedCards: number[] = [];
  const failures: Array<{ order: number; error: string }> = [];
  let changed = false;

  const generationQueue: Array<{
    order: number;
    index: number;
    correctAnswers: string[];
    targetCount: number;
    questionType?: QuizCard["questionType"];
    preview?: string;
    question?: string;
    snippet?: string;
    existingDistractors?: string[];
    stableKey: string;
  }> = [];

  let skippedCount = 0;

  for (let i = 0; i < (quiz.cards || []).length; i++) {
    const card = quiz.cards[i] as QuizCard;
    const isMulti =
      card.questionType === "multi" || card.questionType === "orderedMulti";
    const correctAnswers =
      isMulti
        ? (Array.isArray(card.multiCorrect)
          ? card.multiCorrect.map((c) => String(c ?? "")).filter(Boolean)
          : [])
        : [String(card.text ?? "")].filter(Boolean);
    const targetCount = card.distractorPoolSize
      ? card.distractorPoolSize
      : (isMulti ? 10 : 6);

    if (!correctAnswers.length) {
      failures.push({
        order: card.order ?? i,
        error: "Missing correct answer for card",
      });
      continue;
    }

    if (missingOnly) {
      const hasDistractors =
        Array.isArray(card.llmDistractors) &&
        card.llmDistractors.length >= targetCount;
      if (hasDistractors) {
        skippedCount++;
        continue;
      }
    }

    generationQueue.push({
      order: card.order ?? i,
      index: i,
      correctAnswers,
      targetCount,
      questionType: card.questionType,
      preview: card.sourceRef?.preview,
      question: card.question,
      snippet: String(card.text ?? ""),
      existingDistractors: Array.isArray(card.llmDistractors)
        ? card.llmDistractors
        : undefined,
      stableKey: `${quizId}:${card.order ?? i}`,
    });
  }

  const precheckFailures = failures.length;
  const totalToGenerate = generationQueue.length;
  const totalCards = totalToGenerate + precheckFailures;
  const now = toDbDate(new Date());
  const initialStatus: RunDoc["status"] =
    totalToGenerate > 0
      ? "queued"
      : precheckFailures > 0
        ? "failed"
        : "completed";

  const runId = generateId();
  const runDoc: RunDoc = {
    id: runId,
    user_id: userId,
    quiz_id: quizId,
    status: initialStatus,
    total: totalCards,
    completed: precheckFailures,
    failed: precheckFailures,
    updated_cards: [],
    failures,
    skipped: skippedCount,
    provider,
    model,
    batch_size: LLM_DISTRACTOR_BATCH_SIZE,
    missing_only: missingOnly,
    ...(initialStatus === "failed" ? { error_message: failures[0]?.error } : {}),
    created_at: now,
    updated_at: now,
    ...(totalToGenerate ? {} : { completed_at: now }),
  };

  db.prepare(`
    INSERT INTO distractor_runs (
      id, user_id, quiz_id, status, total, completed, failed,
      updated_cards, failures, skipped, provider, model, batch_size,
      missing_only, error_message, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runDoc.id,
    runDoc.user_id,
    runDoc.quiz_id,
    runDoc.status,
    runDoc.total,
    runDoc.completed,
    runDoc.failed,
    toJson(runDoc.updated_cards),
    toJson(runDoc.failures),
    runDoc.skipped,
    runDoc.provider,
    runDoc.model,
    runDoc.batch_size,
    runDoc.missing_only ? 1 : 0,
    runDoc.error_message || null,
    runDoc.created_at,
    runDoc.updated_at,
    runDoc.completed_at || null
  );

  if (totalToGenerate) {
    const controller = new AbortController();
    registerRunController(runId, controller);

    void (async () => {
      try {
        db.prepare(`
          UPDATE distractor_runs SET status = 'running', started_at = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(toDbDate(new Date()), toDbDate(new Date()), runId, userId);

        const results = await generateDistractorsInBatches(
          generationQueue.map((item) => ({
            correctAnswers: item.correctAnswers,
            question: item.question,
            snippet: item.snippet,
            preview: item.preview,
            targetCount: item.targetCount,
            questionType: item.questionType,
            provider,
            model,
            fullCode,
            signal: controller.signal,
            existingDistractors: item.existingDistractors,
            stableKey: item.stableKey,
          })),
          {
            batchSize: LLM_DISTRACTOR_BATCH_SIZE,
            sharedCodeContext: fullCode,
            signal: controller.signal,
            onProgress: async (progress) => {
              db.prepare(`
                UPDATE distractor_runs SET total = ?, completed = ?, failed = ?, updated_at = ?
                WHERE id = ? AND user_id = ?
              `).run(
                progress.total + precheckFailures,
                progress.completed + precheckFailures,
                progress.failed + precheckFailures,
                toDbDate(new Date()),
                runId,
                userId
              );
            },
          }
        );

        results.forEach((res, idx) => {
          const { order, index, targetCount } = generationQueue[idx];
          const nextPool = Array.isArray(res.distractors) ? res.distractors : [];
          const existingPool = Array.isArray(quiz.cards[index].llmDistractors)
            ? quiz.cards[index].llmDistractors
            : [];
          if (nextPool.length > 0) {
            const samePool =
              existingPool.length === nextPool.length &&
              existingPool.every((value, i) => value === nextPool[i]);
            if (!samePool) {
              quiz.cards[index].llmDistractors = nextPool;
              updatedCards.push(order);
              changed = true;
            }
          }
          if (res.error) {
            failures.push({ order, error: res.error });
            return;
          }
          if (nextPool.length === 0) {
            failures.push({ order, error: "No distractors returned" });
            return;
          }
          if (nextPool.length < targetCount) {
            failures.push({
              order,
              error: `Only ${nextPool.length}/${targetCount} distractors after retries`,
            });
          }
        });

        if (controller.signal.aborted) {
          db.prepare(`
            UPDATE distractor_runs SET status = 'cancelled', error_message = ?, updated_at = ?, completed_at = ?
            WHERE id = ? AND user_id = ?
          `).run("Cancelled by user.", toDbDate(new Date()), toDbDate(new Date()), runId, userId);
          return;
        }

        if (changed) {
          db.prepare(`UPDATE quizzes SET cards = ? WHERE id = ? AND user_id = ?`)
            .run(toJson(quiz.cards), quizId, userId);
        }

        const finalStatus =
          updatedCards.length > 0
            ? "completed"
            : failures.length > 0
              ? "failed"
              : "completed";

        db.prepare(`
          UPDATE distractor_runs 
          SET status = ?, updated_cards = ?, failures = ?, completed = ?, failed = ?, 
              error_message = ?, updated_at = ?, completed_at = ?
          WHERE id = ? AND user_id = ?
        `).run(
          finalStatus,
          toJson(updatedCards),
          toJson(failures),
          totalCards,
          failures.length,
          finalStatus === "failed" ? failures[0]?.error : null,
          toDbDate(new Date()),
          toDbDate(new Date()),
          runId,
          userId
        );
      } catch (err) {
        const isAbort =
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError");
        const errorMessage =
          err instanceof Error ? err.message : "Failed to generate distractors.";

        db.prepare(`
          UPDATE distractor_runs SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
          WHERE id = ? AND user_id = ?
        `).run(
          isAbort ? "cancelled" : "failed",
          isAbort ? "Cancelled by user." : errorMessage,
          toDbDate(new Date()),
          toDbDate(new Date()),
          runId,
          userId
        );
      } finally {
        clearRunController(runId);
      }
    })();
  }

  return NextResponse.json(serializeRun(runDoc));
}
