/**
 * Import limits configuration to prevent resource exhaustion from large repositories.
 * These values can be adjusted based on server capacity.
 */

export type ImportMode = "streaming" | "background";

/** Streaming mode: no limits after optimization */
export const STREAMING_LIMITS = {
    /** No file count limit (null = no limit) */
    MAX_FILES: null as number | null,
    /** No file size limit */
    MAX_FILE_SIZE_KB: Infinity,
    /** No repo size limit */
    MAX_REPO_SIZE_MB: Infinity,
    /** Files per processing batch */
    BATCH_SIZE: 50,
    /** Delay between batches (ms) */
    BATCH_DELAY_MS: 10,
} as const;

/** Background mode: large repos, resource-friendly throttling */
export const BACKGROUND_LIMITS = {
    /** No file count limit (null = no limit) */
    MAX_FILES: null as number | null,
    /** Same per-file size limit as streaming */
    MAX_FILE_SIZE_KB: 500,
    /** Allow larger repos for background (MB) */
    MAX_REPO_SIZE_MB: 500,
    /** Smaller batches to reduce memory spikes */
    BATCH_SIZE: 10,
    /** Longer delay to yield CPU (ms) */
    BATCH_DELAY_MS: 500,
    /** Max concurrent background jobs */
    MAX_CONCURRENT_JOBS: 1,
} as const;

/** Helper to get limits for a given mode */
export function getLimitsForMode(mode: ImportMode) {
    return mode === "streaming" ? STREAMING_LIMITS : BACKGROUND_LIMITS;
}

/**
 * Format file size for display
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a repository size exceeds the limit for the given mode
 */
export function isRepoTooLarge(sizeKB: number, mode: ImportMode = "streaming"): boolean {
    const limits = getLimitsForMode(mode);
    return sizeKB > limits.MAX_REPO_SIZE_MB * 1024;
}

/**
 * Check if a file size exceeds the limit (same for both modes)
 */
export function isFileTooLarge(sizeBytes: number): boolean {
    return sizeBytes > STREAMING_LIMITS.MAX_FILE_SIZE_KB * 1024;
}

/**
 * Check if file count exceeds the limit for the given mode
 */
export function isTooManyFiles(count: number, mode: ImportMode = "streaming"): boolean {
    const limits = getLimitsForMode(mode);
    // null means no limit (background mode)
    if (limits.MAX_FILES === null) return false;
    return count > limits.MAX_FILES;
}
