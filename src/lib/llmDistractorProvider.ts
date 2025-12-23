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

type ProviderResult = {
  distractors: string[];
  raw?: any;
};

const stripCodeFence = (raw: string) => {
  const fence = raw.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
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
  const payload = {
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
  return { distractors, raw: data };
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

export async function generateDistractorsInBatches(
  requests: DistractorRequest[],
  opts?: {
    batchSize?: number;
    onProgress?: (progress: BatchProgress) => void;
    sharedCodeContext?: string;
  }
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  if (!requests.length) return results;

  const batchSize = Math.max(1, opts?.batchSize || LLM_DISTRACTOR_BATCH_SIZE);
  const total = requests.length;
  const totalBatches = Math.ceil(total / batchSize);
  let completed = 0;
  let failed = 0;

  const baseMessages = buildBaseMessages(
    opts?.sharedCodeContext || requests[0]?.fullCode
  );

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const slice = requests.slice(start, start + batchSize);
    await Promise.all(
      slice.map(async (req, idx) => {
        const absoluteIndex = start + idx;
        try {
          const res = await generateDistractors(
            { ...req },
            { baseMessages }
          );
          results[absoluteIndex] = { ...res, index: absoluteIndex };
        } catch (err: any) {
          failed += 1;
          results[absoluteIndex] = {
            index: absoluteIndex,
            distractors: [],
            error: err?.message || String(err),
          };
        } finally {
          completed += 1;
          opts?.onProgress?.({
            total,
            completed,
            failed,
            batchIndex: batchIndex + 1,
            batchTotal: totalBatches,
          });
        }
      })
    );
  }

  return results;
}
