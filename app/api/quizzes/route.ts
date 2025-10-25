import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";

type QuizCard = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
};

type QuizPayload = {
  userId?: string; // TODO: integrate Clerk later
  fileId: string;
  name: string;
  type: "custom" | "lesson-derived";
  rootNode: { type: string; text?: string };
  cards: QuizCard[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuizPayload;
    const db = await getDb();
    const quizzes = db.collection("quizzes");

    const now = new Date();
    const result = await quizzes.insertOne({
      ...body,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: String(result.insertedId) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
