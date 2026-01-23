export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import fs from 'node:fs/promises';
import { auth } from "@clerk/nextjs/server";
import { getDb, generateId } from "@/src/lib/sqlite";
import { cloneGithubRepo, parseGithubUrl } from "@/src/lib/services/repoFetcher";
import { parseAndPersistRepoWithProgress } from "@/src/lib/services/repoParser";

export type StreamEvent =
    | { type: 'start'; owner: string; name: string; url: string }
    | { type: 'cloning' }
    | { type: 'cloned'; fileCount: number }
    | { type: 'scanning' }
    | { type: 'discovered'; files: string[]; ignoredFiles: string[] }
    | { type: 'processing'; file: string; index: number; total: number }
    | { type: 'ignored'; file: string; reason: string }
    | { type: 'parsed'; file: string; success: boolean; error?: string }
    | { type: 'skipped'; file: string; reason: string }
    | { type: 'limit_exceeded'; limitType: 'files' | 'file_size'; message: string }
    | { type: 'aborted' }
    | { type: 'complete'; repoId: string; totalFiles: number; parsedFiles: number; failedFiles: number; skippedFiles: number }
    | { type: 'error'; message: string }
    | { type: 'cleanup'; success: boolean };

type PostBody = { url: string };

/**
 * Cleanup cloned directory, ignoring errors
 */
async function cleanupDir(dir: string | null): Promise<boolean> {
    if (!dir) return false;
    try {
        await fs.rm(dir, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}

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
    let clonedDir: string | null = null;
    // Abort signal object that can be checked by the parser
    const abortSignal = { aborted: false };

    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: StreamEvent) => {
                // Allow 'aborted' and 'cleanup' through even after abort (for logging/server-side use)
                if (abortSignal.aborted && event.type !== 'aborted' && event.type !== 'cleanup') return;
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch {
                    // Controller may be closed
                }
            };

            try {
                send({ type: 'start', owner, name, url: body.url });

                // Clone repository (includes size check)
                send({ type: 'cloning' });
                const cloned = await cloneGithubRepo(body.url);
                clonedDir = cloned.dir;

                // Get database
                const db = getDb();
                const repoId = generateId();

                // Parse with progress callback, passing abort signal
                const progress = await parseAndPersistRepoWithProgress(db, {
                    userId: effectiveUserId as string,
                    repoId,
                    url: body.url,
                    owner,
                    name,
                    rootDir: cloned.dir,
                    onProgress: send,
                    abortSignal,
                });

                send({
                    type: 'complete',
                    repoId: String(repoId),
                    totalFiles: progress.totalFiles,
                    parsedFiles: progress.parsedFiles,
                    failedFiles: progress.failedFiles,
                    skippedFiles: progress.skippedFiles,
                });
            } catch (err) {
                send({ type: 'error', message: String(err) });
            } finally {
                // Always cleanup cloned directory
                const cleaned = await cleanupDir(clonedDir);
                send({ type: 'cleanup', success: cleaned });
                try {
                    controller.close();
                } catch {
                    // Controller may already be closed
                }
            }
        },
        cancel() {
            // Client aborted the request - signal to stop work
            abortSignal.aborted = true;
            // Cleanup will happen in the finally block
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
