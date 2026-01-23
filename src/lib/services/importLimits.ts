/**
 * Import limits configuration to prevent resource exhaustion from large repositories.
 * These values can be adjusted based on server capacity.
 */
export const IMPORT_LIMITS = {
    /** Maximum number of parsable files to process */
    MAX_FILES: 1000,

    /** Skip individual files larger than this (in KB) */
    MAX_FILE_SIZE_KB: 500,

    /** Reject repositories larger than this via GitHub API check (in MB) */
    MAX_REPO_SIZE_MB: 100,

    /** Process files in batches of this size */
    BATCH_SIZE: 50,

    /** Milliseconds to yield between batches to prevent blocking */
    BATCH_DELAY_MS: 10,
} as const;

export type ImportLimits = typeof IMPORT_LIMITS;

/**
 * Format file size for display
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a repository size exceeds the limit
 */
export function isRepoTooLarge(sizeKB: number): boolean {
    return sizeKB > IMPORT_LIMITS.MAX_REPO_SIZE_MB * 1024;
}

/**
 * Check if a file size exceeds the limit
 */
export function isFileTooLarge(sizeBytes: number): boolean {
    return sizeBytes > IMPORT_LIMITS.MAX_FILE_SIZE_KB * 1024;
}

/**
 * Check if file count exceeds the limit
 */
export function isTooManyFiles(count: number): boolean {
    return count > IMPORT_LIMITS.MAX_FILES;
}
