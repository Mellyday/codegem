export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, toJson, fromJson } from "../../../../../src/lib/sqlite";
import {
  generateDistractorsInBatches,
  LLM_DISTRACTOR_BATCH_SIZE,
  BatchLogEvent,
} from "../../../../../src/lib/llmDistractorProvider";

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
  questionType?: "single" | "multi" | "orderedMulti" | "mapping";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  pairs?: Array<{ key: string; value: string }>;
  matchlessKeys?: string[];
  keyDistractors?: string[];
  valueDistractors?: string[];
  llmDistractors?: string[];
  /** Override distractor count for grouped imports */
  distractorPoolSize?: number;
};

type QuizDoc = {
  id: string;
  user_id: string;
  cards: QuizCard[];
};

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
  const routeParams = await params.catch(() => ({} as any));
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
    "deepseek") as any;
  const model = body?.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const fullCode =
    typeof body?.fullCode === "string" && body.fullCode.trim()
      ? body.fullCode
      : undefined;
  const wantsProgress = url.searchParams.get("progress") === "1";
  const wantsDebug = url.searchParams.get("debug") === "1";
  const missingOnly = url.searchParams.get("missingOnly") === "1";

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
    const isMapping = card.questionType === "mapping";
    if (isMapping) {
      skippedCount++;
      continue;
    }
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

    // If missingOnly mode, skip cards that already have sufficient distractors
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

  const totalToGenerate = generationQueue.length;

  const runGeneration = async (
    onProgress?: (progress: {
      total: number;
      completed: number;
      failed: number;
      batchIndex: number;
      batchTotal: number;
    }) => void,
    onBatchLog?: (event: BatchLogEvent) => void
  ) => {
    if (!totalToGenerate) return;
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
        signal: request.signal,
        existingDistractors: item.existingDistractors,
        stableKey: item.stableKey,
      })),
      {
        batchSize: LLM_DISTRACTOR_BATCH_SIZE,
        onProgress,
        sharedCodeContext: fullCode,
        onBatchLog,
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
  };

  const saveCards = () => {
    db.prepare(`UPDATE quizzes SET cards = ? WHERE id = ? AND user_id = ?`)
      .run(toJson(quiz.cards), quizId, userId);
  };

  if (wantsProgress) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (payload: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };

        try {
          emit({
            type: "start",
            total: totalToGenerate,
            batchSize: LLM_DISTRACTOR_BATCH_SIZE,
            provider,
            model,
            skipped: skippedCount,
          });
          await runGeneration(
            (progress) => emit({ type: "progress", ...progress }),
            wantsDebug
              ? (batchEvent) => emit({ type: "batch-detail", ...batchEvent })
              : undefined
          );
          if (changed) {
            saveCards();
          }
          emit({
            type: "complete",
            provider,
            model,
            updatedCards,
            failures,
            skipped: skippedCount,
          });
        } catch (err: any) {
          emit({
            type: "error",
            error: err?.message || String(err),
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  }

  await runGeneration();

  if (changed) {
    saveCards();
  }

  return NextResponse.json({
    provider,
    model,
    updatedCards,
    failures,
    skipped: skippedCount,
  });
}
