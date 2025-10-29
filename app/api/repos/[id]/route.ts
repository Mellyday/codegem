export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const db = await getDb();
    const repos = db.collection("repos");
    const _id = safeObjectId(params.id);

    const agg = await repos
      .aggregate([
        // Allow fetching repo info regardless of owner
        { $match: { repoId: _id } as any },
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
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = await getDb();
    const repos = db.collection("repos");
    const _id = safeObjectId(params.id);

    const exists = await repos.findOne({ userId, repoId: _id } as any, { projection: { _id: 1 } });
    if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await repos.deleteMany({ userId, repoId: _id } as any);
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
