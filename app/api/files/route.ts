export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { getDb, generateId, toDbDate, toJson } from "../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

type FilePayload = {
  userId?: string; // Ignored; server enforces Clerk user
  repoId?: string | null;
  projectId?: string | null;
  path: string;
  language: string;
  extension: string;
  sourceCode: string;
  ast: unknown;
  parseStatus?: "success" | "failed";
  parseError?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FilePayload;
    const db = getDb();
    const now = toDbDate(new Date());
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = generateId();

    db.prepare(`
      INSERT INTO files (
        id, user_id, repo_id, project_id, path, language, extension,
        source_code, ast, size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      clerkUserId,
      body.repoId ?? null,
      body.projectId ?? null,
      body.path,
      body.language,
      body.extension,
      body.sourceCode,
      toJson(body.ast),
      Buffer.from(body.sourceCode, "utf8").length,
      now,
      now
    );

    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
