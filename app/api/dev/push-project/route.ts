export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, generateId, toDbDate } from "../../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

/**
 * DEV-ONLY endpoint to push test files to a shared "tests" project in SQLite.
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

        const db = getDb();

        // Try to get the authenticated user's ID so quiz saves work
        let devUserId: string;
        try {
            const { userId: clerkUserId } = await auth();
            devUserId = clerkUserId || "dev-push-project";
        } catch {
            devUserId = "dev-push-project";
        }

        // Find an existing project by name or create a new projectId
        const existingFile = db.prepare(`
            SELECT project_id FROM files WHERE project_name = ? LIMIT 1
        `).get(body.name) as { project_id: string } | undefined;

        const projectId = existingFile?.project_id || generateId();
        const isNewProject = !existingFile;

        // Check for duplicate file paths within this project
        const requestedPaths = body.files.map(f => f.path);
        const placeholders = requestedPaths.map(() => '?').join(',');
        const existingPaths = db.prepare(`
            SELECT path FROM files WHERE project_id = ? AND path IN (${placeholders})
        `).all(projectId, ...requestedPaths) as Array<{ path: string }>;

        if (existingPaths.length > 0) {
            const duplicates = existingPaths.map(d => d.path);
            return NextResponse.json(
                {
                    error: "Duplicate file(s) already exist in project",
                    duplicates
                },
                { status: 409 }
            );
        }

        const now = toDbDate(new Date());
        const insertStmt = db.prepare(`
            INSERT INTO files (
                id, user_id, repo_id, project_id, project_name, path,
                language, extension, source_code, ast, size, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((files: FileInput[]) => {
            for (const f of files) {
                const inferred = inferLanguageAndExtension(f.path);
                insertStmt.run(
                    generateId(),
                    devUserId,
                    null, // repoId
                    projectId,
                    body.name,
                    f.path,
                    f.language || inferred.language,
                    f.extension || inferred.extension,
                    f.sourceCode,
                    null, // ast
                    Buffer.from(f.sourceCode, "utf8").length,
                    now,
                    now
                );
            }
        });

        insertMany(body.files);

        return NextResponse.json({
            ok: true,
            projectId: String(projectId),
            projectName: body.name,
            filesInserted: body.files.length,
            isNewProject,
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
