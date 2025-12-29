export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";

const DEV_USER_ID = "dev-push-project";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();

    // Build user filter: allow access to own repos + dev repos
    const userFilter = userId
      ? { userId: { $in: [userId, DEV_USER_ID] } }
      : { userId: DEV_USER_ID };

    const db = await getDb();
    const repos = db.collection("repos");
    const { id } = await context.params;
    const _id = safeObjectId(id);

    const agg = await repos
      .aggregate([
        // Filter by user: only show user's own repos + dev repos
        { $match: { repoId: _id, ...userFilter } as any },
        {
          $group: {
            _id: "$repoId",
            url: { $first: "$url" },
            name: { $first: "$name" },
            owner: { $first: "$owner" },
            createdAt: { $min: "$createdAt" },
            updatedAt: { $max: "$updatedAt" },
            totalFiles: { $sum: 1 },
            parsedFiles: { $sum: { $cond: [{ $eq: ["$parseStatus", "success"] }, 1, 0] } },
            failedFiles: { $sum: { $cond: [{ $eq: ["$parseStatus", "failed"] }, 1, 0] } },
          },
        },
      ])
      .toArray();

    if (!agg.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const g: any = agg[0];
    return NextResponse.json({
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
    const db = await getDb();
    const repos = db.collection("repos");
    const { id } = await context.params;
    const _id = safeObjectId(id);

    // Check if repo exists AND belongs to the user (or is a dev repo)
    const userFilter = { userId: { $in: [userId, DEV_USER_ID] } };
    const exists = await repos.findOne({ repoId: _id, ...userFilter } as any, { projection: { _id: 1 } });
    if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Delete all files for this repo (only if user owns it per check above)
    await repos.deleteMany({ repoId: _id, ...userFilter } as any);
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
