export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";

type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

type QuizCard = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  // v1.1 optional fields
  question?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  sourceRef?: SourceRef;
};

type QuizPayload = {
  // Prefer resolving fileId server-side using the file key
  fileId?: string;
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  name: string;
  // Schema/version discriminator
  type: string; // e.g. "CustomQuizV1.1"
  rootNode: { type: string; text?: string; start?: number; end?: number; path?: number[] };
  profile?: "shallow" | "normal" | "deep";
  cards: QuizCard[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuizPayload;
    const db = await getDb();
    const quizzes = db.collection("quizzes");
    const files = db.collection("files");
    const reposCol = db.collection("repos");
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Session is already validated by Clerk via auth(); no extra lookup needed

    // Debug log payload summary
    try {
      console.log("[quizzes:POST] incoming", {
        user: clerkUserId,
        hasFileId: !!body.fileId,
        fileKey: body.fileKey,
        name: body.name,
        type: body.type,
        profile: body.profile,
        cards: Array.isArray(body.cards) ? body.cards.length : 0,
      });
    } catch {}

    // Resolve fileId from fileKey if needed, supporting repo-backed files.
    let fileId: any = body.fileId;
    let origin: { kind: "repo" | "project"; id: any; path: string } | undefined;
    if (!fileId) {
      if (!body.fileKey) {
        return NextResponse.json({ error: "Missing fileId or fileKey" }, { status: 400 });
      }
      // For repos, files are shared across users; do not filter by userId.
      // For projects, files are user-scoped; include userId in match.
      const baseMatch: any = { path: body.fileKey.path };
      const rawId = body.fileKey.id as any;
      let idAsObject: any = rawId;
      try {
        idAsObject = new ObjectId(String(rawId));
      } catch {
        idAsObject = rawId;
      }
      const buildMatch = (useObject: boolean) => {
        const match: any = { ...baseMatch };
        if (body.fileKey!.kind === "repo") {
          match.repoId = useObject ? idAsObject : rawId;
          // Do not add userId for repos; repo docs are global/shared
        } else {
          match.projectId = useObject ? idAsObject : rawId;
          match.userId = clerkUserId;
        }
        return match;
      };
      const mObj = buildMatch(true);
      const mRaw = buildMatch(false);
      let fileDoc: any | null = null;
      if (body.fileKey.kind === "repo") {
        fileDoc = await reposCol.findOne(mObj, { projection: { _id: 1, path: 1, repoId: 1 } });
        if (!fileDoc) fileDoc = await reposCol.findOne(mRaw, { projection: { _id: 1, path: 1, repoId: 1 } });
      } else {
        fileDoc = await files.findOne(mObj, { projection: { _id: 1, path: 1, projectId: 1 } });
        if (!fileDoc) fileDoc = await files.findOne(mRaw, { projection: { _id: 1, path: 1, projectId: 1 } });
      }
      if (!fileDoc) {
        return NextResponse.json({ error: "File not found for provided key" }, { status: 404 });
      }
      fileId = (fileDoc as any)._id;
      origin = {
        kind: body.fileKey.kind,
        id: rawId,
        path: body.fileKey.path,
      } as any;
    } else {
      // If fileId provided, attempt to infer origin for convenience (best-effort)
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
        // no-op
      }
    }

    const now = new Date();
    const doc = {
      userId: clerkUserId,
      fileId,
      ...(origin ? { origin } : {}),
      name: body.name,
      type: body.type,
      rootNode: {
        type: body.rootNode.type,
        ...(body.rootNode.text ? { text: body.rootNode.text } : {}),
        ...(typeof body.rootNode.start === "number"
          ? { start: body.rootNode.start }
          : {}),
        ...(typeof body.rootNode.end === "number" ? { end: body.rootNode.end } : {}),
        ...(Array.isArray(body.rootNode.path) ? { path: body.rootNode.path } : {}),
      },
      ...(body.profile ? { profile: body.profile } : {}),
      cards: body.cards?.map((c) => ({
        order: c.order,
        type: c.type,
        text: c.text,
        action: c.action,
        ...(c.question ? { question: c.question } : {}),
        ...(c.generatorRule ? { generatorRule: c.generatorRule } : {}),
        ...(c.difficulty ? { difficulty: c.difficulty } : {}),
        ...(c.sourceRef ? { sourceRef: c.sourceRef } : {}),
      })) ?? [],
      createdAt: now,
    } as const;
    const result = await quizzes.insertOne(doc);
    try {
      console.log("[quizzes:POST] saved", {
        user: clerkUserId,
        quizId: String(result.insertedId),
        fileId: String(fileId),
        name: (doc as any).name,
        cards: (doc as any).cards?.length ?? 0,
      });
    } catch {}

    return NextResponse.json({ id: String(result.insertedId) });
  } catch (error) {
    try {
      console.error("[quizzes:POST] error", error);
    } catch {}
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
    const reposCol = db.collection("repos");
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

    // For repos, do not filter by userId; for projects, include userId
    const baseMatch: any = { path };
    let idAsObject: any = id as any;
    try { idAsObject = new ObjectId(String(id)); } catch { idAsObject = id as any; }
    const buildMatch = (useObject: boolean) => {
      const m: any = { ...baseMatch };
      if (kind === "repo") {
        m.repoId = useObject ? idAsObject : id;
      } else {
        m.projectId = useObject ? idAsObject : id;
        m.userId = clerkUserId;
      }
      return m;
    };
    const mObj = buildMatch(true);
    const mRaw = buildMatch(false);
    let fileDoc: any | null = null;
    if (kind === "repo") {
      fileDoc = await reposCol.findOne(mObj, { projection: { _id: 1 } });
      if (!fileDoc) fileDoc = await reposCol.findOne(mRaw, { projection: { _id: 1 } });
    } else {
      fileDoc = await files.findOne(mObj, { projection: { _id: 1 } });
      if (!fileDoc) fileDoc = await files.findOne(mRaw, { projection: { _id: 1 } });
    }
    const list: any[] = [];
    if (fileDoc) {
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
      list.push(...(await cursor.toArray()));
    }
    try {
      console.log("[quizzes:GET] list", {
        user: clerkUserId,
        kind,
        id,
        path,
        count: list.length,
      });
    } catch {}
    return NextResponse.json({ quizzes: list });
  } catch (error) {
    try {
      console.error("[quizzes:GET] error", error);
    } catch {}
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
