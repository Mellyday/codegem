import { auth } from "@clerk/nextjs/server";
import { getDb, toDbDate, toJson } from "@/src/lib/sqlite";
import { parseWithTreeSitter } from "@/src/lib/parser/treeSitterServer";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: repoId } = await params;
    const db = getDb();

    // Find all failed files for this repo belonging to this user
    const failedFiles = db.prepare(`
        SELECT id, path, source_code, extension
        FROM repos
        WHERE repo_id = ? AND user_id = ? AND parse_status = 'failed'
    `).all(repoId, userId) as Array<{
        id: string;
        path: string;
        source_code: string | null;
        extension: string;
    }>;

    if (failedFiles.length === 0) {
        return Response.json({
            message: "No failed files to retry",
            retried: 0,
            succeeded: 0,
            stillFailed: 0,
        });
    }

    let succeeded = 0;
    let stillFailed = 0;
    const errors: { path: string; error: string }[] = [];

    const updateSuccessStmt = db.prepare(`
        UPDATE repos
        SET language = ?, ast = ?, parse_status = 'success', parse_error = NULL, updated_at = ?
        WHERE id = ?
    `);

    const updateFailedStmt = db.prepare(`
        UPDATE repos
        SET parse_error = ?, updated_at = ?
        WHERE id = ?
    `);

    for (const file of failedFiles) {
        const { source_code: sourceCode, extension, path: filePath, id } = file;

        // Skip if no source code stored (legacy failed files before this fix)
        if (!sourceCode || sourceCode.length === 0) {
            stillFailed++;
            errors.push({
                path: filePath,
                error: "No source code stored - requires re-import",
            });
            continue;
        }

        try {
            const parsed = await parseWithTreeSitter(sourceCode, extension);
            const now = toDbDate(new Date());

            updateSuccessStmt.run(
                parsed.languageId,
                toJson(parsed.ast),
                now,
                id
            );
            succeeded++;
        } catch (err) {
            stillFailed++;
            const errorMsg = String(err);
            errors.push({ path: filePath, error: errorMsg });

            // Update with new error message
            updateFailedStmt.run(
                errorMsg,
                toDbDate(new Date()),
                id
            );
        }
    }

    return Response.json({
        message: `Retried ${failedFiles.length} files`,
        retried: failedFiles.length,
        succeeded,
        stillFailed,
        errors: errors.length > 0 ? errors : undefined,
    });
}
