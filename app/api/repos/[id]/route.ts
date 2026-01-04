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

    // Fix #1: Properly determine effective user_id
    // Prefer logged-in user's copy, then fall back to DEV
    let effectiveUserId: string | null = null;

    if (userId) {
      const repoForUser = db.prepare(`
        SELECT 1 FROM repos WHERE repo_id = ? AND user_id = ? LIMIT 1
      `).get(id, userId);
      if (repoForUser) effectiveUserId = userId;
    }

    if (!effectiveUserId) {
      const repoForDev = db.prepare(`
        SELECT 1 FROM repos WHERE repo_id = ? AND user_id = ? LIMIT 1
      `).get(id, DEV_USER_ID);
      if (repoForDev) effectiveUserId = DEV_USER_ID;
    }

    if (!effectiveUserId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = db.prepare(`
      SELECT 
        repo_id,
        MIN(url) as url,
        MIN(name) as name,
        MIN(owner) as owner,
        user_id,
        MIN(created_at) as created_at,
        MAX(updated_at) as updated_at,
        COUNT(*) as total_files,
        SUM(CASE WHEN parse_status = 'success' THEN 1 ELSE 0 END) as parsed_files,
        SUM(CASE WHEN parse_status = 'failed' THEN 1 ELSE 0 END) as failed_files
      FROM repos
      WHERE user_id = ? AND repo_id = ?
      GROUP BY user_id, repo_id
    `).get(effectiveUserId, id) as {
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

    // Fix #2: Check if user owns this repo (scoped by user_id)
    const exists = db.prepare(`
      SELECT 1 FROM repos WHERE repo_id = ? AND user_id = ? LIMIT 1
    `).get(id, userId);

    if (!exists) {
      // Check if it's a DEV repo
      const devRepo = db.prepare(`
        SELECT 1 FROM repos WHERE repo_id = ? AND user_id = ? LIMIT 1
      `).get(id, DEV_USER_ID);

      if (devRepo) {
        // DEV repos are read-only for non-dev users
        return NextResponse.json({ error: "Cannot delete shared repository" }, { status: 403 });
      }

      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Delete ONLY the user's rows (scoped by user_id)
    db.prepare(`DELETE FROM repos WHERE repo_id = ? AND user_id = ?`).run(id, userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
