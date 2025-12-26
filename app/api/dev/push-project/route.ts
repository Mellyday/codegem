export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";

/**
 * DEV-ONLY endpoint to push test files to a shared "tests" project in MongoDB.
 * Will refuse to run in production (NODE_ENV === 'production').
 * 
 * - All files go to the same "tests" project (reuses existing projectId if found)
 * - Rejects duplicate file paths within the project
 * - Project is labeled "tests" (not "Project {hash}")
 * 
 * Usage:
 *   curl -X POST http://localhost:3010/api/dev/push-project \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "name": "tests",
 *       "files": [{"path": "my_script.py", "sourceCode": "print(\"hello\")"}]
 *     }'
 */

type FileInput = {
    path: string;
    sourceCode: string;
    language?: string;
    extension?: string;
};

type RequestBody = {
    name: string;
    files: FileInput[];
};

function inferLanguageAndExtension(path: string): { language: string; extension: string } {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
        py: "python",
        js: "javascript",
        ts: "typescript",
        tsx: "typescriptreact",
        jsx: "javascriptreact",
        json: "json",
        md: "markdown",
        css: "css",
        html: "html",
        sql: "sql",
        sh: "bash",
        yaml: "yaml",
        yml: "yaml",
    };
    return {
        extension: ext,
        language: langMap[ext] || "plaintext",
    };
}

export async function POST(request: Request) {
    // Block in production
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
            { error: "This endpoint is disabled in production" },
            { status: 403 }
        );
    }

    try {
        const body = (await request.json()) as RequestBody;

        if (!body.name || typeof body.name !== "string") {
            return NextResponse.json({ error: "Missing 'name' field" }, { status: 400 });
        }
        if (!Array.isArray(body.files) || body.files.length === 0) {
            return NextResponse.json({ error: "Missing or empty 'files' array" }, { status: 400 });
        }

        const db = await getDb();
        const files = db.collection("files");

        // Try to get the authenticated user's ID so quiz saves work
        let devUserId: string;
        try {
            const { userId: clerkUserId } = await auth();
            devUserId = clerkUserId || "dev-push-project";
        } catch {
            devUserId = "dev-push-project";
        }

        // Find an existing "tests" project or create a new projectId
        // We identify the "tests" project by looking for files with projectName: "tests"
        const existingFile = await files.findOne(
            { projectName: body.name },
            { projection: { projectId: 1 } }
        );

        const projectId = existingFile?.projectId
            ? existingFile.projectId
            : new ObjectId();

        const isNewProject = !existingFile;

        // Check for duplicate file paths within this project
        const requestedPaths = body.files.map(f => f.path);
        const existingPaths = await files.find(
            { projectId, path: { $in: requestedPaths } },
            { projection: { path: 1 } }
        ).toArray();

        if (existingPaths.length > 0) {
            const duplicates = existingPaths.map((d: any) => d.path);
            return NextResponse.json(
                {
                    error: "Duplicate file(s) already exist in project",
                    duplicates
                },
                { status: 409 }
            );
        }

        const now = new Date();
        const docs = body.files.map((f) => {
            const inferred = inferLanguageAndExtension(f.path);
            return {
                userId: devUserId,
                repoId: null,
                projectId,
                projectName: body.name, // Store project name for labeling
                path: f.path,
                language: f.language || inferred.language,
                extension: f.extension || inferred.extension,
                sourceCode: f.sourceCode,
                ast: null,
                parseStatus: "success" as const,
                size: Buffer.from(f.sourceCode, "utf8").length,
                createdAt: now,
                updatedAt: now,
            };
        });

        await files.insertMany(docs);

        return NextResponse.json({
            ok: true,
            projectId: String(projectId),
            projectName: body.name,
            filesInserted: docs.length,
            isNewProject,
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
