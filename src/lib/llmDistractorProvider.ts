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

export type DistractorProvider = "deepseek" | "mock";

export type DistractorRequest = {
  correctAnswers: string[];
  question?: string;
  snippet?: string;
  preview?: string;
  targetCount: number;
  questionType?: "single" | "multi";
  provider?: DistractorProvider;
  model?: string;
  signal?: AbortSignal;
  // Optional: provide full source context to keep prompts stable and cache-friendly
  fullCode?: string;
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
    .split(/\\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const sanitizeCandidates = (
  candidates: string[],
  correctAnswers: string[],
  targetCount: number
) => {
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
    if (cleaned.length >= targetCount) break;
  }
  return cleaned;
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

const buildCardPrompt = (req: DistractorRequest, target: number) => {
  const questionType =
    req.questionType === "multi"
      ? "multi-select (select several answers)"
      : "single-answer multiple choice";
  const payload = {
    question: req.question,
    correctAnswers: req.correctAnswers,
    snippet: req.snippet,
    preview: req.preview,
  };
  // Keep JSON stable and append-only for cache friendliness
  const stableJson = JSON.stringify(
    payload,
    ["question", "correctAnswers", "snippet", "preview"],
    2
  );
  return [
    `Question type: ${questionType}.`,
    `Need ${target} incorrect options that fit alongside the correct answer(s) but are wrong.`,
    "Use the quiz data below. Do not repeat the correct answers. Do not include explanations.",
    "Quiz data:",
    stableJson,
    `Respond with a JSON array of ${target} strings only.`,
  ].join("\n");
};

/**
 * Build a batch prompt combining multiple cards into one request.
 * Multi-select questions receive 10 distractors, MCQ receives 6.
 */
const buildBatchPrompt = (requests: DistractorRequest[]): string => {
  const cards = requests.map((req, i) => {
    const isMulti = req.questionType === "multi";
    const targetCount = isMulti ? 10 : 6;
    return {
      index: i,
      questionType: isMulti ? "multi-select (select N answers)" : "single-answer MCQ",
      distractorCount: targetCount,
      question: req.question,
      correctAnswers: req.correctAnswers,
      snippet: req.snippet || "",
      preview: req.preview || "",
    };
  });

  return [
    `Generate incorrect distractor options for ${cards.length} quiz questions.`,
    "",
    "For each question:",
    "- multi-select questions need 10 distractors (used in 'select N out of 10' format)",
    "- single-answer MCQ questions need 6 distractors",
    "- Do NOT repeat the correct answers",
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
    console.log("[parseBatchResponse] Empty content");
    return [];
  }

  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log("[parseBatchResponse] Strategy 1 success, items:", parsed.length);
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
  } catch (e) {
    console.log("[parseBatchResponse] Strategy 1 failed:", (e as Error).message);
  }

  // Strategy 2: Find [[ ]] pattern
  try {
    const start = trimmed.indexOf("[[");
    const end = trimmed.lastIndexOf("]]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 2));
      if (Array.isArray(parsed)) {
        console.log("[parseBatchResponse] Strategy 2 success, items:", parsed.length);
        return parsed.map((inner) =>
          Array.isArray(inner)
            ? inner.map((v) => String(v ?? "").trim()).filter(Boolean)
            : []
        );
      }
    }
  } catch (e) {
    console.log("[parseBatchResponse] Strategy 2 failed:", (e as Error).message);
  }

  // Strategy 3: Find first [ and last ] (single-level array that might contain nested)
  try {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        console.log("[parseBatchResponse] Strategy 3 success, items:", parsed.length);
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
  } catch (e) {
    console.log("[parseBatchResponse] Strategy 3 failed:", (e as Error).message);
  }

  console.log("[parseBatchResponse] All strategies failed, content preview:", trimmed.slice(0, 200));
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
  signal?: AbortSignal
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
        content: buildBatchPrompt(requests),
      },
    ],
    stream: false,
  };

  const res = await fetch(
    process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";

  // Debug logging
  console.log("[callDeepSeekBatch] Raw content length:", content.length);
  console.log("[callDeepSeekBatch] Raw content preview:", content.slice(0, 500));

  const batchResults = parseBatchResponse(content);

  console.log("[callDeepSeekBatch] Parsed results count:", batchResults.length);
  console.log("[callDeepSeekBatch] First result sample:", batchResults[0]?.slice(0, 3));

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
    const isMulti = req.questionType === "multi";
    const targetCount = isMulti ? 10 : 6;
    const candidates = batchResults[i] || [];
    const distractors = sanitizeCandidates(candidates, req.correctAnswers, targetCount);

    if (candidates.length === 0) {
      console.log(`[callDeepSeekBatch] Warning: No candidates for request ${i}`);
    }

    return { distractors };
  });

  // Include raw content in the result for debugging
  return { results, raw: { ...data, _rawContent: content }, promptPayload: payload, usage };
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

  const res = await fetch(
    process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const candidates = parseArray(String(content || ""));
  const distractors = sanitizeCandidates(
    candidates,
    req.correctAnswers,
    target
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
  responses?: Array<{
    index: number;
    distractors: string[];
    error?: string;
    raw?: unknown;
    /** Full prompt for this specific request */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promptPayload?: { model: string; messages: any[]; stream: boolean };
    /** Token usage for this request */
    usage?: TokenUsage;
  }>;
  startedAt: string;
  completedAt?: string;
};

export async function generateDistractorsInBatches(
  requests: DistractorRequest[],
  opts?: {
    batchSize?: number;
    onProgress?: (progress: BatchProgress) => void;
    sharedCodeContext?: string;
    /** Debug callback for detailed batch-level logging */
    onBatchLog?: (event: BatchLogEvent) => void;
    /** Maximum retry attempts for failed cards (default 2) */
    maxRetries?: number;
  }
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  if (!requests.length) return results;

  const batchSize = Math.max(1, opts?.batchSize || LLM_DISTRACTOR_BATCH_SIZE);
  const maxRetries = opts?.maxRetries ?? 2;
  const total = requests.length;
  let completed = 0;
  let failed = 0;

  const baseMessages = buildBaseMessages(
    opts?.sharedCodeContext || requests[0]?.fullCode
  );

  // Track requests that need retry with their original indices
  type RetryItem = { originalIndex: number; request: DistractorRequest; attempts: number };
  let retryQueue: RetryItem[] = [];

  /**
   * Validate a distractor result - returns true if valid
   */
  const validateResult = (
    result: BatchResult | undefined,
    request: DistractorRequest
  ): boolean => {
    if (!result) return false;
    if (result.error) return false;

    const isMulti = request.questionType === "multi";
    const minRequired = isMulti ? 5 : 3; // At least 5 for multi, 3 for MCQ

    if (!result.distractors || result.distractors.length < minRequired) {
      return false;
    }

    // Check for duplicates with correct answers
    const correctSet = new Set(request.correctAnswers.map(a => a.toLowerCase()));
    const uniqueDistractors = result.distractors.filter(
      d => !correctSet.has(d.toLowerCase())
    );

    return uniqueDistractors.length >= minRequired;
  };

  /**
   * Process a batch of requests (used for both initial and retry batches)
   */
  const processBatch = async (
    slice: DistractorRequest[],
    absoluteIndices: number[],
    batchIndex: number,
    totalBatches: number,
    isRetry: boolean
  ): Promise<{ results: BatchResult[]; failedItems: RetryItem[] }> => {
    const batchStartTime = new Date().toISOString();
    const failedItems: RetryItem[] = [];

    // Prepare batch requests for logging
    const batchRequests = slice.map((req, idx) => ({
      index: absoluteIndices[idx],
      question: req.question,
      correctAnswers: req.correctAnswers,
      snippet: req.snippet,
      preview: req.preview,
    }));

    // Build the batch prompt for logging
    const batchPrompt = buildBatchPrompt(slice);

    // Emit batch start event
    opts?.onBatchLog?.({
      batchIndex,
      batchTotal: totalBatches,
      phase: "start",
      requests: batchRequests,
      prompt: batchPrompt,
      startedAt: batchStartTime,
    });

    const batchResults: BatchResult[] = [];

    try {
      const batchResult = await callDeepSeekBatch(
        slice,
        baseMessages,
        slice[0]?.signal
      );

      const batchResponses: Array<{
        index: number;
        distractors: string[];
        error?: string;
        raw?: unknown;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        promptPayload?: { model: string; messages: any[]; stream: boolean };
        usage?: TokenUsage;
      }> = [];

      batchResult.results.forEach((res, idx) => {
        const absoluteIndex = absoluteIndices[idx];
        const request = slice[idx];

        const result: BatchResult = {
          index: absoluteIndex,
          distractors: res.distractors,
          raw: batchResult.raw,
          promptPayload: batchResult.promptPayload,
          usage: batchResult.usage,
          error: res.error,
        };

        batchResults.push(result);

        batchResponses.push({
          index: absoluteIndex,
          distractors: res.distractors,
          raw: batchResult.raw,
          promptPayload: batchResult.promptPayload,
          usage: batchResult.usage,
          error: res.error,
        });

        // Check if result needs retry
        if (!validateResult(result, request)) {
          const existingRetry = retryQueue.find(r => r.originalIndex === absoluteIndex);
          const attempts = existingRetry ? existingRetry.attempts + 1 : 1;

          if (attempts <= maxRetries) {
            failedItems.push({
              originalIndex: absoluteIndex,
              request,
              attempts,
            });
            console.log(`[generateDistractorsInBatches] Card ${absoluteIndex} failed validation, queuing for retry (attempt ${attempts})`);
          } else {
            console.log(`[generateDistractorsInBatches] Card ${absoluteIndex} exceeded max retries`);
            failed += 1;
          }
        }
      });

      completed += slice.length;
      opts?.onProgress?.({
        total,
        completed,
        failed,
        batchIndex,
        batchTotal: totalBatches,
      });

      // Emit batch complete event
      opts?.onBatchLog?.({
        batchIndex,
        batchTotal: totalBatches,
        phase: "complete",
        requests: batchRequests,
        prompt: batchPrompt,
        fullPromptPayload: batchResult.promptPayload,
        responses: batchResponses,
        startedAt: batchStartTime,
        completedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      // Entire batch failed - queue all for retry
      const errorMessage = err?.message || String(err);

      slice.forEach((request, idx) => {
        const absoluteIndex = absoluteIndices[idx];
        const existingRetry = retryQueue.find(r => r.originalIndex === absoluteIndex);
        const attempts = existingRetry ? existingRetry.attempts + 1 : 1;

        batchResults.push({
          index: absoluteIndex,
          distractors: [],
          error: errorMessage,
        });

        if (attempts <= maxRetries) {
          failedItems.push({
            originalIndex: absoluteIndex,
            request,
            attempts,
          });
        } else {
          failed += 1;
        }
      });

      completed += slice.length;
      opts?.onProgress?.({
        total,
        completed,
        failed,
        batchIndex,
        batchTotal: totalBatches,
      });

      // Emit batch complete event with error
      opts?.onBatchLog?.({
        batchIndex,
        batchTotal: totalBatches,
        phase: "complete",
        requests: batchRequests,
        prompt: batchPrompt,
        responses: slice.map((_, idx) => ({
          index: absoluteIndices[idx],
          distractors: [],
          error: errorMessage,
        })),
        startedAt: batchStartTime,
        completedAt: new Date().toISOString(),
      });
    }

    return { results: batchResults, failedItems };
  };

  // Calculate initial batch count
  const initialBatches = Math.ceil(total / batchSize);
  let currentBatchIndex = 0;

  // Process initial batches
  for (let i = 0; i < initialBatches; i++) {
    const start = i * batchSize;
    const slice = requests.slice(start, start + batchSize);
    const absoluteIndices = slice.map((_, idx) => start + idx);

    currentBatchIndex = i + 1;
    const { results: batchResults, failedItems } = await processBatch(
      slice,
      absoluteIndices,
      currentBatchIndex,
      initialBatches,
      false
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
  while (retryQueue.length > 0 && retryRound < maxRetries) {
    retryRound++;
    console.log(`[generateDistractorsInBatches] Retry round ${retryRound}: ${retryQueue.length} cards`);

    const itemsToRetry = [...retryQueue];
    retryQueue = [];

    // Batch retry items
    const retryBatches = Math.ceil(itemsToRetry.length / batchSize);

    for (let i = 0; i < retryBatches; i++) {
      const start = i * batchSize;
      const slice = itemsToRetry.slice(start, start + batchSize);
      const retryRequests = slice.map(item => item.request);
      const absoluteIndices = slice.map(item => item.originalIndex);

      currentBatchIndex++;
      const { results: batchResults, failedItems } = await processBatch(
        retryRequests,
        absoluteIndices,
        currentBatchIndex,
        initialBatches + retryBatches,
        true
      );

      // Update results (overwrite previous failed results)
      batchResults.forEach(result => {
        const request = slice.find(item => item.originalIndex === result.index)?.request;
        if (request && validateResult(result, request)) {
          results[result.index] = result;
        }
      });

      // Add still-failed items to retry queue
      retryQueue.push(...failedItems);
    }
  }

  // Log final stats
  const successCount = results.filter(r => r && !r.error && r.distractors.length > 0).length;
  console.log(`[generateDistractorsInBatches] Complete: ${successCount}/${total} successful, ${failed} failed`);

  return results;
}


