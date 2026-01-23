export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { auth } from "@clerk/nextjs/server";
import { getImportJob, cancelImportJob } from "@/src/lib/services/importJobService";
import { requestJobCancellation } from "@/src/lib/services/backgroundImporter";

type Params = { id: string };

/**
 * GET /api/jobs/[id] - Get job status and progress
 */
export async function GET(
    req: Request,
    { params }: { params: Promise<Params> }
) {
    const { userId } = await auth();
    const headerUserId = req.headers.get("x-user-id") || undefined;
    const effectiveUserId = userId ?? headerUserId;

    if (!effectiveUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { id } = await params;
    const job = getImportJob(id);

    if (!job) {
        return new Response(JSON.stringify({ error: "Job not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Ensure user owns this job
    if (job.userId !== effectiveUserId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({
        id: job.id,
        url: job.url,
        owner: job.owner,
        name: job.name,
        status: job.status,
        repoId: job.repoId,
        totalFiles: job.totalFiles,
        parsedFiles: job.parsedFiles,
        failedFiles: job.failedFiles,
        skippedFiles: job.skippedFiles,
        currentFile: job.currentFile,
        currentIndex: job.currentIndex,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
    }), {
        headers: { "Content-Type": "application/json" },
    });
}

/**
 * DELETE /api/jobs/[id] - Cancel a job
 */
export async function DELETE(
    req: Request,
    { params }: { params: Promise<Params> }
) {
    const { userId } = await auth();
    const headerUserId = req.headers.get("x-user-id") || undefined;
    const effectiveUserId = userId ?? headerUserId;

    if (!effectiveUserId) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { id } = await params;
    const job = getImportJob(id);

    if (!job) {
        return new Response(JSON.stringify({ error: "Job not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (job.userId !== effectiveUserId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Request cancellation in background processor
    requestJobCancellation(id);

    // Update job status in DB
    const cancelled = cancelImportJob(id);

    if (!cancelled) {
        return new Response(JSON.stringify({
            error: "Job cannot be cancelled (already completed or failed)"
        }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({
        id,
        status: "cancelled",
        message: "Job cancellation requested"
    }), {
        headers: { "Content-Type": "application/json" },
    });
}
