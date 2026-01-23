export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { auth } from "@clerk/nextjs/server";
import { parseGithubUrl } from "@/src/lib/services/repoFetcher";
import { createImportJob, getImportJobsByUser } from "@/src/lib/services/importJobService";
import { startNextJob } from "@/src/lib/services/backgroundImporter";

type PostBody = { url: string };

/**
 * POST /api/jobs - Create a new background import job
 */
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

    // Validate URL before creating job
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

    // Create the job
    const job = createImportJob({
        userId: effectiveUserId,
        url: body.url,
        owner,
        name,
    });

    // Start processing in background (fire and forget)
    startNextJob();

    return new Response(JSON.stringify({
        id: job.id,
        status: job.status,
        owner: job.owner,
        name: job.name,
        createdAt: job.createdAt,
    }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
    });
}

/**
 * GET /api/jobs - List user's import jobs
 */
export async function GET(req: Request) {
    const { userId } = await auth();
    const headerUserId = req.headers.get("x-user-id") || undefined;
    const effectiveUserId = userId ?? headerUserId;

    if (!effectiveUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

    const jobs = getImportJobsByUser(effectiveUserId, limit);

    return new Response(JSON.stringify({ jobs }), {
        headers: { "Content-Type": "application/json" },
    });
}
