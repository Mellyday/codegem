export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/src/lib/mongodb";
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
  questionType?: "single" | "multi";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  llmDistractors?: string[];
  distractorPoolSize?: number;
};

type QuizDoc = {
  _id: ObjectId;
  userId: string;
  cards: QuizCard[];
};

type RunDoc = {
  _id: ObjectId;
  userId: string;
  quizId: ObjectId;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  updatedCards: number[];
  failures: Array<{ order: number; error: string }>;
  skipped: number;
  provider: string;
  model: string;
  batchSize: number;
  missingOnly: boolean;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
};

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const serializeRun = (run: RunDoc) => ({
  runId: String(run._id),
  quizId: String(run.quizId),
  status: run.status,
  total: toNumber(run.total),
  completed: toNumber(run.completed),
  failed: toNumber(run.failed),
  updatedCards: run.updatedCards,
  failures: run.failures,
  skipped: toNumber(run.skipped),
  provider: run.provider,
  model: run.model,
  batchSize: toNumber(run.batchSize),
  errorMessage: run.errorMessage,
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
  let quizId: ObjectId;
  try {
    quizId = new ObjectId(String(rawId));
  } catch {
    return NextResponse.json({ error: "Invalid quiz id" }, { status: 400 });
  }

  const db = await getDb();
  const quizzes = db.collection("quizzes");
  const runs = db.collection<RunDoc>("distractorRuns");
  const quiz = (await quizzes.findOne({
    _id: quizId,
    userId,
  })) as QuizDoc | null;

  if (!quiz) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

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
    const correctAnswers =
      card.questionType === "multi"
        ? (Array.isArray(card.multiCorrect)
          ? card.multiCorrect.map((c) => String(c ?? "")).filter(Boolean)
          : [])
        : [String(card.text ?? "")].filter(Boolean);
    const targetCount = card.distractorPoolSize
      ? card.distractorPoolSize
      : (card.questionType === "multi" ? 10 : 6);

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
      stableKey: `${String(quizId)}:${card.order ?? i}`,
    });
  }

  const precheckFailures = failures.length;
  const totalToGenerate = generationQueue.length;
  const totalCards = totalToGenerate + precheckFailures;
  const now = new Date();
  const initialStatus: RunDoc["status"] =
    totalToGenerate > 0
      ? "queued"
      : precheckFailures > 0
        ? "failed"
        : "completed";
  const runDoc: RunDoc = {
    _id: new ObjectId(),
    userId,
    quizId,
    status: initialStatus,
    total: totalCards,
    completed: precheckFailures,
    failed: precheckFailures,
    updatedCards: [],
    failures,
    skipped: skippedCount,
    provider,
    model,
    batchSize: LLM_DISTRACTOR_BATCH_SIZE,
    missingOnly,
    ...(initialStatus === "failed" ? { errorMessage: failures[0]?.error } : {}),
    createdAt: now,
    updatedAt: now,
    ...(totalToGenerate ? {} : { completedAt: now }),
  };

  await runs.insertOne(runDoc);

  if (totalToGenerate) {
    const runId = String(runDoc._id);
    const controller = new AbortController();
    registerRunController(runId, controller);

    void (async () => {
      try {
        await runs.updateOne(
          { _id: runDoc._id, userId },
          { $set: { status: "running", startedAt: new Date(), updatedAt: new Date() } }
        );

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
              await runs.updateOne(
                { _id: runDoc._id, userId },
                {
                  $set: {
                    total: progress.total + precheckFailures,
                    completed: progress.completed + precheckFailures,
                    failed: progress.failed + precheckFailures,
                    updatedAt: new Date(),
                  },
                }
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
          await runs.updateOne(
            { _id: runDoc._id, userId },
            {
              $set: {
                status: "cancelled",
                errorMessage: "Cancelled by user.",
                updatedAt: new Date(),
                completedAt: new Date(),
              },
            }
          );
          return;
        }

        if (changed) {
          await quizzes.updateOne(
            { _id: quizId, userId },
            { $set: { cards: quiz.cards } }
          );
        }

        const finalStatus =
          updatedCards.length > 0
            ? "completed"
            : failures.length > 0
              ? "failed"
              : "completed";

        await runs.updateOne(
          { _id: runDoc._id, userId },
          {
            $set: {
              status: finalStatus,
              updatedCards,
              failures,
              completed: totalCards,
              failed: failures.length,
              errorMessage: finalStatus === "failed" ? failures[0]?.error : undefined,
              updatedAt: new Date(),
              completedAt: new Date(),
            },
          }
        );
      } catch (err) {
        const isAbort =
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError");
        const errorMessage =
          err instanceof Error ? err.message : "Failed to generate distractors.";
        await runs.updateOne(
          { _id: runDoc._id, userId },
          {
            $set: {
              status: isAbort ? "cancelled" : "failed",
              errorMessage: isAbort ? "Cancelled by user." : errorMessage,
              updatedAt: new Date(),
              completedAt: new Date(),
            },
          }
        );
      } finally {
        clearRunController(runId);
      }
    })();
  }

  return NextResponse.json(serializeRun(runDoc));
}
