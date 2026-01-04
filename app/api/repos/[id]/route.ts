export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../src/lib/sqlite";

const DEV_USER_ID = "dev-push-project";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    const db = getDb();
    const { id } = await context.params;

    const row = db.prepare(`
      SELECT 
        repo_id,
        MIN(url) as url,
        MIN(name) as name,
        MIN(owner) as owner,
        MIN(user_id) as user_id,
        MIN(created_at) as created_at,
        MAX(updated_at) as updated_at,
        COUNT(*) as total_files,
        SUM(CASE WHEN parse_status = 'success' THEN 1 ELSE 0 END) as parsed_files,
        SUM(CASE WHEN parse_status = 'failed' THEN 1 ELSE 0 END) as failed_files
      FROM repos
      WHERE repo_id = ?
      GROUP BY repo_id
    `).get(id) as {
      repo_id: string;
      url: string;
      name: string;
      owner: string;
      user_id: string;
      created_at: string;
      updated_at: string;
      total_files: number;
      parsed_files: number;
      failed_files: number;
    } | undefined;

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Check user permission
    if (row.user_id !== DEV_USER_ID && (!userId || row.user_id !== userId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: String(row.repo_id),
      url: row.url,
      name: row.name,
      owner: row.owner,
      status: "completed",
      progress: {
        totalFiles: row.total_files || 0,
        parsedFiles: row.parsed_files || 0,
        failedFiles: row.failed_files || 0,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = getDb();
    const { id } = await context.params;

    // Check if repo exists AND belongs to the user (or is a dev repo)
    const exists = db.prepare(`
      SELECT repo_id, user_id FROM repos WHERE repo_id = ? LIMIT 1
    `).get(id) as { repo_id: string; user_id: string } | undefined;

    if (!exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (exists.user_id !== DEV_USER_ID && exists.user_id !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Delete all files for this repo
    db.prepare(`DELETE FROM repos WHERE repo_id = ?`).run(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
