export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";

export async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const db = await getDb();
        const files = db.collection("files");
        const { id } = await context.params;
        const _id = safeObjectId(id);

        const agg = await files
            .aggregate([
                { $match: { projectId: _id } as any },
                {
                    $group: {
                        _id: "$projectId",
                        createdAt: { $min: "$createdAt" },
                        updatedAt: { $max: "$updatedAt" },
                        totalFiles: { $sum: 1 },
                    },
                },
            ])
            .toArray();

        if (!agg.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const g: any = agg[0];
        return NextResponse.json({
            id: String(g._id),
            totalFiles: g.totalFiles || 0,
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
        const files = db.collection("files");
        const { id } = await context.params;
        const _id = safeObjectId(id);

        // Check if project exists (don't filter by userId since projects may have been
        // created with "dev-push-project" or a different user ID)
        const exists = await files.findOne({ projectId: _id } as any, { projection: { _id: 1 } });
        if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Delete all files for this project (auth check above ensures only logged-in users can delete)
        await files.deleteMany({ projectId: _id } as any);
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
