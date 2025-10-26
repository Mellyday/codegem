import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";
import { auth, clerkClient } from "@clerk/nextjs/server";

type QuizCard = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
};

type QuizPayload = {
  // Prefer resolving fileId server-side using the file key
  fileId?: string;
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  name: string;
  // Schema/version discriminator
  type: string; // e.g. "CustomQuizV1"
  rootNode: { type: string; text: string };
  cards: QuizCard[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuizPayload;
    const db = await getDb();
    const quizzes = db.collection("quizzes");
    const files = db.collection("files");
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Optional: validate user exists in Clerk to harden
    try {
      const client = await clerkClient();
      await client.users.getUser(clerkUserId);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve fileId if only fileKey is provided
    let fileId: any = body.fileId;
    if (!fileId && body.fileKey) {
      const match: any = { userId: clerkUserId, path: body.fileKey.path };
      if (body.fileKey.kind === "repo") {
        match.repoId = body.fileKey.id as any;
        match.projectId = null;
      } else {
        match.projectId = body.fileKey.id as any;
      }
      const fileDoc = await files.findOne(match, { projection: { _id: 1 } });
      if (!fileDoc) {
        return NextResponse.json(
          { error: "File not found for user" },
          { status: 400 }
        );
      }
      fileId = (fileDoc as any)._id;
    }
    if (!fileId) {
      return NextResponse.json(
        { error: "Missing fileId or fileKey" },
        { status: 400 }
      );
    }

    const now = new Date();
    const doc = {
      userId: clerkUserId,
      fileId,
      name: body.name,
      type: body.type,
      rootNode: { type: body.rootNode.type, text: body.rootNode.text },
      cards: body.cards?.map((c) => ({
        order: c.order,
        type: c.type,
        text: c.text,
        action: c.action,
      })) ?? [],
      createdAt: now,
    } as const;
    const result = await quizzes.insertOne(doc);

    return NextResponse.json({ id: String(result.insertedId) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const id = url.searchParams.get("id");
    const path = url.searchParams.get("path");
    const db = await getDb();
    const quizzes = db.collection("quizzes");
    const files = db.collection("files");
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!kind || !id || !path) {
      return NextResponse.json(
        { error: "Missing kind, id, or path" },
        { status: 400 }
      );
    }

    const match: any = { userId: clerkUserId, path };
    if (kind === "repo") {
      match.repoId = id as any;
      match.projectId = null;
    } else {
      match.projectId = id as any;
    }
    const fileDoc = await files.findOne(match, { projection: { _id: 1 } });
    if (!fileDoc) return NextResponse.json({ quizzes: [] });
    const fileId = (fileDoc as any)._id;

    const cursor = quizzes
      .find({ userId: clerkUserId, fileId }, { sort: { createdAt: -1 } })
      .map((q) => ({
        id: String((q as any)._id),
        name: (q as any).name,
        type: (q as any).type,
        rootNode: (q as any).rootNode,
        cards: (q as any).cards,
        createdAt: (q as any).createdAt,
      }));
    const list = await cursor.toArray();
    return NextResponse.json({ quizzes: list });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
