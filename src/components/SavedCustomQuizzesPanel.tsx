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
      {error && (
        <div className="mb-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-600">
          {error}
        </div>
      )}
      {list.length === 0 && !loading ? (
        <p className="text-xs italic text-slate-400">No custom quizzes saved</p>
      ) : (
        <ul className="space-y-2">
          {list.map((q) => (
            <li
              key={q.id}
              className="flex items-center justify-between rounded bg-white px-3 py-2 text-xs shadow-sm"
            >
              <div className="flex-1">
                <div className="text-slate-700">
                  {q.root.type}
                  <span className="ml-2 text-slate-400">· {q.totalCards} cards</span>
                </div>
                <div className="text-slate-400">
                  {new Date(q.createdAt).toLocaleString()}
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
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-700 shadow-sm hover:bg-slate-50"
                  onClick={async () => {
                    try {
                      await fetch(`/api/quizzes?id=${encodeURIComponent(q.id)}`, {
                        method: "DELETE",
                        cache: "no-store",
                      });
                    } catch {}
                    await load();
                  }}
                  disabled={loading}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
