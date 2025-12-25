export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/src/lib/mongodb";
import { cloneGithubRepo, parseGithubUrl } from "@/src/lib/services/repoFetcher";
import { parseAndPersistRepoWithProgress } from "@/src/lib/services/repoParser";
import { ObjectId } from "mongodb";

export type StreamEvent =
    | { type: 'start'; owner: string; name: string; url: string }
    | { type: 'cloning' }
    | { type: 'cloned'; fileCount: number }
    | { type: 'scanning' }
    | { type: 'discovered'; files: string[]; ignoredFiles: string[] }
    | { type: 'processing'; file: string; index: number; total: number }
    | { type: 'ignored'; file: string; reason: string }
    | { type: 'parsed'; file: string; success: boolean; error?: string }
    | { type: 'complete'; repoId: string; totalFiles: number; parsedFiles: number; failedFiles: number }
    | { type: 'error'; message: string };

type PostBody = { url: string };

export async function POST(req: Request) {
    const { userId } = await auth();
    const headerUserId = req.headers.get("x-user-id") || undefined;
    const effectiveUserId = userId ?? headerUserId;

    if (!effectiveUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    let body: PostBody;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (!body?.url) {
        return new Response(JSON.stringify({ error: "Missing url" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Validate URL before starting stream
    let owner: string;
    let name: string;
    try {
        const parsed = parseGithubUrl(body.url);
        owner = parsed.owner;
        name = parsed.name;
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: StreamEvent) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };

            try {
                send({ type: 'start', owner, name, url: body.url });

                // Clone repository
                send({ type: 'cloning' });
                const cloned = await cloneGithubRepo(body.url);

                // Get database
                const db = await getDb();
                const repoId = new ObjectId();

                // Parse with progress callback
                const progress = await parseAndPersistRepoWithProgress(db, {
                    userId: effectiveUserId as string,
                    repoId,
                    url: body.url,
                    owner,
                    name,
                    rootDir: cloned.dir,
                    onProgress: send,
                });

                send({
                    type: 'complete',
                    repoId: String(repoId),
                    totalFiles: progress.totalFiles,
                    parsedFiles: progress.parsedFiles,
                    failedFiles: progress.failedFiles,
                });
            } catch (err) {
                send({ type: 'error', message: String(err) });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}
