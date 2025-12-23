"use client";
import { useEffect, useState } from "react";

export type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

export type SavedCustomQuizCardV11 = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  sourceRef?: SourceRef;
  semanticRole?: string;
  question?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  // multi-select (optional)
  questionType?: "single" | "multi";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  // optional LLM distractors pool
  llmDistractors?: string[];
  // optional progressive reveal anchors
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};

export type SavedCustomQuizV11 = {
  id: string;
  kind: "custom-quiz";
  createdAt: string;
  typeLabel?: string;
  profile?: "shallow" | "normal" | "deep";
  root: { type: string; text?: string; start?: number; end?: number; path?: number[] };
  totalCards: number;
  cards: SavedCustomQuizCardV11[];
};

async function fetchSavedCustomQuizzes(fileKey?: {
  kind: "repo" | "project";
  id: string;
  path: string;
}): Promise<SavedCustomQuizV11[]> {
  try {
    if (!fileKey) return [];
    const qs = new URLSearchParams({
      kind: fileKey.kind,
      id: fileKey.id,
      path: fileKey.path,
    });
    const res = await fetch(`/api/quizzes?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data.quizzes) ? data.quizzes : [];
    const out: SavedCustomQuizV11[] = list.map((q: any) => ({
      id: String(q.id || ""),
      kind: "custom-quiz",
      createdAt: q.createdAt
        ? new Date(q.createdAt).toISOString()
        : new Date().toISOString(),
      typeLabel: q.type,
      profile: q.profile,
      root: {
        type: q.rootNode?.type || "unknown",
        text: q.rootNode?.text,
        start: q.rootNode?.start,
        end: q.rootNode?.end,
        path: q.rootNode?.path,
      },
      totalCards: Array.isArray(q.cards) ? q.cards.length : 0,
      cards: (q.cards || []).map((c: any) => ({
        order: c.order,
        type: c.type,
        text: c.text,
        action: c.action === "dig" ? "dig" : "next",
        sourceRef: c.sourceRef,
        semanticRole: c.semanticRole,
        question: c.question,
        generatorRule: c.generatorRule,
        difficulty: c.difficulty,
        // pass through multi-select fields when present
        questionType: c.questionType,
        multiCorrect: Array.isArray(c.multiCorrect) ? c.multiCorrect : undefined,
        multiSelectHint:
          typeof c.multiSelectHint === "number" ? c.multiSelectHint : undefined,
        optionPool: Array.isArray(c.optionPool) ? c.optionPool : undefined,
        // optional LLM distractors
        llmDistractors: Array.isArray(c.llmDistractors)
          ? c.llmDistractors
          : undefined,
        // pass through reveal anchors when present
        revealStart:
          typeof c.revealStart === "number" ? (c.revealStart as number) : undefined,
        revealEndBeforeChild:
          typeof c.revealEndBeforeChild === "number"
            ? (c.revealEndBeforeChild as number)
            : undefined,
        revealEndAfterChild:
          typeof c.revealEndAfterChild === "number"
            ? (c.revealEndAfterChild as number)
            : undefined,
      })),
    }));
    return out;
  } catch {
    return [];
  }
}

export function SavedCustomQuizzesPanel({
  fileKey,
  onStartSaved,
}: {
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  onStartSaved: (quiz: SavedCustomQuizV11) => void;
}) {
  const [list, setList] = useState<SavedCustomQuizV11[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [generatingId, setGeneratingId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
  } | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(undefined);
      const data = await fetchSavedCustomQuizzes(fileKey);
      setList(data);
    } catch (e) {
      setError("Could not load saved quizzes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(undefined);
      try {
        const data = await fetchSavedCustomQuizzes(fileKey);
        if (!cancelled) setList(data);
      } catch {
        if (!cancelled) setError("Could not load saved quizzes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // reload when fileKey changes
  }, [fileKey?.kind, fileKey?.id, fileKey?.path]);

  const handleGenerateDistractors = async (quizId: string) => {
    // Import debug store functions dynamically to avoid SSR issues
    const {
      createRun,
      addBatchToRun,
      updateBatch,
      completeRun,
    } = await import("@/src/lib/distractorDebugStore");

    const decoder = new TextDecoder();
    let buffer = "";
    let runId: string | undefined;
    let batchSize = 20; // default
    let totalCards = 0;
    let serverProvider = "deepseek";
    let serverModel = "deepseek-chat";

    const handleLine = (line: string) => {
      if (!line) return;
      // Fix #9: Wrap JSON.parse in try/catch to handle malformed lines
      let evt;
      try {
        evt = JSON.parse(line);
      } catch (e) {
        console.warn("[SavedCustomQuizzesPanel] Invalid JSON line:", line.slice(0, 100));
        return;
      }
      if (evt.type === "start") {
        totalCards = evt.total ?? 0;
        batchSize = evt.batchSize ?? 20;
        // Fix #10: Use provider/model from server event
        serverProvider = evt.provider ?? "deepseek";
        serverModel = evt.model ?? "deepseek-chat";
        setProgress({
          total: evt.total ?? 0,
          completed: 0,
          failed: 0,
        });
        // Create debug run
        const run = createRun({
          quizId,
          totalCards,
          batchSize,
          provider: serverProvider,
          model: serverModel,
        });
        runId = run.runId;
      } else if (evt.type === "progress") {
        setProgress({
          total: evt.total ?? 0,
          completed: evt.completed ?? 0,
          failed: evt.failed ?? 0,
        });
      } else if (evt.type === "batch-detail" && runId) {
        // Save batch detail to debug log
        if (evt.phase === "start") {
          addBatchToRun(runId, {
            batchIndex: evt.batchIndex,
            batchTotal: evt.batchTotal,
            startedAt: evt.startedAt,
            requests: (evt.requests || []).map((r: any) => ({
              cardIndex: r.index,
              question: r.question || "",
              correctAnswers: r.correctAnswers || [],
              snippet: r.snippet || "",
              preview: r.preview,
            })),
            prompt: evt.prompt,
            fullPromptPayload: evt.fullPromptPayload,
          });
        } else if (evt.phase === "complete") {
          updateBatch(runId, evt.batchIndex, {
            status: (evt.responses || []).some((r: any) => r.error)
              ? "error"
              : "success",
            responses: (evt.responses || []).map((r: any) => ({
              cardIndex: r.index,
              distractors: r.distractors || [],
              error: r.error,
              rawResponse: r.raw,
              promptPayload: r.promptPayload,
              usage: r.usage,
            })),
            completedAt: evt.completedAt,
            fullPromptPayload: evt.fullPromptPayload,
          });
        }
      } else if (evt.type === "complete") {
        const updated = Array.isArray(evt.updatedCards)
          ? evt.updatedCards.length
          : 0;
        setStatus(
          `Generated distractors for ${updated} card${updated === 1 ? "" : "s"}.`
        );
        if (runId) {
          completeRun(runId, "completed");
        }
      } else if (evt.type === "error") {
        if (runId) {
          completeRun(runId, "failed");
        }
        throw new Error(evt.error || "Failed to generate distractors.");
      }
    };
    try {
      setGeneratingId(quizId);
      setStatus(undefined);
      setProgress(null);
      // Fix #6: Only enable debug mode in development
      const isDev = process.env.NODE_ENV === "development";
      const res = await fetch(
        `/api/quizzes/${encodeURIComponent(quizId)}/distractors?progress=1${isDev ? "&debug=1" : ""}`,
        {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
        }
      );
      if (!res.ok || !res.body) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt || "failed"}`);
      }
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          handleLine(line);
        }
      }
      const final = decoder.decode();
      buffer += final;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        handleLine(line);
      }
      if (buffer.trim()) {
        handleLine(buffer.trim());
      }
    } catch (e: any) {
      setStatus(e?.message || "Failed to generate distractors.");
      if (runId) {
        completeRun(runId, "failed");
      }
    } finally {
      setGeneratingId(undefined);
      setProgress(null);
      await load();
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-slate-700">Saved Custom Quizzes</p>
        <button
          type="button"
          className="text-xs text-slate-500 underline decoration-dotted"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {status && (
        <div className="mb-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
          {status}
        </div>
      )}
      {progress && progress.total > 0 && (
        <div className="mb-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
            <span>Generating distractors</span>
            <span>
              {progress.completed}/{progress.total}
              {progress.failed ? ` · ${progress.failed} failed` : ""}
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-amber-500 transition-all"
              style={{
                width: `${progress.total > 0
                  ? Math.min(
                    100,
                    Math.round((progress.completed / progress.total) * 100)
                  )
                  : 0
                  }%`,
              }}
            />
          </div>
        </div>
      )}
      {error && (
        <div className="mb-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-600">
          {error}
        </div>
      )}
      {list.length === 0 && !loading ? (
        <p className="text-xs italic text-slate-400">No custom quizzes saved</p>
      ) : (
        <ul className="space-y-2">
          {list.map((q) => {
            const hasDistractors =
              q.cards.length > 0 &&
              q.cards.every(
                (c) =>
                  Array.isArray(c.llmDistractors) &&
                  (c.llmDistractors as string[]).length > 0
              );
            return (
              <li
                key={q.id}
                className="flex items-center justify-between rounded bg-white px-3 py-2 text-xs shadow-sm"
              >
                <div className="flex-1">
                  <div className="text-slate-700">
                    {q.root.type}
                    <span className="ml-2 text-slate-400">· {q.totalCards} cards</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400">
                    <span>{new Date(q.createdAt).toLocaleString()}</span>
                    <span
                      className={
                        hasDistractors
                          ? "text-green-600 font-semibold"
                          : "text-amber-600 font-semibold"
                      }
                    >
                      {hasDistractors ? "Distractors ready" : "Not generated"}
                    </span>
                  </div>
                </div>
                <div className="ml-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-amber-500 px-2.5 py-1 text-white shadow hover:bg-amber-600"
                    onClick={() => onStartSaved(q)}
                    disabled={loading}
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => handleGenerateDistractors(q.id)}
                    disabled={loading || generatingId === q.id}
                  >
                    {generatingId === q.id ? "Generating…" : "Generate"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-sm hover:bg-slate-50"
                    onClick={async () => {
                      try {
                        await fetch(`/api/quizzes?id=${encodeURIComponent(q.id)}`, {
                          method: "DELETE",
                          cache: "no-store",
                        });
                      } catch { }
                      await load();
                    }}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
