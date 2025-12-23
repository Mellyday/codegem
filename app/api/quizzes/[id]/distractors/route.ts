export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../../src/lib/mongodb";
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
  questionType?: "single" | "multi";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  llmDistractors?: string[];
};

type QuizDoc = {
  _id: ObjectId;
  userId: string;
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
  let quizId: ObjectId;
  try {
    quizId = new ObjectId(String(rawId));
  } catch {
    return NextResponse.json({ error: "Invalid quiz id" }, { status: 400 });
  }

  const db = await getDb();
  const quizzes = db.collection("quizzes");
  const quiz = (await quizzes.findOne({
    _id: quizId,
    userId,
  })) as QuizDoc | null;

  if (!quiz) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

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
  }> = [];

  for (let i = 0; i < (quiz.cards || []).length; i++) {
    const card = quiz.cards[i] as QuizCard;
    const correctAnswers =
      card.questionType === "multi"
        ? (Array.isArray(card.multiCorrect)
          ? card.multiCorrect.map((c) => String(c ?? "")).filter(Boolean)
          : [])
        : [String(card.text ?? "")].filter(Boolean);
    const targetCount = card.questionType === "multi" ? 10 : 6;

    if (!correctAnswers.length) {
      failures.push({
        order: card.order ?? i,
        error: "Missing correct answer for card",
      });
      continue;
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
      })),
      {
        batchSize: LLM_DISTRACTOR_BATCH_SIZE,
        onProgress,
        sharedCodeContext: fullCode,
        onBatchLog,
      }
    );

    results.forEach((res, idx) => {
      const { order, index } = generationQueue[idx];
      if (res.error) {
        failures.push({ order, error: res.error });
        return;
      }
      if (res.distractors?.length) {
        quiz.cards[index].llmDistractors = res.distractors;
        updatedCards.push(order);
        changed = true;
      }
    });
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
          });
          await runGeneration(
            (progress) => emit({ type: "progress", ...progress }),
            wantsDebug
              ? (batchEvent) => emit({ type: "batch-detail", ...batchEvent })
              : undefined
          );
          if (changed) {
            await quizzes.updateOne(
              { _id: quizId, userId },
              { $set: { cards: quiz.cards } }
            );
          }
          emit({
            type: "complete",
            provider,
            model,
            updatedCards,
            failures,
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
    await quizzes.updateOne(
      { _id: quizId, userId },
      { $set: { cards: quiz.cards } }
    );
  }

  return NextResponse.json({
    provider,
    model,
    updatedCards,
    failures,
  });
}
