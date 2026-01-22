export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, generateId, toDbDate, toJson, fromJson } from "../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

const DEV_USER_ID = "dev-push-project";

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
  // multi-select (optional)
  questionType?: "single" | "multi" | "orderedMulti" | "sequence" | "mapping";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  // mapping (optional)
  pairs?: Array<{ key: string; value: string }>;
  matchlessKeys?: string[];
  keyDistractors?: string[];
  valueDistractors?: string[];
  // future: LLM distractor pool
  llmDistractors?: string[];
};

type QuizPayload = {
  // Prefer resolving fileId server-side using the file key
  fileId?: string;
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  name: string;
  // Schema/version discriminator
  type: string; // e.g. "CustomQuizV1.1"
  rootNode: {
    type: string;
    text?: string;
    start?: number;
    end?: number;
    path?: number[];
  };
  profile?: "shallow" | "normal" | "deep";
  cards: QuizCard[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuizPayload;
    const db = getDb();
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve fileId from fileKey if needed, supporting repo-backed files.
    let fileId: string | undefined = body.fileId;
    let origin: { kind: "repo" | "project"; id: string; path: string } | undefined;

    if (!fileId) {
      if (!body.fileKey) {
        return NextResponse.json(
          { error: "Missing fileId or fileKey" },
          { status: 400 }
        );
      }

      let fileDoc: { id: string; path: string } | undefined;


      if (body.fileKey.kind === "repo") {
        // User-first, DEV-fallback for repos
        fileDoc = db.prepare(`
          SELECT id, path FROM repos
          WHERE repo_id = ? AND path = ? AND user_id = ?
          LIMIT 1
        `).get(body.fileKey.id, body.fileKey.path, clerkUserId) as typeof fileDoc;

        if (!fileDoc) {
          fileDoc = db.prepare(`
            SELECT id, path FROM repos
            WHERE repo_id = ? AND path = ? AND user_id = ?
            LIMIT 1
          `).get(body.fileKey.id, body.fileKey.path, DEV_USER_ID) as typeof fileDoc;
        }
      } else {
        // User-first, DEV-fallback for projects
        fileDoc = db.prepare(`
          SELECT id, path FROM files
          WHERE project_id = ? AND path = ? AND user_id = ?
          LIMIT 1
        `).get(body.fileKey.id, body.fileKey.path, clerkUserId) as typeof fileDoc;

        if (!fileDoc) {
          fileDoc = db.prepare(`
            SELECT id, path FROM files
            WHERE project_id = ? AND path = ? AND user_id = ?
            LIMIT 1
          `).get(body.fileKey.id, body.fileKey.path, DEV_USER_ID) as typeof fileDoc;
        }
      }

      if (!fileDoc) {
        return NextResponse.json(
          { error: "File not found for provided key" },
          { status: 404 }
        );
      }
      fileId = fileDoc.id;
      origin = {
        kind: body.fileKey.kind,
        id: body.fileKey.id,
        path: body.fileKey.path,
      };
    } else {
      // If fileId provided, attempt to infer origin for convenience (best-effort)
      try {
        const fileDoc = db.prepare(`
          SELECT id, repo_id, project_id, path FROM files WHERE id = ?
        `).get(fileId) as { id: string; repo_id?: string; project_id?: string; path: string } | undefined;

        if (fileDoc) {
          const kind = fileDoc.repo_id ? "repo" : "project";
          const id = fileDoc.repo_id ?? fileDoc.project_id;
          if (id && fileDoc.path) {
            origin = { kind, id, path: fileDoc.path };
          }
        }
      } catch {
        // no-op
      }
    }

    const now = toDbDate(new Date());

    // Check if any quizzes already exist for this file
    // If not, this new quiz will be the canonical one
    const existingQuizCount = db.prepare(`
      SELECT COUNT(*) as count FROM quizzes WHERE user_id = ? AND file_id = ?
    `).get(clerkUserId, fileId) as { count: number };
    const shouldBeCanonical = existingQuizCount.count === 0;

    const quizId = generateId();
    const cards = body.cards?.map((c) => ({
      order: c.order,
      type: c.type,
      text: c.text,
      action: c.action,
      ...(c.question ? { question: c.question } : {}),
      ...(c.generatorRule ? { generatorRule: c.generatorRule } : {}),
      ...(c.difficulty ? { difficulty: c.difficulty } : {}),
      ...(c.sourceRef ? { sourceRef: c.sourceRef } : {}),
      ...(c.questionType ? { questionType: c.questionType } : {}),
      ...(Array.isArray(c.multiCorrect) ? { multiCorrect: c.multiCorrect } : {}),
      ...(typeof c.multiSelectHint === "number" ? { multiSelectHint: c.multiSelectHint } : {}),
      ...(Array.isArray(c.optionPool) ? { optionPool: c.optionPool } : {}),
      ...(Array.isArray(c.pairs) ? { pairs: c.pairs } : {}),
      ...(Array.isArray(c.matchlessKeys) ? { matchlessKeys: c.matchlessKeys } : {}),
      ...(Array.isArray(c.keyDistractors) ? { keyDistractors: c.keyDistractors } : {}),
      ...(Array.isArray(c.valueDistractors) ? { valueDistractors: c.valueDistractors } : {}),
      ...(Array.isArray(c.llmDistractors) ? { llmDistractors: c.llmDistractors } : {}),
    })) ?? [];

    db.prepare(`
      INSERT INTO quizzes (
        id, user_id, file_id, origin, name, type, root_node, profile,
        is_canonical, cards, section_markers, section_names, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      quizId,
      clerkUserId,
      fileId,
      origin ? toJson(origin) : null,
      body.name,
      body.type,
      toJson(body.rootNode),
      body.profile || null,
      shouldBeCanonical ? 1 : 0,
      toJson(cards),
      null,
      null,
      now
    );

    return NextResponse.json({ id: quizId });
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
    const db = getDb();
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

    // Find file ID - user-first, DEV-fallback
    let fileDoc: { id: string } | undefined;


    if (kind === "repo") {
      // User-first
      fileDoc = db.prepare(`
        SELECT id FROM repos WHERE repo_id = ? AND path = ? AND user_id = ? LIMIT 1
      `).get(id, path, clerkUserId) as typeof fileDoc;

      // DEV-fallback
      if (!fileDoc) {
        fileDoc = db.prepare(`
          SELECT id FROM repos WHERE repo_id = ? AND path = ? AND user_id = ? LIMIT 1
        `).get(id, path, DEV_USER_ID) as typeof fileDoc;
      }
    } else {
      // User-first
      fileDoc = db.prepare(`
        SELECT id FROM files WHERE project_id = ? AND path = ? AND user_id = ? LIMIT 1
      `).get(id, path, clerkUserId) as typeof fileDoc;

      // DEV-fallback
      if (!fileDoc) {
        fileDoc = db.prepare(`
          SELECT id FROM files WHERE project_id = ? AND path = ? AND user_id = ? LIMIT 1
        `).get(id, path, DEV_USER_ID) as typeof fileDoc;
      }
    }

    const list: any[] = [];
    if (fileDoc) {
      const fileId = fileDoc.id;
      const rows = db.prepare(`
        SELECT id, name, type, root_node, cards, origin, created_at, profile,
               section_markers, section_names, is_canonical
        FROM quizzes
        WHERE user_id = ? AND file_id = ?
        ORDER BY created_at DESC
      `).all(clerkUserId, fileId) as Array<{
        id: string;
        name: string;
        type: string;
        root_node: string;
        cards: string;
        origin: string | null;
        created_at: string;
        profile: string | null;
        section_markers: string | null;
        section_names: string | null;
        is_canonical: number;
      }>;

      for (const q of rows) {
        list.push({
          id: q.id,
          name: q.name,
          type: q.type,
          rootNode: fromJson(q.root_node),
          cards: fromJson(q.cards),
          origin: fromJson(q.origin),
          createdAt: q.created_at,
          profile: q.profile,
          sectionMarkers: fromJson(q.section_markers),
          sectionNames: fromJson(q.section_names),
          isCanonical: q.is_canonical === 1,
        });
      }
    }
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
    const db = getDb();

    const result = db.prepare(`
      DELETE FROM quizzes WHERE id = ? AND user_id = ?
    `).run(id, clerkUserId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
