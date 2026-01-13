export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb, fromJson, toDbDate } from "@/src/lib/sqlite";
import { cancelRunController } from "@/src/lib/distractorRunRegistry";

type RunDoc = {
  id: string;
  user_id: string;
  quiz_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  updated_cards?: string | null;
  failures?: string | null;
  skipped: number;
  provider?: string | null;
  model?: string | null;
  batch_size?: number | null;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

const STALE_RUN_MS = 15 * 60 * 1000;

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseJsonArray = <T,>(value: string | null | undefined): T[] => {
  const parsed = fromJson<T[]>(value);
  return Array.isArray(parsed) ? parsed : [];
};

const serializeRun = (run: RunDoc) => ({
  runId: run.id,
  quizId: run.quiz_id,
  status: run.status,
  total: toNumber(run.total),
  completed: toNumber(run.completed),
  failed: toNumber(run.failed),
  updatedCards: parseJsonArray<number>(run.updated_cards),
  failures: parseJsonArray<{ order: number; error: string }>(run.failures),
  skipped: toNumber(run.skipped),
  provider: run.provider || undefined,
  model: run.model || undefined,
  batchSize: toNumber(run.batch_size),
  errorMessage: run.error_message || undefined,
  startedAt: run.started_at || undefined,
  updatedAt: run.updated_at || undefined,
  completedAt: run.completed_at || undefined,
});

const parseRunDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getRunLastUpdate = (run: RunDoc) =>
  parseRunDate(run.updated_at) ||
  parseRunDate(run.started_at) ||
  parseRunDate(run.created_at);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const routeParams = await params.catch(() => ({} as { id?: string }));
  const rawId = routeParams?.id || new URL(request.url).searchParams.get("id");
  if (!rawId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const runId = String(rawId);

  const db = getDb();
  let run = db
    .prepare(`SELECT * FROM distractor_runs WHERE id = ? AND user_id = ?`)
    .get(runId, userId) as RunDoc | undefined;
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const lastUpdate = getRunLastUpdate(run);
  const isActive = run.status === "queued" || run.status === "running";
  if (isActive && lastUpdate) {
    const ageMs = Date.now() - lastUpdate.getTime();
    if (ageMs > STALE_RUN_MS) {
      cancelRunController(runId);
      const now = toDbDate(new Date());
      db.prepare(`
        UPDATE distractor_runs
        SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        "failed",
        "Distractor run timed out. Please retry.",
        now,
        now,
        runId,
        userId
      );
      run = db
        .prepare(`SELECT * FROM distractor_runs WHERE id = ? AND user_id = ?`)
        .get(runId, userId) as RunDoc | undefined;
      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
    }
  }

  return NextResponse.json(serializeRun(run));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const routeParams = await params.catch(() => ({} as { id?: string }));
  const rawId = routeParams?.id || new URL(request.url).searchParams.get("id");
  if (!rawId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const runId = String(rawId);

  const body = await request.json().catch(() => ({}));
  if (body?.action !== "cancel") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const db = getDb();
  const run = db
    .prepare(`SELECT * FROM distractor_runs WHERE id = ? AND user_id = ?`)
    .get(runId, userId) as RunDoc | undefined;
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return NextResponse.json(serializeRun(run));
  }

  cancelRunController(runId);
  const now = toDbDate(new Date());
  db.prepare(`
    UPDATE distractor_runs
    SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND user_id = ?
  `).run("cancelled", "Cancelled by user.", now, now, runId, userId);

  const updated = db
    .prepare(`SELECT * FROM distractor_runs WHERE id = ? AND user_id = ?`)
    .get(runId, userId) as RunDoc | undefined;
  if (!updated) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(serializeRun(updated));
}
