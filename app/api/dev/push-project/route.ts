export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";

/**
 * DEV-ONLY endpoint to push test projects to MongoDB without authentication.
 * Will refuse to run in production (NODE_ENV === 'production').
 * 
 * Usage:
 *   curl -X POST http://localhost:3000/api/dev/push-project \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *       "name": "my-test-project",
 *       "files": [
 *         {"path": "main.py", "sourceCode": "print(\"hello\")"},
 *         {"path": "utils.py", "sourceCode": "def add(a, b): return a + b"}
 *       ]
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

        const projectId = new ObjectId();
        const now = new Date();
        const devUserId = "dev-push-project"; // Fake userId for dev-pushed files

        const docs = body.files.map((f) => {
            const inferred = inferLanguageAndExtension(f.path);
            return {
                userId: devUserId,
                repoId: null,
                projectId,
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
            name: body.name,
            filesInserted: docs.length,
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
