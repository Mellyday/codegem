export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import fs from "node:fs/promises";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDb();
    const repos = db.collection("repos");
    const _id = safeObjectId(params.id);
    const repo = await repos.findOne({ _id, userId } as any);
    if (!repo) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: String((repo as any)._id),
      url: (repo as any).url,
      name: (repo as any).name,
      owner: (repo as any).owner,
      status: (repo as any).status,
      progress: (repo as any).progress,
      clonedPath: (repo as any).clonedPath,
      createdAt: (repo as any).createdAt,
      updatedAt: (repo as any).updatedAt,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDb();
    const repos = db.collection("repos");
    const files = db.collection("files");
    const _id = safeObjectId(params.id);

    const repo = await repos.findOne({ _id, userId } as any);
    if (!repo) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await files.deleteMany({ repoId: _id, userId } as any);
    await repos.deleteOne({ _id, userId } as any);

    // Best-effort cleanup of clonedPath
    const clonedPath = (repo as any).clonedPath as string | undefined;
    if (clonedPath) {
      try {
        await fs.rm(clonedPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function safeObjectId(id: string) {
  try {
    return new ObjectId(id);
  } catch {
    return id as any;
  }
}

