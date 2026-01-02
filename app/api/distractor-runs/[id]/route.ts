export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/src/lib/mongodb";
import { cancelRunController } from "@/src/lib/distractorRunRegistry";

type RunDoc = {
  _id: ObjectId;
  userId: string;
  quizId: ObjectId;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  failed: number;
  updatedCards: number[];
  failures: Array<{ order: number; error: string }>;
  skipped: number;
  provider: string;
  model: string;
  batchSize: number;
  errorMessage?: string;
  createdAt?: Date;
  startedAt?: Date;
  updatedAt?: Date;
  completedAt?: Date;
};

const STALE_RUN_MS = 15 * 60 * 1000;

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const serializeRun = (run: RunDoc) => ({
  runId: String(run._id),
  quizId: String(run.quizId),
  status: run.status,
  total: toNumber(run.total),
  completed: toNumber(run.completed),
  failed: toNumber(run.failed),
  updatedCards: run.updatedCards || [],
  failures: run.failures || [],
  skipped: toNumber(run.skipped),
  provider: run.provider,
  model: run.model,
  batchSize: toNumber(run.batchSize),
  errorMessage: run.errorMessage,
  startedAt: run.startedAt,
  updatedAt: run.updatedAt,
  completedAt: run.completedAt,
});

const getRunLastUpdate = (run: RunDoc) =>
  run.updatedAt || run.startedAt || run.createdAt;

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

  let runId: ObjectId;
  try {
    runId = new ObjectId(String(rawId));
  } catch {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const db = await getDb();
  const runs = db.collection<RunDoc>("distractorRuns");
  let run = await runs.findOne({ _id: runId, userId });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const lastUpdate = getRunLastUpdate(run);
  const isActive = run.status === "queued" || run.status === "running";
  if (isActive && lastUpdate) {
    const ageMs = Date.now() - lastUpdate.getTime();
    if (ageMs > STALE_RUN_MS) {
      cancelRunController(String(runId));
      await runs.updateOne(
        { _id: runId, userId },
        {
          $set: {
            status: "failed",
            errorMessage: "Distractor run timed out. Please retry.",
            updatedAt: new Date(),
            completedAt: new Date(),
          },
        }
      );
      run = await runs.findOne({ _id: runId, userId });
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

  let runId: ObjectId;
  try {
    runId = new ObjectId(String(rawId));
  } catch {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.action !== "cancel") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const db = await getDb();
  const runs = db.collection<RunDoc>("distractorRuns");
  const run = await runs.findOne({ _id: runId, userId });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return NextResponse.json(serializeRun(run));
  }

  cancelRunController(String(runId));

  await runs.updateOne(
    { _id: runId, userId },
    {
      $set: {
        status: "cancelled",
        errorMessage: "Cancelled by user.",
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    }
  );

  const updated = await runs.findOne({ _id: runId, userId });
  if (!updated) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json(serializeRun(updated));
}
