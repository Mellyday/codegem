export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { getDb, generateId, toDbDate } from "@/src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

type FsAction =
  | {
    action: "create_folder";
    kind: "repo" | "project";
    id: string;
    prefix?: string;
    name: string;
  }
  | {
    action: "create_snippet";
    kind: "repo" | "project";
    id: string;
    prefix?: string;
    name: string; // file name, e.g. hello.py
    language?: string;
    sourceCode?: string;
  }
  | {
    action: "delete";
    kind: "repo" | "project";
    id: string;
    path: string; // full path to delete
    isDir?: boolean; // if true, recursively delete folder contents
  };

function normalizePrefix(prefix?: string): string {
  return (prefix || "").replace(/^\/+|\/+$/g, "");
}

function joinPath(prefix: string | undefined, name: string): string {
  const p = normalizePrefix(prefix);
  return [p, name].filter(Boolean).join("/");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FsAction;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body || (body.action !== "create_folder" && body.action !== "create_snippet" && body.action !== "delete")) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const db = getDb();

    // Basic validation
    const { kind, id } = body as any;
    if (!kind || !id) {
      return NextResponse.json({ error: "Missing kind or id" }, { status: 400 });
    }

    if (body.action === "create_folder") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
      if (name.includes("/")) {
        return NextResponse.json({ error: "Folder name cannot contain '/'" }, { status: 400 });
      }
      const path = joinPath(body.prefix, name);

      // Check if path already exists
      let existing: { id: string } | undefined;
      if (body.kind === "repo") {
        existing = db.prepare(`
          SELECT id FROM files WHERE user_id = ? AND path = ? AND repo_id = ? AND project_id IS NULL LIMIT 1
        `).get(userId, path, body.id) as typeof existing;
      } else {
        existing = db.prepare(`
          SELECT id FROM files WHERE user_id = ? AND path = ? AND project_id = ? LIMIT 1
        `).get(userId, path, body.id) as typeof existing;
      }

      if (existing) {
        return NextResponse.json({ error: "Path already exists" }, { status: 409 });
      }

      const now = toDbDate(new Date());
      const newId = generateId();

      db.prepare(`
        INSERT INTO files (id, user_id, path, is_dir, repo_id, project_id, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(
        newId,
        userId,
        path,
        body.kind === "repo" ? body.id : null,
        body.kind === "project" ? body.id : null,
        now
      );

      return NextResponse.json({ ok: true, id: newId });
    }

    if (body.action === "create_snippet") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
      if (name.endsWith("/")) {
        return NextResponse.json({ error: "File name cannot end with '/'" }, { status: 400 });
      }
      const path = joinPath(body.prefix, name);

      // Check if path already exists
      let existing: { id: string } | undefined;
      if (body.kind === "repo") {
        existing = db.prepare(`
          SELECT id FROM files WHERE user_id = ? AND path = ? AND repo_id = ? AND project_id IS NULL LIMIT 1
        `).get(userId, path, body.id) as typeof existing;
      } else {
        existing = db.prepare(`
          SELECT id FROM files WHERE user_id = ? AND path = ? AND project_id = ? LIMIT 1
        `).get(userId, path, body.id) as typeof existing;
      }

      if (existing) {
        return NextResponse.json({ error: "Path already exists" }, { status: 409 });
      }

      const now = toDbDate(new Date());
      const extension = name.includes(".") ? name.split(".").pop() : undefined;
      const newId = generateId();

      db.prepare(`
        INSERT INTO files (id, user_id, path, extension, language, size, source_code, repo_id, project_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId,
        userId,
        path,
        extension,
        (body as any).language,
        (body.sourceCode ?? "").length,
        body.sourceCode ?? "",
        body.kind === "repo" ? body.id : null,
        body.kind === "project" ? body.id : null,
        now
      );

      return NextResponse.json({ ok: true, id: newId });
    }

    if (body.action === "delete") {
      const path = body.path?.trim();
      if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

      let deletedCount = 0;

      if (body.isDir) {
        // Delete the folder marker and all files under this path prefix
        if (body.kind === "repo") {
          const result = db.prepare(`
            DELETE FROM files WHERE repo_id = ? AND project_id IS NULL AND (path = ? OR path LIKE ?)
          `).run(body.id, path, `${path}/%`);
          deletedCount = result.changes;
        } else {
          const result = db.prepare(`
            DELETE FROM files WHERE project_id = ? AND (path = ? OR path LIKE ?)
          `).run(body.id, path, `${path}/%`);
          deletedCount = result.changes;
        }
      } else {
        // Delete single file
        if (body.kind === "repo") {
          const result = db.prepare(`
            DELETE FROM files WHERE repo_id = ? AND project_id IS NULL AND path = ?
          `).run(body.id, path);
          deletedCount = result.changes;
        } else {
          const result = db.prepare(`
            DELETE FROM files WHERE project_id = ? AND path = ?
          `).run(body.id, path);
          deletedCount = result.changes;
        }
      }

      if (deletedCount === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ ok: true, deletedCount });
    }

    return NextResponse.json({ error: "Unsupported" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
