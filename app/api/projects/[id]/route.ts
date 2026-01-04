export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "../../../../src/lib/sqlite";

export async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const db = getDb();
        const { id } = await context.params;

        const row = db.prepare(`
            SELECT 
                project_id,
                MIN(created_at) as created_at,
                MAX(updated_at) as updated_at,
                COUNT(*) as total_files
            FROM files
            WHERE project_id = ?
            GROUP BY project_id
        `).get(id) as {
            project_id: string;
            created_at: string;
            updated_at: string;
            total_files: number;
        } | undefined;

        if (!row) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        return NextResponse.json({
            id: String(row.project_id),
            totalFiles: row.total_files || 0,
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

        // Check if project exists
        const exists = db.prepare(`
            SELECT project_id FROM files WHERE project_id = ? LIMIT 1
        `).get(id) as { project_id: string } | undefined;

        if (!exists) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        // Delete all files for this project
        db.prepare(`DELETE FROM files WHERE project_id = ?`).run(id);

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
