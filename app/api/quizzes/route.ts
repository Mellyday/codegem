import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";

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
    // Session is already validated by Clerk via auth(); no extra lookup needed

    // Resolve fileId if only fileKey is provided
    let fileId: any = body.fileId;
    // Capture origin metadata (repo/project and full path)
    let origin: { kind: "repo" | "project"; id: any; path: string } | undefined;
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
      origin = {
        kind: body.fileKey.kind,
        id: body.fileKey.id as any,
        path: body.fileKey.path,
      };
    }
    if (!fileId) {
      return NextResponse.json(
        { error: "Missing fileId or fileKey" },
        { status: 400 }
      );
    }

    // If origin wasn't provided via fileKey but we have fileId, try to infer from files collection
    if (!origin) {
      try {
        const fileDoc = await files.findOne({ _id: fileId as any }, {
          projection: { repoId: 1, projectId: 1, path: 1 },
        });
        if (fileDoc) {
          const kind = (fileDoc as any).repoId ? "repo" : "project";
          const id = (fileDoc as any).repoId ?? (fileDoc as any).projectId;
          if (id && (fileDoc as any).path) {
            origin = { kind, id, path: (fileDoc as any).path };
          }
        }
      } catch {
        // ignore; origin remains undefined if lookup fails
      }
    }

    const now = new Date();
    const doc = {
      userId: clerkUserId,
      fileId,
      ...(origin ? { origin } : {}),
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
        origin: (q as any).origin,
        createdAt: (q as any).createdAt,
      }));
    const list = await cursor.toArray();
    return NextResponse.json({ quizzes: list });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const db = await getDb();
    const quizzes = db.collection("quizzes");
    const _id = (() => {
      try {
        return new ObjectId(id);
      } catch {
        return id as any; // fallback in case ids were stored as strings
      }
    })();
    const res = await quizzes.deleteOne({ _id, userId: clerkUserId } as any);
    if (res.deletedCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
