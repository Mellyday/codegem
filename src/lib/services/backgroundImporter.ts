/**
 * Background Importer - Processes import jobs with resource throttling
 */
import path from "node:path";
import fs from "node:fs/promises";
import { getDb, generateId, toDbDate, toJson } from "../sqlite";
import { cloneGithubRepo, parseGithubUrl } from "./repoFetcher";
import { parseWithTreeSitter, canParseWithTreeSitter, type TreeSitterAstNode } from "../parser/treeSitterServer";
import { BACKGROUND_LIMITS, isFileTooLarge, formatBytes } from "./importLimits";
import {
    type ImportJob,
    getNextPendingJob,
    hasActiveJob,
    updateJobStatus,
    updateJobProgress,
    cancelImportJob,
} from "./importJobService";

// Track active processing to allow cancellation
const activeJobs = new Map<string, { cancelled: boolean }>();

/**
 * Check if a job has been cancelled
 */
export function isJobCancelled(jobId: string): boolean {
    const state = activeJobs.get(jobId);
    return state?.cancelled ?? false;
}

/**
 * Request cancellation of an active job
 */
export function requestJobCancellation(jobId: string): void {
    const state = activeJobs.get(jobId);
    if (state) {
        state.cancelled = true;
    }
}

// Walk directory recursively
const isHidden = (p: string) => /(^|\/)\./.test(p);

async function* walk(dir: string): AsyncGenerator<string> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === ".git" || isHidden(entry.name)) continue;
            yield* walk(full);
        } else if (entry.isFile()) {
            if (isHidden(entry.name)) continue;
            yield full;
        }
    }
}

function fileExtension(filePath: string): string {
    return path.extname(filePath).replace(/^\./, "").toLowerCase();
}

function relativePath(root: string, filePath: string): string {
    return path.relative(root, filePath).replaceAll(path.sep, "/");
}

/**
 * Clean up cloned directory
 */
async function cleanupCloneDir(dir: string | null): Promise<void> {
    if (!dir) return;
    try {
        await fs.rm(dir, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors
    }
}

/**
 * Process a single import job with resource throttling
 */
export async function processImportJob(job: ImportJob): Promise<void> {
    const jobState = { cancelled: false };
    activeJobs.set(job.id, jobState);

    let cloneDir: string | null = null;

    try {
        // Update status to cloning
        updateJobStatus(job.id, "cloning", { startedAt: new Date() });

        // Clone repository
        const cloned = await cloneGithubRepo(job.url);
        cloneDir = cloned.dir;

        updateJobStatus(job.id, "processing", { cloneDir });

        // Check for cancellation
        if (jobState.cancelled) {
            updateJobStatus(job.id, "cancelled", { completedAt: new Date() });
            return;
        }

        // Discover parsable files
        const parsableFiles: string[] = [];
        for await (const p of walk(cloneDir)) {
            const ext = fileExtension(p);
            if (canParseWithTreeSitter(ext)) {
                parsableFiles.push(relativePath(cloneDir, p));
            }
        }

        // Create repo entry
        const db = getDb();
        const repoId = generateId();

        updateJobStatus(job.id, "processing", {
            repoId,
            totalFiles: parsableFiles.length,
        });

        // Prepare insert statement
        const insertStmt = db.prepare(`
      INSERT INTO repos (
        id, user_id, repo_id, project_id, url, owner, name, path,
        language, extension, source_code, ast, parse_status, parse_error,
        size, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

        let parsedFiles = 0;
        let failedFiles = 0;
        let skippedFiles = 0;

        // Process files in batches with throttling
        const { BATCH_SIZE, BATCH_DELAY_MS } = BACKGROUND_LIMITS;

        for (let i = 0; i < parsableFiles.length; i++) {
            // Check for cancellation at batch boundaries
            if (jobState.cancelled) {
                updateJobStatus(job.id, "cancelled", { completedAt: new Date() });
                return;
            }

            if (i > 0 && i % BATCH_SIZE === 0) {
                // Update progress
                updateJobProgress(job.id, {
                    parsedFiles,
                    failedFiles,
                    skippedFiles,
                    currentIndex: i,
                });

                // Throttle
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }

            const relPath = parsableFiles[i];
            const absPath = path.join(cloneDir, relPath);
            const ext = fileExtension(absPath);
            const now = toDbDate(new Date());

            // Update current file
            updateJobProgress(job.id, {
                parsedFiles,
                failedFiles,
                skippedFiles,
                currentFile: relPath,
                currentIndex: i,
            });

            // Check file size
            try {
                const stats = await fs.stat(absPath);
                if (isFileTooLarge(stats.size)) {
                    skippedFiles++;
                    continue;
                }
            } catch {
                // Continue if stat fails
            }

            // Parse and insert
            try {
                const sourceCode = await fs.readFile(absPath, "utf8");
                const parsed = await parseWithTreeSitter(sourceCode, ext);

                insertStmt.run(
                    generateId(),
                    job.userId,
                    repoId,
                    null,
                    job.url,
                    job.owner,
                    job.name,
                    relPath,
                    parsed.languageId,
                    ext,
                    sourceCode,
                    toJson(parsed.ast as TreeSitterAstNode),
                    "success",
                    null,
                    Buffer.byteLength(sourceCode, "utf8"),
                    now,
                    now
                );
                parsedFiles++;
            } catch (err) {
                failedFiles++;
                // Still insert the file with error status
                const failedSource = await fs.readFile(absPath, "utf8").catch(() => "");
                insertStmt.run(
                    generateId(),
                    job.userId,
                    repoId,
                    null,
                    job.url,
                    job.owner,
                    job.name,
                    relPath,
                    "unknown",
                    ext,
                    failedSource,
                    null,
                    "failed",
                    String(err),
                    Buffer.byteLength(failedSource, "utf8"),
                    now,
                    now
                );
            }
        }

        // Final progress update
        updateJobProgress(job.id, {
            parsedFiles,
            failedFiles,
            skippedFiles,
            currentFile: undefined,
            currentIndex: parsableFiles.length,
        });

        // Mark complete
        updateJobStatus(job.id, "complete", { completedAt: new Date() });

    } catch (err) {
        updateJobStatus(job.id, "failed", {
            error: String(err),
            completedAt: new Date(),
        });
    } finally {
        activeJobs.delete(job.id);
        await cleanupCloneDir(cloneDir);
    }
}

/**
 * Start processing the next pending job (if any and not at capacity)
 * Call this after creating a new job to kick off processing
 */
export async function startNextJob(): Promise<void> {
    if (hasActiveJob()) {
        return; // Already processing
    }

    const nextJob = getNextPendingJob();
    if (!nextJob) {
        return; // No pending jobs
    }

    // Process in background (fire and forget)
    processImportJob(nextJob).catch(err => {
        console.error("Background import job failed:", err);
    });
}
