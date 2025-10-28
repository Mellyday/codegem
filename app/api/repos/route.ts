export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { cloneGithubRepo, parseGithubUrl } from "../../../src/lib/services/repoFetcher";
import { parseAndPersistRepo } from "../../../src/lib/services/repoParser";

type PostBody = { url: string };

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDb();
    const repos = db.collection("repos");
    const cursor = repos
      .find({ userId }, { sort: { createdAt: -1 } })
      .map((r) => ({
        id: String((r as any)._id),
        url: (r as any).url,
        name: (r as any).name,
        owner: (r as any).owner,
        status: (r as any).status,
        progress: (r as any).progress,
        createdAt: (r as any).createdAt,
        updatedAt: (r as any).updatedAt,
      }));
    const list = await cursor.toArray();
    return NextResponse.json({ repos: list });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await req.json()) as PostBody;
    if (!body?.url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const db = await getDb();
    const repos = db.collection("repos");
    const now = new Date();
    const { owner, name } = parseGithubUrl(body.url);

    // Create repo document in pending state
    const insert = await repos.insertOne({
      userId,
      url: body.url,
      name,
      owner,
      status: "pending",
      progress: { totalFiles: 0, parsedFiles: 0, failedFiles: 0 },
      createdAt: now,
      updatedAt: now,
    } as any);
    const repoId = insert.insertedId as ObjectId;

    // Clone and parse synchronously for Phase 1
    await repos.updateOne(
      { _id: repoId },
      { $set: { status: "cloning", updatedAt: new Date() } }
    );

    let clonedDir: string | undefined;
    try {
      const cloned = await cloneGithubRepo(body.url);
      clonedDir = cloned.dir;
      await repos.updateOne(
        { _id: repoId },
        { $set: { status: "parsing", clonedPath: clonedDir, updatedAt: new Date() } }
      );

      const progress = await parseAndPersistRepo(db, repoId, userId, cloned.dir);

      await repos.updateOne(
        { _id: repoId },
        {
          $set: {
            status: "completed",
            progress,
            updatedAt: new Date(),
          },
        }
      );
    } catch (err) {
      await repos.updateOne(
        { _id: repoId },
        {
          $set: {
            status: "failed",
            updatedAt: new Date(),
            error: String(err),
          },
        }
      );
      return NextResponse.json({ id: String(repoId), status: "failed", error: String(err) }, { status: 500 });
    }

    const repo = await repos.findOne({ _id: repoId });
    return NextResponse.json({
      id: String(repoId),
      url: (repo as any)?.url,
      name: (repo as any)?.name,
      owner: (repo as any)?.owner,
      status: (repo as any)?.status,
      progress: (repo as any)?.progress,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

