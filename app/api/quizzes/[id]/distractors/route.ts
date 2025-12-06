export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../../src/lib/mongodb";
import { generateDistractors } from "../../../../../src/lib/llmDistractorProvider";

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

  const updatedCards: number[] = [];
  const failures: Array<{ order: number; error: string }> = [];
  let changed = false;

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

    try {
      const result = await generateDistractors({
        correctAnswers,
        question: card.question,
        snippet: String(card.text ?? ""),
        preview: card.sourceRef?.preview,
        targetCount,
        questionType: card.questionType,
        provider,
        model,
      });
      if (result.distractors?.length) {
        card.llmDistractors = result.distractors;
        updatedCards.push(card.order ?? i);
        changed = true;
      }
    } catch (err: any) {
      failures.push({
        order: card.order ?? i,
        error: err?.message || String(err),
      });
    }
  }

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
