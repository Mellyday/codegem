export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../src/lib/mongodb";
import { cloneGithubRepo, parseGithubUrl } from "../../../src/lib/services/repoFetcher";
import { parseAndPersistRepo } from "../../../src/lib/services/repoParser";
import { ObjectId } from "mongodb";

type PostBody = { url: string };

export async function GET(req: Request) {
  try {
    const db = await getDb();
    const reposCol = db.collection("repos");
    const pipeline = [
      // Show all repos across all users
      { $match: { repoId: { $ne: null } } },
      {
        $group: {
          _id: "$repoId",
          url: { $first: "$url" },
          name: { $first: "$name" },
          owner: { $first: "$owner" },
          createdAt: { $min: "$createdAt" },
          updatedAt: { $max: "$updatedAt" },
          totalFiles: { $sum: 1 },
          parsedFiles: {
            $sum: { $cond: [{ $eq: ["$parseStatus", "success"] }, 1, 0] },
          },
          failedFiles: {
            $sum: { $cond: [{ $eq: ["$parseStatus", "failed"] }, 1, 0] },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
    ];
    const agg = await reposCol.aggregate(pipeline).toArray();
    const list = agg.map((g: any) => ({
      id: String(g._id),
      url: g.url,
      name: g.name,
      owner: g.owner,
      status: "completed",
      progress: {
        totalFiles: g.totalFiles || 0,
        parsedFiles: g.parsedFiles || 0,
        failedFiles: g.failedFiles || 0,
      },
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
    return NextResponse.json({ repos: list });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    const headerUserId = req.headers.get("x-user-id") || undefined;
    const effectiveUserId = userId ?? headerUserId;
    if (!effectiveUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await req.json()) as PostBody;
    if (!body?.url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const db = await getDb();
    const { owner, name } = parseGithubUrl(body.url);

    let clonedDir: string | undefined;
    try {
      const cloned = await cloneGithubRepo(body.url);
      clonedDir = cloned.dir;
      const repoId = new ObjectId();
      const progress = await parseAndPersistRepo(db, {
        userId: effectiveUserId as string,
        repoId,
        url: body.url,
        owner,
        name,
        rootDir: cloned.dir,
      });
      return NextResponse.json({ id: String(repoId), owner, name, url: body.url, progress });
    } catch (err) {
      return NextResponse.json({ owner, name, url: body.url, status: "failed", error: String(err) }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
