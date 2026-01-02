/**
 * LocalStorage-based debug log store for tracking distractor generation runs.
 * Used by the /dev/distractor-debug page for debugging the batch generation process.
 */

const STORAGE_KEY = "distractor-debug-logs";

// ============================================================================
// Types
// ============================================================================

export type TokenUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    promptCacheHitTokens?: number;
    promptCacheMissTokens?: number;
};

export type DistractorCardRequest = {
    cardIndex: number;
    question: string;
    correctAnswers: string[];
    snippet: string;
    preview?: string;
};

export type DistractorCardResponse = {
    cardIndex: number;
    distractors: string[];
    error?: string;
};

export type BatchLogEntry = {
    /** Unique monotonically increasing identifier for this batch operation */
    batchId: number;
    /** UI-friendly batch index (may be clamped during retries) */
    batchIndex: number;
    batchTotal: number;
    startedAt: string;
    completedAt?: string;
    requests: DistractorCardRequest[];
    responses: DistractorCardResponse[];
    prompt?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fullPromptPayload?: { model: string; messages: any[]; stream: boolean };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawResponse?: any;
    usage?: TokenUsage;
    status: "pending" | "success" | "error";
    errorMessage?: string;
};

export type DistractorRunLog = {
    runId: string;
    quizId: string;
    startedAt: string;
    completedAt?: string;
    totalCards: number;
    batchSize: number;
    provider: string;
    model: string;
    batches: BatchLogEntry[];
    status: "running" | "completed" | "failed";
    fullCodeContext?: string;
};

// ============================================================================
// Storage Helpers
// ============================================================================

function loadFromStorage(): DistractorRunLog[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveToStorage(runs: DistractorRunLog[]): void {
    if (typeof window === "undefined") return;
    try {
        // Keep only the last 50 runs to avoid localStorage bloat
        const trimmed = runs.slice(-50);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn("[DistractorDebugStore] Failed to save to localStorage:", e);
    }
}

// ============================================================================
// API
// ============================================================================

/**
 * Get all logged runs
 */
export function getRunLogs(): DistractorRunLog[] {
    return loadFromStorage();
}

/**
 * Get a single run by ID
 */
export function getRunById(runId: string): DistractorRunLog | undefined {
    return loadFromStorage().find((r) => r.runId === runId);
}

/**
 * Create a new run log entry
 */
export function createRun(params: {
    quizId: string;
    totalCards: number;
    batchSize: number;
    provider: string;
    model: string;
    fullCodeContext?: string;
}): DistractorRunLog {
    const run: DistractorRunLog = {
        runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        quizId: params.quizId,
        startedAt: new Date().toISOString(),
        totalCards: params.totalCards,
        batchSize: params.batchSize,
        provider: params.provider,
        model: params.model,
        batches: [],
        status: "running",
        fullCodeContext: params.fullCodeContext,
    };

    const runs = loadFromStorage();
    runs.push(run);
    saveToStorage(runs);

    return run;
}

/**
 * Add a batch to an existing run
 */
export function addBatchToRun(
    runId: string,
    batch: Omit<BatchLogEntry, "status" | "responses"> & { status?: BatchLogEntry["status"] }
): void {
    const runs = loadFromStorage();
    const run = runs.find((r) => r.runId === runId);
    if (!run) return;

    run.batches.push({
        ...batch,
        status: batch.status || "pending",
        responses: [],
    });

    saveToStorage(runs);
}

/**
 * Update a batch's status and responses
 */
export function updateBatch(
    runId: string,
    batchId: number,
    update: {
        status: BatchLogEntry["status"];
        responses?: DistractorCardResponse[];
        completedAt?: string;
        errorMessage?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fullPromptPayload?: { model: string; messages: any[]; stream: boolean };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawResponse?: any;
        usage?: TokenUsage;
    }
): void {
    const runs = loadFromStorage();
    const run = runs.find((r) => r.runId === runId);
    if (!run) {
        return;
    }

    const batch = run.batches.find((b) => b.batchId === batchId);
    if (!batch) {
        return;
    }

    batch.status = update.status;
    if (update.responses) batch.responses = update.responses;
    if (update.completedAt) batch.completedAt = update.completedAt;
    if (update.errorMessage) batch.errorMessage = update.errorMessage;
    if (update.fullPromptPayload !== undefined) batch.fullPromptPayload = update.fullPromptPayload;
    if (update.rawResponse !== undefined) batch.rawResponse = update.rawResponse;
    if (update.usage !== undefined) batch.usage = update.usage;

    saveToStorage(runs);
}

/**
 * Mark a run as completed or failed
 */
export function completeRun(
    runId: string,
    status: "completed" | "failed"
): void {
    const runs = loadFromStorage();
    const run = runs.find((r) => r.runId === runId);
    if (!run) return;

    run.status = status;
    run.completedAt = new Date().toISOString();

    saveToStorage(runs);
}

/**
 * Delete a single run by ID
 */
export function deleteRun(runId: string): void {
    const runs = loadFromStorage().filter((r) => r.runId !== runId);
    saveToStorage(runs);
}

/**
 * Clear all runs
 */
export function clearAllRuns(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Generate a unique run ID
 */
export function generateRunId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
