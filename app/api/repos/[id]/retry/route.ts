import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/src/lib/mongodb";
import { parseWithTreeSitter } from "@/src/lib/parser/treeSitterServer";
import { ObjectId } from "mongodb";

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { userId } = await auth();
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    let repoId: ObjectId;
    try {
        repoId = new ObjectId(id);
    } catch {
        return Response.json({ error: "Invalid repo ID" }, { status: 400 });
    }

    const db = await getDb();
    const reposCol = db.collection("repos");

    // Find all failed files for this repo belonging to this user
    const failedFiles = await reposCol
        .find({
            repoId,
            userId,
            parseStatus: "failed",
        })
        .toArray();

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

    for (const file of failedFiles) {
        const { sourceCode, extension, path: filePath, _id } = file;

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
            const now = new Date();

            await reposCol.updateOne(
                { _id },
                {
                    $set: {
                        language: parsed.languageId,
                        ast: parsed.ast,
                        parseStatus: "success",
                        parseError: null,
                        updatedAt: now,
                    },
                    $unset: { parseError: "" },
                }
            );
            succeeded++;
        } catch (err) {
            stillFailed++;
            const errorMsg = String(err);
            errors.push({ path: filePath, error: errorMsg });

            // Update with new error message
            await reposCol.updateOne(
                { _id },
                {
                    $set: {
                        parseError: errorMsg,
                        updatedAt: new Date(),
                    },
                }
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
