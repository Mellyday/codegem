export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, generateId } from "../../../src/lib/sqlite";
import { cloneGithubRepo, parseGithubUrl } from "../../../src/lib/services/repoFetcher";
import { runRepoImportInWorker } from "../../../src/lib/services/repoImportWorkerClient";

type PostBody = { url: string };

const DEV_USER_ID = "dev-push-project";

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    const db = getDb();

    // Fix #1: Filter in SQL to avoid scanning all users' data
    const rows = db.prepare(`
      SELECT 
        user_id,
        repo_id,
        MIN(url) as url,
        MIN(name) as name,
        MIN(owner) as owner,
        MIN(created_at) as created_at,
        MAX(updated_at) as updated_at,
        COUNT(*) as total_files,
        SUM(CASE WHEN parse_status = 'success' THEN 1 ELSE 0 END) as parsed_files,
        SUM(CASE WHEN parse_status = 'failed' THEN 1 ELSE 0 END) as failed_files
      FROM repos
      WHERE repo_id IS NOT NULL
        AND (user_id = ? OR user_id = ?)
      GROUP BY user_id, repo_id
    `).all(userId ?? "__no_user__", DEV_USER_ID) as Array<{
      user_id: string;
      repo_id: string;
      url: string;
      name: string;
      owner: string;
      created_at: string;
      updated_at: string;
      total_files: number;
      parsed_files: number;
      failed_files: number;
    }>;

    const list = rows.map((g) => ({
      id: String(g.repo_id),
      url: g.url,
      name: g.name,
      owner: g.owner,
      status: "completed",
      progress: {
        totalFiles: g.total_files || 0,
        parsedFiles: g.parsed_files || 0,
        failedFiles: g.failed_files || 0,
      },
      createdAt: g.created_at,
      updatedAt: g.updated_at,
    }));

    return NextResponse.json({ repos: list });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    // Fix #2: Only allow x-user-id header override in development
    const headerUserId =
      process.env.NODE_ENV !== "production"
        ? req.headers.get("x-user-id") || undefined
        : undefined;

    const effectiveUserId = userId ?? headerUserId;
    if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await req.json()) as PostBody;
    if (!body?.url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const { owner, name } = parseGithubUrl(body.url);

    let clonedDir: string | undefined;
    try {
      const cloned = await cloneGithubRepo(body.url);
      clonedDir = cloned.dir;
      const repoId = generateId();
      const { result } = runRepoImportInWorker({
        userId: effectiveUserId as string,
        repoId,
        url: body.url,
        owner,
        name,
        rootDir: cloned.dir,
      });
      const progress = await result;
      return NextResponse.json({ id: String(repoId), owner, name, url: body.url, progress });
    } catch (err) {
      return NextResponse.json({ owner, name, url: body.url, status: "failed", error: String(err) }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
