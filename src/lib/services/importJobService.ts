/**
 * Import Job Service - Manages background import job lifecycle
 */
import { getDb, generateId, toDbDate } from "../sqlite";

export type ImportJobStatus =
    | "pending"
    | "cloning"
    | "processing"
    | "complete"
    | "failed"
    | "cancelled";

export type ImportJob = {
    id: string;
    userId: string;
    url: string;
    owner: string;
    name: string;
    status: ImportJobStatus;
    cloneDir: string | null;
    repoId: string | null;
    totalFiles: number;
    parsedFiles: number;
    failedFiles: number;
    skippedFiles: number;
    currentFile: string | null;
    currentIndex: number;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
};

type DbRow = {
    id: string;
    user_id: string;
    url: string;
    owner: string;
    name: string;
    status: string;
    clone_dir: string | null;
    repo_id: string | null;
    total_files: number;
    parsed_files: number;
    failed_files: number;
    skipped_files: number;
    current_file: string | null;
    current_index: number;
    error: string | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
};

function rowToJob(row: DbRow): ImportJob {
    return {
        id: row.id,
        userId: row.user_id,
        url: row.url,
        owner: row.owner,
        name: row.name,
        status: row.status as ImportJobStatus,
        cloneDir: row.clone_dir,
        repoId: row.repo_id,
        totalFiles: row.total_files,
        parsedFiles: row.parsed_files,
        failedFiles: row.failed_files,
        skippedFiles: row.skipped_files,
        currentFile: row.current_file,
        currentIndex: row.current_index,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}

/**
 * Create a new import job
 */
export function createImportJob(params: {
    userId: string;
    url: string;
    owner: string;
    name: string;
}): ImportJob {
    const db = getDb();
    const id = generateId();
    const now = toDbDate(new Date());

    db.prepare(`
    INSERT INTO import_jobs (
      id, user_id, url, owner, name, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, params.userId, params.url, params.owner, params.name, now, now);

    return getImportJob(id)!;
}

/**
 * Get job by ID
 */
export function getImportJob(id: string): ImportJob | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(id) as DbRow | undefined;
    return row ? rowToJob(row) : null;
}

/**
 * Get jobs by user
 */
export function getImportJobsByUser(userId: string, limit = 20): ImportJob[] {
    const db = getDb();
    const rows = db.prepare(`
    SELECT * FROM import_jobs 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(userId, limit) as DbRow[];
    return rows.map(rowToJob);
}

/**
 * Get next pending job (for worker)
 */
export function getNextPendingJob(): ImportJob | null {
    const db = getDb();
    const row = db.prepare(`
    SELECT * FROM import_jobs 
    WHERE status = 'pending' 
    ORDER BY created_at ASC 
    LIMIT 1
  `).get() as DbRow | undefined;
    return row ? rowToJob(row) : null;
}

/**
 * Check if there's an active job (to enforce max concurrent = 1)
 */
export function hasActiveJob(): boolean {
    const db = getDb();
    const row = db.prepare(`
    SELECT 1 FROM import_jobs 
    WHERE status IN ('cloning', 'processing') 
    LIMIT 1
  `).get();
    return !!row;
}

/**
 * Update job status
 */
export function updateJobStatus(
    id: string,
    status: ImportJobStatus,
    extra?: Partial<{
        cloneDir: string;
        repoId: string;
        totalFiles: number;
        error: string;
        startedAt: Date;
        completedAt: Date;
    }>
): void {
    const db = getDb();
    const now = toDbDate(new Date());

    const updates: string[] = ["status = ?", "updated_at = ?"];
    const values: unknown[] = [status, now];

    if (extra?.cloneDir !== undefined) {
        updates.push("clone_dir = ?");
        values.push(extra.cloneDir);
    }
    if (extra?.repoId !== undefined) {
        updates.push("repo_id = ?");
        values.push(extra.repoId);
    }
    if (extra?.totalFiles !== undefined) {
        updates.push("total_files = ?");
        values.push(extra.totalFiles);
    }
    if (extra?.error !== undefined) {
        updates.push("error = ?");
        values.push(extra.error);
    }
    if (extra?.startedAt) {
        updates.push("started_at = ?");
        values.push(toDbDate(extra.startedAt));
    }
    if (extra?.completedAt) {
        updates.push("completed_at = ?");
        values.push(toDbDate(extra.completedAt));
    }

    values.push(id);
    db.prepare(`UPDATE import_jobs SET ${updates.join(", ")} WHERE id = ?`).run(...values);
}

/**
 * Update job progress (called after each batch)
 */
export function updateJobProgress(
    id: string,
    progress: {
        parsedFiles: number;
        failedFiles: number;
        skippedFiles: number;
        currentFile?: string;
        currentIndex: number;
    }
): void {
    const db = getDb();
    const now = toDbDate(new Date());

    db.prepare(`
    UPDATE import_jobs SET
      parsed_files = ?,
      failed_files = ?,
      skipped_files = ?,
      current_file = ?,
      current_index = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
        progress.parsedFiles,
        progress.failedFiles,
        progress.skippedFiles,
        progress.currentFile ?? null,
        progress.currentIndex,
        now,
        id
    );
}

/**
 * Cancel a job (if pending or processing)
 */
export function cancelImportJob(id: string): boolean {
    const db = getDb();
    const now = toDbDate(new Date());

    const result = db.prepare(`
    UPDATE import_jobs 
    SET status = 'cancelled', updated_at = ?, completed_at = ?
    WHERE id = ? AND status IN ('pending', 'cloning', 'processing')
  `).run(now, now, id);

    return result.changes > 0;
}
