import { shuffleArray } from "./utils";

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

async function callDeepSeek(req: DistractorRequest): Promise<ProviderResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }
  const model = req.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const target = Math.max(1, req.targetCount || 3);
  const questionType =
    req.questionType === "multi"
      ? "multi-select (select several answers)"
      : "single-answer multiple choice";
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You write concise, plausible but incorrect distractor options for programming quizzes. Return ONLY a JSON array of strings. No explanations.",
      },
      {
        role: "user",
        content: [
          `Question type: ${questionType}.`,
          `Need ${target} incorrect options that fit alongside the correct answer(s) but are wrong.`,
          "Use the quiz data below. Do not repeat the correct answers. Do not include explanations.",
          "Quiz data:",
          JSON.stringify(
            {
              question: req.question,
              correctAnswers: req.correctAnswers,
              snippet: req.snippet,
              preview: req.preview,
            },
            null,
            2
          ),
          `Respond with a JSON array of ${target} strings only.`,
        ].join("\n"),
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
  req: DistractorRequest
): Promise<ProviderResult> {
  const provider =
    req.provider || (process.env.LLM_DISTRACTOR_PROVIDER as DistractorProvider) || "deepseek";
  const base = { ...req, provider };
  const result =
    provider === "mock" ? callMock(base) : await callDeepSeek(base);
  // Shuffle to avoid always using the same order downstream
  return { ...result, distractors: shuffleArray(result.distractors || []) };
}
