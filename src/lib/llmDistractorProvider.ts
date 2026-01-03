import { shuffleArray } from "./utils";

const DEFAULT_LLM_DISTRACTOR_BATCH_SIZE = 20;
const parsedBatchSize = Number.parseInt(
  process.env.LLM_DISTRACTOR_BATCH_SIZE || String(DEFAULT_LLM_DISTRACTOR_BATCH_SIZE),
  10
);
export const LLM_DISTRACTOR_BATCH_SIZE =
  Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
    ? parsedBatchSize
    : DEFAULT_LLM_DISTRACTOR_BATCH_SIZE;

// Default distractor counts - configurable via batch opts
export const DEFAULT_MCQ_DISTRACTOR_COUNT = 6;
export const DEFAULT_MULTI_DISTRACTOR_COUNT = 10;

const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 60_000;
const parsedTimeoutMs = Number.parseInt(
  process.env.LLM_REQUEST_TIMEOUT_MS || String(DEFAULT_LLM_REQUEST_TIMEOUT_MS),
  10
);
const LLM_REQUEST_TIMEOUT_MS =
  Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
    ? parsedTimeoutMs
    : DEFAULT_LLM_REQUEST_TIMEOUT_MS;

function createAbortSignalWithTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number
): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal, cleanup: () => { }, didTimeout: () => false };
  }

  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      controller.abort();
    } catch { }
  }, timeoutMs);

  const onAbort = () => {
    try {
      controller.abort();
    } catch { }
  };
  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    },
    didTimeout: () => timedOut,
  };
}

async function fetchDeepSeekJson(
  payload: PromptPayload,
  apiKey: string,
  signal?: AbortSignal
): Promise<any> {
  const { signal: timeoutSignal, cleanup, didTimeout } =
    createAbortSignalWithTimeout(signal, LLM_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: timeoutSignal,
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek error ${res.status}: ${text}`);
    }
    return await res.json();
  } catch (err) {
    if (didTimeout()) {
      throw new Error(
        `DeepSeek request timed out after ${LLM_REQUEST_TIMEOUT_MS}ms`
      );
    }
    throw err;
  } finally {
    cleanup();
  }
}

export type DistractorProvider = "deepseek" | "mock";

export type DistractorRequest = {
  correctAnswers: string[];
  question?: string;
  snippet?: string;
  preview?: string;
  targetCount: number;
  questionType?: "single" | "multi" | "orderedMulti";
  provider?: DistractorProvider;
  model?: string;
  signal?: AbortSignal;
  // Optional: provide full source context to keep prompts stable and cache-friendly
  fullCode?: string;
  // Previously saved distractors (used to avoid repeats and pool across retries)
  existingDistractors?: string[];
  // Stable key for deterministic trimming across runs
  stableKey?: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // DeepSeek cache details
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromptPayload = { model: string; messages: any[]; stream: boolean };

type ProviderResult = {
  distractors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any;
  // Full prompt payload for debugging
  promptPayload?: PromptPayload;
  // Token usage from API response
  usage?: TokenUsage;
};

const stripCodeFence = (raw: string) => {
  // Remove markdown code fences like ```json ... ```
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) return fence[1];
  return raw;
};

const parseArray = (content: string): string[] => {
  const trimmed = stripCodeFence(content || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? ""));
  } catch {
    // fall through
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? ""));
    } catch {
      // ignore
    }
  }
  return trimmed
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const normalizeCandidates = (
  candidates: string[],
  correctAnswers: string[]
): string[] => {
  const correctSet = new Set(correctAnswers.map((c) => c.toLowerCase()));
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (!s) continue;
    const lower = s.toLowerCase();
    if (seen.has(lower)) continue;
    if (correctSet.has(lower)) continue;
    seen.add(lower);
    cleaned.push(s);
  }
  return cleaned;
};

const sanitizeCandidates = (
  candidates: string[],
  correctAnswers: string[],
  targetCount: number
) => {
  const cleaned = normalizeCandidates(candidates, correctAnswers);
  return cleaned.slice(0, targetCount);
};

const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash;
};

const stablePick = (
  items: string[],
  targetCount: number,
  stableKey?: string
): string[] => {
  if (!stableKey) return items.slice(0, targetCount);
  const scored = items.map((item) => ({
    item,
    score: hashString(`${stableKey}:${item}`),
  }));
  scored.sort((a, b) => (a.score - b.score) || a.item.localeCompare(b.item));
  return scored.slice(0, targetCount).map((entry) => entry.item);
};

const mergeDistractorPools = (
  existing: string[] | undefined,
  incoming: string[] | undefined,
  correctAnswers: string[],
  targetCount: number,
  stableKey?: string
): string[] => {
  const merged = [
    ...normalizeCandidates(existing ?? [], correctAnswers),
    ...normalizeCandidates(incoming ?? [], correctAnswers),
  ];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of merged) {
    const lower = item.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    deduped.push(item);
  }
  if (targetCount <= 0) return [];
  if (deduped.length <= targetCount) return deduped;
  return stablePick(deduped, targetCount, stableKey);
};

type PromptMessage = { role: "system" | "user"; content: string };

const buildBaseMessages = (
  codeContext?: string,
  systemInstruction?: string
): PromptMessage[] => {
  const system =
    systemInstruction ||
    "You write concise, plausible but incorrect distractor options for programming quizzes. Return ONLY a JSON array of strings. No explanations.";
  const messages: PromptMessage[] = [{ role: "system", content: system }];
  if (codeContext) {
    messages.push({
      role: "user",
      content: [
        "Full code context (stable):",
        "```",
        codeContext,
        "```",
        "Use this context to stay consistent across multiple questions.",
      ].join("\n"),
    });
  }
  return messages;
};

const isMultiQuestion = (questionType?: DistractorRequest["questionType"]) =>
  questionType === "multi" || questionType === "orderedMulti";

const buildCardPrompt = (req: DistractorRequest, target: number) => {
  const questionType = isMultiQuestion(req.questionType)
    ? "multi-select (select several answers)"
    : "single-answer multiple choice";
  const payload = {
    question: req.question,
    correctAnswers: req.correctAnswers,
    snippet: req.snippet,
    preview: req.preview,
    existingDistractors:
      req.existingDistractors && req.existingDistractors.length > 0
        ? req.existingDistractors
        : undefined,
  };
  // Keep JSON stable and append-only for cache friendliness
  const stableJson = JSON.stringify(
    payload,
    ["question", "correctAnswers", "snippet", "preview", "existingDistractors"],
    2
  );
  return [
    `Question type: ${questionType}.`,
    `Need ${target} incorrect options that fit alongside the correct answer(s) but are wrong.`,
    "Use the quiz data below. Do not repeat the correct answers.",
    "If existing distractors are provided, generate NEW ones that are not already listed.",
    "Do not include explanations.",
    "Quiz data:",
    stableJson,
    `Respond with a JSON array of ${target} strings only.`,
  ].join("\n");
};

/**
 * Build a batch prompt combining multiple cards into one request.
 * Multi-select questions receive multiTarget distractors, MCQ receives mcqTarget.
 */
const buildBatchPrompt = (
  requests: DistractorRequest[],
  mcqTarget: number = DEFAULT_MCQ_DISTRACTOR_COUNT,
  multiTarget: number = DEFAULT_MULTI_DISTRACTOR_COUNT
): string => {
  const cards = requests.map((req, i) => {
    const isMulti = isMultiQuestion(req.questionType);
    const targetCount = isMulti ? multiTarget : mcqTarget;
    return {
      index: i,
      questionType: isMulti ? "multi-select (select N answers)" : "single-answer MCQ",
      distractorCount: targetCount,
      question: req.question,
      correctAnswers: req.correctAnswers,
      snippet: req.snippet || "",
      preview: req.preview || "",
      existingDistractors: req.existingDistractors || [],
    };
  });

  return [
    `Generate incorrect distractor options for ${cards.length} quiz questions.`,
    "",
    "For each question:",
    "- multi-select questions need 10 distractors (used in 'select N out of 10' format)",
    "- single-answer MCQ questions need 6 distractors",
    "- Do NOT repeat the correct answers",
    "- If existingDistractors are provided, do NOT repeat them",
    "- Generate new distractors when possible; duplicates will be discarded",
    "- Make distractors plausible but clearly wrong",
    "",
    "Questions:",
    JSON.stringify(cards, null, 2),
    "",
    "Respond with a JSON array of arrays, one inner array per question in the same order.",
    `Example format for ${cards.length} questions: [[...], [...], ...]`,
  ].join("\n");
};

/**
 * Parse array-of-arrays response from LLM.
 */
const parseBatchResponse = (content: string): string[][] => {
  const trimmed = stripCodeFence(content || "").trim();
  if (!trimmed) {
    return [];
  }

  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((inner) => {
        if (Array.isArray(inner)) {
          return inner.map((v) => String(v ?? "").trim()).filter(Boolean);
        }
        // Single string - wrap in array
        if (typeof inner === "string") {
          return [inner.trim()].filter(Boolean);
        }
        return [];
      });
    }
  } catch {
    // Strategy 1 failed, try next
  }

  // Strategy 2: Find [[ ]] pattern
  try {
    const start = trimmed.indexOf("[[");
    const end = trimmed.lastIndexOf("]]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 2));
      if (Array.isArray(parsed)) {
        return parsed.map((inner) =>
          Array.isArray(inner)
            ? inner.map((v) => String(v ?? "").trim()).filter(Boolean)
            : []
        );
      }
    }
  } catch {
    // Strategy 2 failed, try next
  }

  // Strategy 3: Find first [ and last ] (single-level array that might contain nested)
  try {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        // Check if it's a flat array of strings (single question response)
        if (parsed.every(item => typeof item === "string")) {
          // Return as single array
          return [parsed.map((v) => String(v ?? "").trim()).filter(Boolean)];
        }
        return parsed.map((inner) =>
          Array.isArray(inner)
            ? inner.map((v) => String(v ?? "").trim()).filter(Boolean)
            : typeof inner === "string" ? [inner.trim()].filter(Boolean) : []
        );
      }
    }
  } catch {
    // Strategy 3 failed
  }

  // All strategies failed
  return [];
};

type BatchProviderResult = {
  results: Array<{
    distractors: string[];
    error?: string;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any;
  promptPayload?: PromptPayload;
  usage?: TokenUsage;
};

/**
 * Make a single API call for a batch of cards (true batching).
 */
async function callDeepSeekBatch(
  requests: DistractorRequest[],
  baseMessages?: PromptMessage[],
  signal?: AbortSignal,
  mcqTarget: number = DEFAULT_MCQ_DISTRACTOR_COUNT,
  multiTarget: number = DEFAULT_MULTI_DISTRACTOR_COUNT
): Promise<BatchProviderResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }
  const model = requests[0]?.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const messages = baseMessages || buildBaseMessages(requests[0]?.fullCode);

  const payload: PromptPayload = {
    model,
    messages: [
      ...messages,
      {
        role: "user",
        content: buildBatchPrompt(requests, mcqTarget, multiTarget),
      },
    ],
    stream: false,
  };

  const data = await fetchDeepSeekJson(payload, apiKey, signal);
  const content = data?.choices?.[0]?.message?.content ?? "";

  const batchResults = parseBatchResponse(content);

  // Extract usage data from response
  const rawUsage = data?.usage;
  const usage: TokenUsage | undefined = rawUsage
    ? {
      promptTokens: rawUsage.prompt_tokens ?? 0,
      completionTokens: rawUsage.completion_tokens ?? 0,
      totalTokens: rawUsage.total_tokens ?? 0,
      promptCacheHitTokens: rawUsage.prompt_cache_hit_tokens,
      promptCacheMissTokens: rawUsage.prompt_cache_miss_tokens,
    }
    : undefined;

  // Map results back to requests, sanitizing each
  const results = requests.map((req, i) => {
  const isMulti = isMultiQuestion(req.questionType);
    const targetCount = isMulti ? multiTarget : mcqTarget;
    const candidates = batchResults[i] || [];
    const distractors = sanitizeCandidates(
      candidates,
      req.correctAnswers,
      targetCount
    );

    return { distractors };
  });

  // Include raw content in the result for debugging
  return {
    results,
    raw: { ...data, _rawContent: content },
    promptPayload: payload,
    usage,
  };
}


async function callDeepSeek(
  req: DistractorRequest,
  baseMessages?: PromptMessage[]
): Promise<ProviderResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }
  const model = req.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const target = Math.max(1, req.targetCount || 3);
  const messages =
    baseMessages ||
    buildBaseMessages(req.fullCode);
  const payload: PromptPayload = {
    model,
    messages: [
      ...messages,
      {
        role: "user",
        content: buildCardPrompt(req, target),
      },
    ],
    stream: false,
  };

  const data = await fetchDeepSeekJson(payload, apiKey, req.signal);
  const content = data?.choices?.[0]?.message?.content ?? "";
  const candidates = parseArray(String(content || ""));
  const distractors = mergeDistractorPools(
    req.existingDistractors,
    sanitizeCandidates(candidates, req.correctAnswers, target),
    req.correctAnswers,
    target,
    req.stableKey
  );

  // Extract usage data from response
  const rawUsage = data?.usage;
  const usage: TokenUsage | undefined = rawUsage
    ? {
      promptTokens: rawUsage.prompt_tokens ?? 0,
      completionTokens: rawUsage.completion_tokens ?? 0,
      totalTokens: rawUsage.total_tokens ?? 0,
      promptCacheHitTokens: rawUsage.prompt_cache_hit_tokens,
      promptCacheMissTokens: rawUsage.prompt_cache_miss_tokens,
    }
    : undefined;

  return { distractors, raw: data, promptPayload: payload, usage };
}

function callMock(req: DistractorRequest): ProviderResult {
  const target = Math.max(1, req.targetCount || 3);
  const pool = Array.from({ length: target }).map(
    (_, i) => `Fake option ${i + 1} for ${req.question || "quiz"}`
  );
  return {
    distractors: sanitizeCandidates(pool, req.correctAnswers, target),
  };
}

export async function generateDistractors(
  req: DistractorRequest,
  opts?: { baseMessages?: PromptMessage[] }
): Promise<ProviderResult> {
  const provider =
    req.provider || (process.env.LLM_DISTRACTOR_PROVIDER as DistractorProvider) || "deepseek";
  const base = { ...req, provider };
  const baseMessages =
    opts?.baseMessages ||
    buildBaseMessages(base.fullCode);
  const result =
    provider === "mock"
      ? callMock(base)
      : await callDeepSeek(base, baseMessages);
  // Shuffle to avoid always using the same order downstream
  return { ...result, distractors: shuffleArray(result.distractors || []) };
}

export type BatchProgress = {
  total: number;
  completed: number;
  failed: number;
  batchIndex: number;
  batchTotal: number;
};

export type BatchResult = ProviderResult & {
  index: number;
  error?: string;
};

/**
 * Debug log event emitted per batch for detailed inspection.
 */
export type BatchLogEvent = {
  /** Unique monotonically increasing identifier for this batch operation */
  batchId: number;
  /** UI-friendly batch index (clamped during retries) */
  batchIndex: number;
  batchTotal: number;
  phase: "start" | "complete";
  requests: Array<{
    index: number;
    question?: string;
    correctAnswers: string[];
    snippet?: string;
    preview?: string;
  }>;
  /** Sample prompt for this batch (legacy, prefer fullPromptPayload) */
  prompt?: string;
  /** Full prompt payload sent to the LLM API */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fullPromptPayload?: { model: string; messages: any[]; stream: boolean };
  /** Raw provider response for the whole batch (debug only) */
  rawResponse?: unknown;
  /** Token usage for the whole batch request */
  usage?: TokenUsage;
  responses?: Array<{
    index: number;
    distractors: string[];
    error?: string;
  }>;
  startedAt: string;
  completedAt?: string;
};

export async function generateDistractorsInBatches(
  requests: DistractorRequest[],
  opts?: {
    batchSize?: number;
    onProgress?: (progress: BatchProgress) => void | Promise<void>;
    sharedCodeContext?: string;
    /** Debug callback for detailed batch-level logging */
    onBatchLog?: (event: BatchLogEvent) => void;
    /** Maximum total attempts per card including initial attempt (default 3 = 1 initial + 2 retries) */
    maxAttempts?: number;
    /** AbortSignal for cancelling all batch operations */
    signal?: AbortSignal;
    /** Target distractor count for single-answer MCQ (default 6) */
    mcqTargetCount?: number;
    /** Target distractor count for multi-select questions (default 10) */
    multiTargetCount?: number;
  }
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  if (!requests.length) return results;

  const batchSize = Math.max(1, opts?.batchSize || LLM_DISTRACTOR_BATCH_SIZE);
  const maxAttempts = opts?.maxAttempts ?? 3; // 1 initial + 2 retries
  const mcqTarget = opts?.mcqTargetCount ?? DEFAULT_MCQ_DISTRACTOR_COUNT;
  const multiTarget = opts?.multiTargetCount ?? DEFAULT_MULTI_DISTRACTOR_COUNT;
  const batchSignal = opts?.signal;
  const total = requests.length;
  const reportProgress = async (progress: BatchProgress) => {
    if (!opts?.onProgress) return;
    try {
      await opts.onProgress(progress);
    } catch (err) {
      console.warn("[Distractor] Progress callback failed:", err);
    }
  };

  // Fix #1: Track finalized cards (success or exhausted retries) to avoid completed > total
  const finalizedCards = new Set<number>();
  let failedCount = 0;

  const baseMessages = buildBaseMessages(
    opts?.sharedCodeContext || requests[0]?.fullCode
  );

  // Track requests that need retry with their original indices and attempts
  type RetryItem = { originalIndex: number; request: DistractorRequest; attempts: number };
  let retryQueue: RetryItem[] = [];

  /**
   * Validate a distractor result - returns true if valid
   * Fix #3: Require full target count (10 for multi, 6 for MCQ)
   */
  const validateResult = (
    result: BatchResult | undefined,
    request: DistractorRequest
  ): boolean => {
    if (!result) return false;

    const isMulti = isMultiQuestion(request.questionType);
    const minRequired = isMulti ? multiTarget : mcqTarget;

    const merged = mergeDistractorPools(
      request.existingDistractors,
      result.distractors,
      request.correctAnswers,
      minRequired,
      request.stableKey
    );

    if (!merged.length || merged.length < minRequired) {
      return false;
    }

    return true;
  };

  /**
   * Process a batch of requests (used for both initial and retry batches)
   * Fix #2: Accept RetryItem[] for retry batches to carry attempts correctly
   */
  const processBatch = async (
    items: Array<{ request: DistractorRequest; originalIndex: number; attempts: number }>,
    batchIndex: number,
    initialBatchTotal: number
  ): Promise<{ results: BatchResult[]; failedItems: RetryItem[] }> => {
    // Use batchIndex as unique batchId, clamp for display purposes to avoid "Batch 7 of 5" during retries
    const batchId = batchIndex;
    const displayBatchIndex = Math.min(batchIndex, initialBatchTotal);
    const batchStartTime = new Date().toISOString();
    const failedItems: RetryItem[] = [];

    const slice = items.map(item => item.request);
    const absoluteIndices = items.map(item => item.originalIndex);

    // Prepare batch requests for logging
    const batchRequests = slice.map((req, idx) => ({
      index: absoluteIndices[idx],
      question: req.question,
      correctAnswers: req.correctAnswers,
      snippet: req.snippet,
      preview: req.preview,
    }));

    // Build the batch prompt for logging
    const batchPrompt = buildBatchPrompt(slice, mcqTarget, multiTarget);

    // Emit batch start event (use displayBatchIndex for UI, batchId for unique identification)
    opts?.onBatchLog?.({
      batchId,
      batchIndex: displayBatchIndex,
      batchTotal: initialBatchTotal,
      phase: "start",
      requests: batchRequests,
      prompt: batchPrompt,
      startedAt: batchStartTime,
    });

    const batchResults: BatchResult[] = [];

    // Check if cancelled before starting batch
    if (batchSignal?.aborted) {
      const abortError = new Error('Batch operation was cancelled');
      abortError.name = 'AbortError';
      throw abortError;
    }

    try {
      // Use batch-level signal for proper cancellation across all batches
      const batchResult = await callDeepSeekBatch(
        slice,
        baseMessages,
        batchSignal,
        mcqTarget,
        multiTarget
      );

      const batchResponses: Array<{
        index: number;
        distractors: string[];
        error?: string;
      }> = [];

      batchResult.results.forEach((res, idx) => {
        const absoluteIndex = absoluteIndices[idx];
        const item = items[idx];
        const request = item.request;
        const currentAttempts = item.attempts;

        // Slim result: raw/promptPayload/usage only in onBatchLog, not per-card
        const isMulti = isMultiQuestion(request.questionType);
        const targetCount = isMulti ? multiTarget : mcqTarget;
        const mergedDistractors = mergeDistractorPools(
          request.existingDistractors,
          res.distractors,
          request.correctAnswers,
          targetCount,
          request.stableKey
        );
        const hasEnough = mergedDistractors.length >= targetCount;
        const nextRequest =
          mergedDistractors.length > 0
            ? { ...request, existingDistractors: mergedDistractors }
            : request;
        const result: BatchResult = {
          index: absoluteIndex,
          distractors: mergedDistractors,
          error: hasEnough ? undefined : res.error,
        };

        batchResults.push(result);

        batchResponses.push({
          index: absoluteIndex,
          distractors: mergedDistractors,
          error: hasEnough ? undefined : res.error,
        });

        // Check if result needs retry
        if (!validateResult(result, request)) {
          // Fix #2: Use attempts from the item itself, not from retryQueue lookup
          if (currentAttempts < maxAttempts) {
            failedItems.push({
              originalIndex: absoluteIndex,
              request: nextRequest,
              attempts: currentAttempts + 1,
            });
          } else {
            // Exhausted retries - mark as finalized and failed
            if (!finalizedCards.has(absoluteIndex)) {
              finalizedCards.add(absoluteIndex);
              failedCount += 1;
              // Set error message for exhausted retries
              result.error = `Failed validation after ${currentAttempts} attempts`;
            }
          }
        } else {
          // Success - mark as finalized
          if (!finalizedCards.has(absoluteIndex)) {
            finalizedCards.add(absoluteIndex);
          }
        }
      });

      // Fix #1 & #4: Report progress based on finalized cards, use stable batch total
      await reportProgress({
        total,
        completed: finalizedCards.size,
        failed: failedCount,
        batchIndex: displayBatchIndex,
        batchTotal: initialBatchTotal,
      });

      // Emit batch complete event
      opts?.onBatchLog?.({
        batchId,
        batchIndex: displayBatchIndex,
        batchTotal: initialBatchTotal,
        phase: "complete",
        requests: batchRequests,
        fullPromptPayload: batchResult.promptPayload,
        rawResponse: batchResult.raw,
        usage: batchResult.usage,
        responses: batchResponses,
        startedAt: batchStartTime,
        completedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      // Entire batch failed - queue all for retry
      const errorMessage = err instanceof Error ? err.message : String(err);
      const batchResponses: Array<{
        index: number;
        distractors: string[];
        error?: string;
      }> = [];

      items.forEach((item) => {
        const absoluteIndex = item.originalIndex;
        const currentAttempts = item.attempts;
        const isMulti = isMultiQuestion(item.request.questionType);
        const targetCount = isMulti ? multiTarget : mcqTarget;
        const mergedDistractors = mergeDistractorPools(
          item.request.existingDistractors,
          [],
          item.request.correctAnswers,
          targetCount,
          item.request.stableKey
        );
        const hasEnough = mergedDistractors.length >= targetCount;
        const finalError = hasEnough ? undefined : errorMessage;
        const nextRequest =
          mergedDistractors.length > 0
            ? { ...item.request, existingDistractors: mergedDistractors }
            : item.request;

        batchResults.push({
          index: absoluteIndex,
          distractors: mergedDistractors,
          error: finalError,
        });

        batchResponses.push({
          index: absoluteIndex,
          distractors: mergedDistractors,
          error: finalError,
        });

        if (hasEnough) {
          if (!finalizedCards.has(absoluteIndex)) {
            finalizedCards.add(absoluteIndex);
          }
          return;
        }

        if (currentAttempts < maxAttempts) {
          failedItems.push({
            originalIndex: absoluteIndex,
            request: nextRequest,
            attempts: currentAttempts + 1,
          });
        } else {
          // Exhausted retries - mark as finalized and failed
          if (!finalizedCards.has(absoluteIndex)) {
            finalizedCards.add(absoluteIndex);
            failedCount += 1;
          }
        }
      });

      // Fix #1 & #4: Report progress based on finalized cards
      await reportProgress({
        total,
        completed: finalizedCards.size,
        failed: failedCount,
        batchIndex: displayBatchIndex,
        batchTotal: initialBatchTotal,
      });

      // Emit batch complete event with error
      opts?.onBatchLog?.({
        batchId,
        batchIndex: displayBatchIndex,
        batchTotal: initialBatchTotal,
        phase: "complete",
        requests: batchRequests,
        responses: batchResponses,
        startedAt: batchStartTime,
        completedAt: new Date().toISOString(),
      });
    }

    return { results: batchResults, failedItems };
  };

  // Calculate initial batch count (used as stable batchTotal for all progress reports)
  const initialBatches = Math.ceil(total / batchSize);
  let currentBatchIndex = 0;

  // Process initial batches
  for (let i = 0; i < initialBatches; i++) {
    const start = i * batchSize;
    const slice = requests.slice(start, start + batchSize);
    // Convert to items with attempts = 1 for initial processing
    const items = slice.map((request, idx) => ({
      request,
      originalIndex: start + idx,
      attempts: 1,
    }));

    currentBatchIndex = i + 1;
    const { results: batchResults, failedItems } = await processBatch(
      items,
      currentBatchIndex,
      initialBatches
    );

    // Store results
    batchResults.forEach(result => {
      results[result.index] = result;
    });

    // Add failed items to retry queue
    retryQueue.push(...failedItems);
  }

  // Process retry batches
  let retryRound = 0;
  while (retryQueue.length > 0 && retryRound < maxAttempts - 1) { // -1 because initial attempt counts
    retryRound++;

    const itemsToRetry = [...retryQueue];
    retryQueue = [];

    // Batch retry items
    const retryBatches = Math.ceil(itemsToRetry.length / batchSize);

    for (let i = 0; i < retryBatches; i++) {
      const start = i * batchSize;
      const slice = itemsToRetry.slice(start, start + batchSize);

      currentBatchIndex++;
      const { results: batchResults, failedItems } = await processBatch(
        slice,
        currentBatchIndex,
        initialBatches // Keep using initial batch count for stable progress
      );

      // Update results - always write latest attempt to preserve error state
      batchResults.forEach(result => {
        results[result.index] = result;
      });

      // Add still-failed items to retry queue
      retryQueue.push(...failedItems);
    }
  }

  // Handle any remaining items in retry queue (exhausted all retry rounds)
  retryQueue.forEach(item => {
    if (!finalizedCards.has(item.originalIndex)) {
      finalizedCards.add(item.originalIndex);
      failedCount += 1;
      // Ensure result has error message
      if (results[item.originalIndex]) {
        results[item.originalIndex].error = `Failed validation after ${item.attempts} attempts`;
      }
    }
  });

  return results;
}
