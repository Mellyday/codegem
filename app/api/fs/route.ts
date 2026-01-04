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

    // Determine which table to use based on kind
    // repos table for kind="repo", files table for kind="project"
    const tableName = kind === "repo" ? "repos" : "files";
    const idColumn = kind === "repo" ? "repo_id" : "project_id";

    if (body.action === "create_folder") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
      if (name.includes("/")) {
        return NextResponse.json({ error: "Folder name cannot contain '/'" }, { status: 400 });
      }
      const path = joinPath(body.prefix, name);

      // Check if path already exists
      const existing = db.prepare(`
        SELECT id FROM ${tableName} WHERE user_id = ? AND path = ? AND ${idColumn} = ? LIMIT 1
      `).get(userId, path, body.id) as { id: string } | undefined;

      if (existing) {
        return NextResponse.json({ error: "Path already exists" }, { status: 409 });
      }

      const now = toDbDate(new Date());
      const newId = generateId();

      if (kind === "repo") {
        db.prepare(`
          INSERT INTO repos (id, user_id, repo_id, path, is_dir, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(newId, userId, body.id, path, now, now);
      } else {
        db.prepare(`
          INSERT INTO files (id, user_id, project_id, path, is_dir, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(newId, userId, body.id, path, now, now);
      }

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
      const existing = db.prepare(`
        SELECT id FROM ${tableName} WHERE user_id = ? AND path = ? AND ${idColumn} = ? LIMIT 1
      `).get(userId, path, body.id) as { id: string } | undefined;

      if (existing) {
        return NextResponse.json({ error: "Path already exists" }, { status: 409 });
      }

      const now = toDbDate(new Date());
      const extension = name.includes(".") ? name.split(".").pop() : undefined;
      const newId = generateId();

      if (kind === "repo") {
        db.prepare(`
          INSERT INTO repos (id, user_id, repo_id, path, extension, language, size, source_code, parse_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)
        `).run(
          newId,
          userId,
          body.id,
          path,
          extension,
          (body as any).language,
          Buffer.byteLength(body.sourceCode ?? "", "utf8"),
          body.sourceCode ?? "",
          now,
          now
        );
      } else {
        db.prepare(`
          INSERT INTO files (id, user_id, project_id, path, extension, language, size, source_code, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId,
          userId,
          body.id,
          path,
          extension,
          (body as any).language,
          Buffer.byteLength(body.sourceCode ?? "", "utf8"),
          body.sourceCode ?? "",
          now,
          now
        );
      }

      return NextResponse.json({ ok: true, id: newId });
    }

    if (body.action === "delete") {
      const path = body.path?.trim();
      if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

      let deletedCount = 0;

      if (body.isDir) {
        // Delete the folder marker and all files under this path prefix
        // Critical: scope by user_id to prevent unauthorized deletion
        const result = db.prepare(`
          DELETE FROM ${tableName} WHERE user_id = ? AND ${idColumn} = ? AND (path = ? OR path LIKE ?)
        `).run(userId, body.id, path, `${path}/%`);
        deletedCount = result.changes;
      } else {
        // Delete single file
        // Critical: scope by user_id to prevent unauthorized deletion
        const result = db.prepare(`
          DELETE FROM ${tableName} WHERE user_id = ? AND ${idColumn} = ? AND path = ?
        `).run(userId, body.id, path);
        deletedCount = result.changes;
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
