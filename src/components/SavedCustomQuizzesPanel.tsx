"use client";
import { useEffect, useRef, useState } from "react";
import { MedalBadge } from "./MedalBadge";

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
  // override distractor count for grouped imports
  distractorPoolSize?: number;
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
  // Section markers: array of card indices where new sections begin
  // e.g., [0, 5, 10] creates sections: 0-4, 5-9, 10-end
  sectionMarkers?: number[];
  // Optional custom names for each section
  sectionNames?: string[];
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
      cards: (Array.isArray(q.cards) ? q.cards : []).map((c: any) => ({
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
        distractorPoolSize:
          typeof c.distractorPoolSize === "number"
            ? c.distractorPoolSize
            : undefined,
      })),
      // Parse section markers and names
      sectionMarkers: Array.isArray(q.sectionMarkers) ? q.sectionMarkers : undefined,
      sectionNames: Array.isArray(q.sectionNames) ? q.sectionNames : undefined,
    }));
    return out;
  } catch {
    return [];
  }
}

export function SavedCustomQuizzesPanel({
  fileKey,
  onStartSaved,
  onQuizComplete,
}: {
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  onStartSaved: (quiz: SavedCustomQuizV11, quizId: string, sectionIndex: number) => void;
  onQuizComplete?: () => void;
}) {
  const isMountedRef = useRef(true);

  const [list, setList] = useState<SavedCustomQuizV11[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [generatingId, setGeneratingId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const [activeRunQuizId, setActiveRunQuizId] = useState<string | undefined>(undefined);
  const [failurePreview, setFailurePreview] = useState<
    Array<{ order: number; error: string }>
  >([]);
  const [progress, setProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
  } | null>(null);

  // Section editor state
  const [editingSections, setEditingSections] = useState<SavedCustomQuizV11 | null>(null);
  const [sectionMarkers, setSectionMarkers] = useState<number[]>([]);
  const [sectionNames, setSectionNames] = useState<string[]>([]);

  // Section selector state
  const [selectingSection, setSelectingSection] = useState<SavedCustomQuizV11 | null>(null);

  // Context viewer state
  const [viewingContext, setViewingContext] = useState<number | null>(null);

  // Medal state - keyed by quizId, then sectionIndex
  type MedalInfo = { type: "bronze" | "silver" | "gold"; stars: 1 | 2 | 3 };
  type SectionMedalData = { medals: MedalInfo[]; goldUpgradeInfo?: { msRemaining: number } | null };
  const [medals, setMedals] = useState<Record<string, Record<number, SectionMedalData>>>({});;

  const copyTextToClipboard = async (text: string) => {
    const fallbackCopy = (value: string) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ok = fallbackCopy(text);
        if (!ok) throw new Error("Clipboard unavailable");
      }
    } catch {
      // ignore
    }
  };

  const buildQuizExportJson = (quiz: SavedCustomQuizV11) => {
    return {
      id: quiz.id,
      createdAt: quiz.createdAt,
      profile: quiz.profile,
      root: quiz.root,
      cards: quiz.cards.map((c) => {
        const isMulti = c.questionType === "multi";
        const question =
          c.question || (isMulti ? "Select all that apply." : "What comes next?");
        const answer = isMulti
          ? Array.isArray(c.multiCorrect)
            ? c.multiCorrect
            : []
          : c.text;
        return {
          order: c.order,
          type: c.type,
          question,
          questionType: isMulti ? "multi" : "single",
          answer,
        };
      }),
    };
  };

  const load = async (opts?: { shouldUpdate?: () => boolean }) => {
    const shouldUpdate = opts?.shouldUpdate ?? (() => true);
    const runIfActive = (fn: () => void) => {
      if (shouldUpdate()) fn();
    };
    try {
      runIfActive(() => {
        setLoading(true);
        setError(undefined);
      });
      const data = await fetchSavedCustomQuizzes(fileKey);
      runIfActive(() => setList(data));

      // Fetch medals for all quizzes
      const medalData: Record<string, Record<number, SectionMedalData>> = {};
      for (const quiz of data) {
        try {
          const res = await fetch(`/api/quiz-attempts/medals?quizId=${encodeURIComponent(quiz.id)}`);
          if (res.ok) {
            const quizMedals = await res.json();
            medalData[quiz.id] = quizMedals;
          }
        } catch (e) {
          console.error(`Failed to fetch medals for quiz ${quiz.id}:`, e);
        }
      }
      runIfActive(() => setMedals(medalData));
    } catch (e) {
      runIfActive(() => setError("Could not load saved quizzes."));
    } finally {
      runIfActive(() => setLoading(false));
    }
  };

  // Reload only medals without reloading full quiz list
  const reloadMedals = async () => {
    const medalData: Record<string, Record<number, SectionMedalData>> = {};
    for (const quiz of list) {
      try {
        const res = await fetch(`/api/quiz-attempts/medals?quizId=${encodeURIComponent(quiz.id)}`);
        if (res.ok) {
          const quizMedals = await res.json();
          medalData[quiz.id] = quizMedals;
        }
      } catch (e) {
        console.error(`Failed to fetch medals for quiz ${quiz.id}:`, e);
      }
    }
    setMedals(medalData);
  };

  // Expose reload function to parent via callback
  useEffect(() => {
    if (onQuizComplete) {
      // Store the reload function so parent can call it
      (window as any).__reloadQuizMedals = reloadMedals;
    }
  }, [list, onQuizComplete]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load({ shouldUpdate: () => !cancelled });
    })();
    return () => {
      cancelled = true;
    };
    // reload when fileKey changes
  }, [fileKey?.kind, fileKey?.id, fileKey?.path]);

  useEffect(() => {
    if (activeRunId || list.length === 0) return;
    try {
      for (const quiz of list) {
        const stored = sessionStorage.getItem(getRunStorageKey(quiz.id));
        if (stored) {
          setActiveRunId(stored);
          setActiveRunQuizId(quiz.id);
          setGeneratingId(quiz.id);
          setStatus("Resuming distractor generation…");
          break;
        }
      }
    } catch { }
  }, [activeRunId, list]);

  useEffect(() => {
    setGeneratingId(undefined);
    setProgress(null);
    setStatus(undefined);
    setError(undefined);
    setActiveRunId(undefined);
    setActiveRunQuizId(undefined);
    setFailurePreview([]);
  }, [fileKey?.kind, fileKey?.id, fileKey?.path]);

  const getRunStorageKey = (quizId: string) => `distractor-run:${quizId}`;

  const persistRunId = (quizId: string, runId: string) => {
    try {
      sessionStorage.setItem(getRunStorageKey(quizId), runId);
    } catch { }
  };

  const clearRunId = (quizId: string) => {
    try {
      sessionStorage.removeItem(getRunStorageKey(quizId));
    } catch { }
  };

  const cancelActiveGeneration = async () => {
    if (!activeRunId) return;
    try {
      await fetch(`/api/distractor-runs/${encodeURIComponent(activeRunId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch { }
    setStatus("Cancelled distractor generation.");
    setError(undefined);
  };

  type RunFailure = { order: number; error: string };

  type RunStatus = {
    runId: string;
    quizId: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    total: number;
    completed: number;
    failed: number;
    updatedCards?: number[];
    failures?: RunFailure[];
    skipped?: number;
    errorMessage?: string;
  };

  const applyRunUpdate = (run: RunStatus) => {
    const failures = Array.isArray(run.failures) ? run.failures : [];
    const updatedCount = Array.isArray(run.updatedCards)
      ? run.updatedCards.length
      : 0;
    const failureCount = failures.length || run.failed || 0;
    const total = Number.isFinite(run.total) ? run.total : 0;
    const completed = Number.isFinite(run.completed) ? run.completed : 0;
    const failed = Number.isFinite(run.failed) ? run.failed : failureCount;

    setFailurePreview(failures.slice(0, 3));
    setProgress({ total, completed, failed });
    setActiveRunQuizId(run.quizId);

    if (run.status === "queued" || run.status === "running") {
      setGeneratingId(run.quizId);
      setError(undefined);
      setStatus(
        failureCount > 0
          ? `Generating distractors… ${failureCount} failed so far.`
          : "Generating distractors…"
      );
      return;
    }

    setGeneratingId(undefined);

    if (run.status === "completed") {
      if (total === 0) {
        setStatus("No cards needed distractors.");
      } else if (failureCount > 0) {
        setStatus(
          `Generated ${updatedCount} card${updatedCount === 1 ? "" : "s"}. ${
            failureCount
          } failed.`
        );
      } else {
        setStatus(
          `Generated ${updatedCount} card${updatedCount === 1 ? "" : "s"}.`
        );
      }
      setError(undefined);
      return;
    }

    if (run.status === "failed") {
      const message =
        run.errorMessage ||
        (failureCount > 0
          ? `Failed to generate distractors for ${failureCount} card${
              failureCount === 1 ? "" : "s"
            }.`
          : "Failed to generate distractors.");
      setError(message);
      setStatus(undefined);
      return;
    }

    if (run.status === "cancelled") {
      setStatus("Cancelled distractor generation.");
      setError(undefined);
    }
  };

  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const runId = activeRunId;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/distractor-runs/${encodeURIComponent(runId)}`,
          { cache: "no-store" }
        );
        if (res.status === 404) {
          if (activeRunQuizId) {
            clearRunId(activeRunQuizId);
          }
          setActiveRunId(undefined);
          setActiveRunQuizId(undefined);
          setGeneratingId(undefined);
          setProgress(null);
          setFailurePreview([]);
          setStatus("Distractor run not found.");
          return;
        }
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt || "failed"}`);
        }
        const data = (await res.json()) as RunStatus;
        if (cancelled || !isMountedRef.current || runId !== activeRunId) return;

        applyRunUpdate({ ...data, runId });

        if (["completed", "failed", "cancelled"].includes(data.status)) {
          clearRunId(data.quizId);
          setActiveRunId(undefined);
          setActiveRunQuizId(undefined);
          setGeneratingId(undefined);
          setProgress(null);
          if (isMountedRef.current) {
            await load();
          }
        }
      } catch (err) {
        if (!cancelled && isMountedRef.current) {
          const message =
            err instanceof Error ? err.message : "Failed to fetch run status.";
          setError(message);
        }
      }
    };

    poll();
    const intervalId = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeRunId, activeRunQuizId]);

  const startRun = async (quizId: string, missingOnly: boolean) => {
    if (activeRunId && activeRunQuizId && activeRunQuizId !== quizId) {
      setStatus("Another quiz is already generating distractors. Cancel it to start a new run.");
      return;
    }

    setStatus(undefined);
    setError(undefined);
    setFailurePreview([]);
    setProgress(null);

    try {
      const res = await fetch(
        `/api/quizzes/${encodeURIComponent(quizId)}/distractors/runs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ missingOnly }),
        }
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt || "failed"}`);
      }
      const data = (await res.json()) as RunStatus;
      const runId = String(data.runId || "");
      if (!runId) {
        throw new Error("Missing run id from server.");
      }

      setActiveRunId(runId);
      setActiveRunQuizId(quizId);
      setGeneratingId(quizId);
      persistRunId(quizId, runId);
      applyRunUpdate({ ...data, runId, quizId });

      if (["completed", "failed", "cancelled"].includes(data.status)) {
        clearRunId(quizId);
        setActiveRunId(undefined);
        setActiveRunQuizId(undefined);
        setGeneratingId(undefined);
        setProgress(null);
        if (isMountedRef.current) {
          await load();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start run.";
      setError(message);
    }
  };

  const handleGenerateDistractors = async (quizId: string) => {
    await startRun(quizId, false);
  };

  const handleRegenerateMissing = async (quizId: string) => {
    await startRun(quizId, true);
  };

  // Section helper functions
  const getSections = (quiz: SavedCustomQuizV11) => {
    const markers = quiz.sectionMarkers || [];
    if (markers.length === 0) {
      return [{ start: 0, end: quiz.totalCards, name: "All", index: 0 }];
    }

    const sections = [];
    const sortedMarkers = [...markers].sort((a, b) => a - b);

    // Always start with a section from 0
    for (let i = 0; i < sortedMarkers.length; i++) {
      const start = i === 0 ? 0 : sortedMarkers[i - 1];
      const end = sortedMarkers[i];
      const name = quiz.sectionNames?.[i] || `Section ${i + 1}`;
      sections.push({ start, end, name, index: i });
    }

    // Add the final section from last marker to end
    const lastMarker = sortedMarkers[sortedMarkers.length - 1];
    const finalName = quiz.sectionNames?.[sortedMarkers.length] || `Section ${sortedMarkers.length + 1}`;
    sections.push({
      start: lastMarker,
      end: quiz.totalCards,
      name: finalName,
      index: sortedMarkers.length
    });

    return sections;
  };

  const handleStartSection = (quiz: SavedCustomQuizV11, sectionIndex?: number) => {
    const sections = getSections(quiz);
    if (sectionIndex === undefined || sections.length === 1) {
      // Start entire quiz
      onStartSaved(quiz, quiz.id, 0);
    } else {
      // Start specific section
      const section = sections[sectionIndex];
      const sectionQuiz: SavedCustomQuizV11 = {
        ...quiz,
        cards: quiz.cards.slice(section.start, section.end),
        totalCards: section.end - section.start,
      };
      onStartSaved(sectionQuiz, quiz.id, sectionIndex);
    }
  };

  const handleEditSections = (quiz: SavedCustomQuizV11) => {
    setEditingSections(quiz);
    setSectionMarkers(quiz.sectionMarkers || []);
    // Initialize with at least one section name if none exist
    const names = quiz.sectionNames || [];
    if (names.length === 0) {
      setSectionNames(["Section 1"]);
    } else {
      setSectionNames(names);
    }
  };

  const toggleMarker = (index: number) => {
    if (sectionMarkers.includes(index)) {
      // Remove marker
      const markerIndex = sectionMarkers.indexOf(index);
      const newMarkers = sectionMarkers.filter((m) => m !== index);

      // Remove the section name that comes AFTER this marker
      // (marker at position i creates section i+1, so remove sectionNames[i+1])
      const newNames = sectionNames.filter((_, i) => i !== markerIndex + 1);

      setSectionMarkers(newMarkers);
      setSectionNames(newNames);
    } else {
      // Add marker
      const newMarkers = [...sectionMarkers, index].sort((a, b) => a - b);
      const insertIndex = newMarkers.indexOf(index);

      // Insert a new section name AFTER this marker position
      // If we have markers [5, 10], we need names for: [0-4, 5-9, 10-end] = 3 names
      const newNames = [...sectionNames];
      newNames.splice(insertIndex + 1, 0, `Section ${insertIndex + 2}`);

      setSectionMarkers(newMarkers);
      setSectionNames(newNames);
    }
  };

  const updateSectionName = (index: number, name: string) => {
    setSectionNames((prev) => {
      const newNames = [...prev];
      newNames[index] = name;
      return newNames;
    });
  };

  const handleSaveSections = async () => {
    if (!editingSections) return;

    try {
      const payload = {
        sectionMarkers,
        sectionNames,
      };

      const res = await fetch(`/api/quizzes/${encodeURIComponent(editingSections.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      setEditingSections(null);
      await load();
    } catch (e: any) {
      console.error('Save sections error:', e);
      alert(e?.message || "Failed to save sections");
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Saved Quizzes
        </h2>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          onClick={() => load()}
          disabled={loading}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Status Message */}
      {status && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
          {status}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}
      {failurePreview.length > 0 && (
        <div className="rounded-lg border border-rose-100 bg-rose-50/60 px-4 py-2.5 text-xs text-rose-700">
          <div className="font-semibold uppercase tracking-wide text-[10px] text-rose-500">
            Recent Failures
          </div>
          <ul className="mt-1 space-y-1">
            {failurePreview.map((failure, index) => (
              <li key={`${failure.order}-${index}`}>
                Card {failure.order}: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quiz List */}
      {list.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <svg className="mx-auto h-10 w-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-2 text-sm text-slate-500">No custom quizzes saved</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((q) => {
            // Count cards with/without sufficient distractors
            const distractorStats = q.cards.reduce(
              (acc, c) => {
                const required = c.questionType === "multi" ? 10 : 6;
                const hasEnough =
                  Array.isArray(c.llmDistractors) &&
                  c.llmDistractors.length >= required;
                return {
                  total: acc.total + 1,
                  complete: acc.complete + (hasEnough ? 1 : 0),
                  missing: acc.missing + (hasEnough ? 0 : 1),
                };
              },
              { total: 0, complete: 0, missing: 0 }
            );
            const hasDistractors = distractorStats.complete === distractorStats.total && distractorStats.total > 0;
            const hasPartialDistractors = distractorStats.complete > 0 && distractorStats.complete < distractorStats.total;
            return (
              <li
                key={q.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Quiz Info */}
                <div className="mb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{q.root.type}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{new Date(q.createdAt).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1">
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          {q.totalCards} cards
                        </span>
                      </div>
                    </div>
                    {/* Action Overflow Menu Trigger can go here if needed */}
                  </div>

                  {/* Badges */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {q.profile && (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${q.profile === "shallow"
                          ? "bg-purple-50 text-purple-700"
                          : q.profile === "deep"
                            ? "bg-pink-50 text-pink-700"
                            : "bg-blue-50 text-blue-700"
                          }`}
                      >
                        {q.profile === "shallow" ? "Shallow" : q.profile === "deep" ? "Deep" : "Normal"}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${hasDistractors
                        ? "bg-green-50 text-green-700"
                        : hasPartialDistractors
                          ? "bg-blue-50 text-blue-700"
                          : "bg-amber-50 text-amber-700"
                        }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${hasDistractors
                          ? "bg-green-500"
                          : hasPartialDistractors
                            ? "bg-blue-500"
                            : "bg-amber-500"
                          }`}
                      />
                      {hasDistractors
                        ? "Complete"
                        : hasPartialDistractors
                          ? `Partial: ${distractorStats.complete}/${distractorStats.total} cards`
                          : "No Distractors"}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Start buttons with section support */}
                    {(() => {
                      const sections = getSections(q);
                      if (sections.length === 1) {
                        // No sections, single Start button
                        const sectionMedalData = medals[q.id]?.[0];
                        const sectionMedals = sectionMedalData?.medals || [];
                        const goldUpgradeInfo = sectionMedalData?.goldUpgradeInfo;
                        return (
                          <div className="flex items-center gap-2">
                            <MedalBadge medals={sectionMedals} goldUpgradeInfo={goldUpgradeInfo} />
                            <button
                              type="button"
                              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-50"
                              onClick={() => handleStartSection(q)}
                              disabled={loading}
                            >
                              Start
                            </button>
                          </div>
                        );
                      } else {
                        // Has sections, just show Start All button
                        return (
                          <button
                            type="button"
                            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-50"
                            onClick={() => handleStartSection(q)}
                            disabled={loading}
                          >
                            Start All
                          </button>
                        );
                      }
                    })()}

                    {/* Edit Sections Button */}
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => handleEditSections(q)}
                      disabled={loading}
                    >
                      Edit Sections
                    </button>

                    {distractorStats.missing > 0 && (
                      <button
                        type="button"
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm transition-colors hover:bg-blue-100 disabled:opacity-50"
                        onClick={() => handleRegenerateMissing(q.id)}
                        disabled={
                          loading ||
                          generatingId === q.id ||
                          Boolean(
                            activeRunId &&
                              activeRunQuizId &&
                              activeRunQuizId !== q.id
                          )
                        }
                        title={`Regenerate ${distractorStats.missing} missing card${distractorStats.missing === 1 ? '' : 's'}`}
                      >
                        {generatingId === q.id && progress
                          ? `Generating ${progress.completed}/${progress.total}${progress.failed ? ` · ${progress.failed} failed` : ''}…`
                          : `Regenerate Missing (${distractorStats.missing})`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => handleGenerateDistractors(q.id)}
                      disabled={
                        loading ||
                        generatingId === q.id ||
                        Boolean(
                          activeRunId &&
                            activeRunQuizId &&
                            activeRunQuizId !== q.id
                        )
                      }
                    >
                      {generatingId === q.id && progress
                        ? `Generating ${progress.completed}/${progress.total}${progress.failed ? ` · ${progress.failed} failed` : ''}…`
                        : "Regenerate All"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                      onClick={async () => {
                        const payload = buildQuizExportJson(q);
                        await copyTextToClipboard(JSON.stringify(payload, null, 2));
                      }}
                      disabled={loading}
                    >
                      Copy JSON
                    </button>
                    <button
                      type="button"
                      className="ml-auto rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 shadow-sm transition-colors hover:bg-rose-50 disabled:opacity-50"
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

                  {/* Inline Progress Bar (visible during generation) */}
                  {generatingId === q.id && progress && progress.total > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center justify-between text-xs font-medium text-amber-800">
                        <span className="flex items-center gap-2">
                          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Generating distractors…
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono">
                            {progress.completed}/{progress.total}
                            {progress.failed > 0 && (
                              <span className="text-rose-600"> · {progress.failed} failed</span>
                            )}
                          </span>
                          <button
                            type="button"
                            className="rounded-md border border-amber-300 bg-white/60 px-2 py-0.5 text-[10px] font-medium text-amber-900 shadow-sm transition-colors hover:bg-white"
                            onClick={cancelActiveGeneration}
                            disabled={!activeRunId}
                          >
                            Cancel
                          </button>
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-amber-100">
                        <div
                          className="h-full bg-amber-500 transition-all duration-300"
                          style={{
                            width: `${progress.total > 0
                              ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
                              : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Sections List */}
                  {(() => {
                    const sections = getSections(q);
                    if (sections.length > 1) {
                      return (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            Sections ({sections.length})
                          </div>
                          <div className="space-y-2">
                            {sections.map((section) => {
                              const sectionMedalData = medals[q.id]?.[section.index];
                              const sectionMedals = sectionMedalData?.medals || [];
                              const goldUpgradeInfo = sectionMedalData?.goldUpgradeInfo;
                              return (
                                <div
                                  key={section.index}
                                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm text-slate-900">
                                      {section.name}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                      Cards {section.start + 1}-{section.end} · {section.end - section.start} questions
                                    </div>
                                  </div>
                                  <MedalBadge medals={sectionMedals} goldUpgradeInfo={goldUpgradeInfo} />
                                  <button
                                    type="button"
                                    className="flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-50"
                                    onClick={() => handleStartSection(q, section.index)}
                                    disabled={loading}
                                  >
                                    Start
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Section Selector Modal */}
      {selectingSection && (() => {
        const sections = getSections(selectingSection);
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
            onClick={() => setSelectingSection(null)}
          >
            <div
              className="w-full max-w-md rounded-t-2xl bg-white sm:rounded-2xl shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-slate-900">Select Section</h3>
                <p className="mt-1 text-sm text-slate-500">{selectingSection.root.type}</p>
              </div>
              <div className="max-h-96 overflow-y-auto p-4">
                <div className="space-y-2">
                  {sections.map((section) => (
                    <button
                      key={section.index}
                      type="button"
                      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-amber-300 hover:bg-amber-50"
                      onClick={() => {
                        handleStartSection(selectingSection, section.index);
                        setSelectingSection(null);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900">{section.name}</span>
                        <span className="text-sm text-slate-500">
                          Cards {section.start + 1}-{section.end}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {section.end - section.start} questions
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-slate-200 px-6 py-4">
                <button
                  type="button"
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                  onClick={() => setSelectingSection(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Section Editor Modal */}
      {editingSections && (() => {
        const cards = editingSections.cards;
        const sortedMarkers = [...sectionMarkers].sort((a, b) => a - b);

        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center overflow-y-auto"
            onClick={() => setEditingSections(null)}
          >
            <div
              className="w-full max-w-2xl my-8 rounded-t-2xl bg-white sm:rounded-2xl shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-slate-900">Edit Sections</h3>
                <p className="mt-1 text-sm text-slate-500">{editingSections.root.type} - {cards.length} cards</p>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-6">
                <div className="space-y-1">
                  {cards.map((card, index) => {
                    const isMarker = sortedMarkers.includes(index);
                    const markerIndex = sortedMarkers.indexOf(index);
                    const sectionName = sectionNames[markerIndex + 1];

                    return (
                      <div key={index}>
                        {/* Section Header (if this is a marker) */}
                        {isMarker && (
                          <div className="mb-2 flex items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
                            <input
                              type="text"
                              value={sectionName || `Section ${markerIndex + 2}`}
                              onChange={(e) => updateSectionName(markerIndex + 1, e.target.value)}
                              className="flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-sm font-medium text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                              placeholder="Section name"
                            />
                            <button
                              type="button"
                              className="rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-600 shadow-sm transition-colors hover:bg-rose-50"
                              onClick={() => toggleMarker(index)}
                              title="Remove section marker"
                            >
                              Remove
                            </button>
                          </div>
                        )}

                        {/* Card Preview */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-xs font-medium text-slate-500">
                                  Card {index + 1} · {card.type}
                                </div>
                                {card.questionType === "multi" && (
                                  <span className="flex-shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                    Multi
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 font-mono text-sm text-slate-900 break-all line-clamp-2">
                                {card.text || "No answer"}
                              </div>
                              {card.questionType === "multi" && card.multiCorrect && card.multiCorrect.length > 1 && (
                                <div className="mt-1 text-xs text-slate-500">
                                  + {card.multiCorrect.length - 1} more answer{card.multiCorrect.length > 2 ? 's' : ''}
                                </div>
                              )}
                            </div>
                            {/* View Context Button */}
                            <button
                              type="button"
                              className="flex-shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                              onClick={() => setViewingContext(index)}
                              title="View code context"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Add Marker Button (between cards, except after last card) */}
                        {index < cards.length - 1 && (
                          <div className="flex justify-center py-2">
                            <button
                              type="button"
                              className={`rounded-lg px-4 py-2 text-xs font-medium shadow-sm transition-all ${sortedMarkers.includes(index + 1)
                                ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                              onClick={() => toggleMarker(index + 1)}
                            >
                              {sortedMarkers.includes(index + 1) ? (
                                <span className="flex items-center gap-1">
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                  </svg>
                                  Section Marker
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                  Add Section Marker
                                </span>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Section Summary */}
                {sortedMarkers.length > 0 && (
                  <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <h4 className="text-sm font-semibold text-blue-900">
                      {sortedMarkers.length + 1} Section{sortedMarkers.length + 1 === 1 ? "" : "s"}
                    </h4>
                    <div className="mt-2 space-y-1 text-xs text-blue-700">
                      {/* First section: from 0 to first marker */}
                      {(() => {
                        const start = 0;
                        const end = sortedMarkers[0];
                        const name = sectionNames[0] || "Section 1";
                        return (
                          <div key={0}>
                            {name}: Cards {start + 1}-{end} ({end - start} questions)
                          </div>
                        );
                      })()}
                      {/* Middle sections: from marker[i] to marker[i+1] */}
                      {sortedMarkers.slice(0, -1).map((marker, idx) => {
                        const start = marker;
                        const end = sortedMarkers[idx + 1];
                        const name = sectionNames[idx + 1] || `Section ${idx + 2}`;
                        return (
                          <div key={idx + 1}>
                            {name}: Cards {start + 1}-{end} ({end - start} questions)
                          </div>
                        );
                      })}
                      {/* Last section: from last marker to end */}
                      {(() => {
                        const start = sortedMarkers[sortedMarkers.length - 1];
                        const end = cards.length;
                        const name = sectionNames[sortedMarkers.length] || `Section ${sortedMarkers.length + 1}`;
                        return (
                          <div key={sortedMarkers.length}>
                            {name}: Cards {start + 1}-{end} ({end - start} questions)
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 px-6 py-4">
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                    onClick={() => setEditingSections(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600"
                    onClick={handleSaveSections}
                  >
                    Save Sections
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Context Viewer Modal */}
      {viewingContext !== null && editingSections && (() => {
        const cards = editingSections.cards;
        const currentCard = cards[viewingContext];

        // Build progressive reveal text
        const buildContext = () => {
          const lines: string[] = [];

          // Accumulate all cards up to and including the current one
          for (let i = 0; i <= viewingContext; i++) {
            const card = cards[i];
            if (card.text) {
              lines.push(card.text);
            }
          }

          return lines.join('\n');
        };

        const contextText = buildContext();

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setViewingContext(null)}
          >
            <div
              className="w-full max-w-3xl max-h-[80vh] rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-slate-900">Code Context</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Showing code up to Card {viewingContext + 1}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-900">
                <pre className="font-mono text-sm text-slate-100 whitespace-pre-wrap break-words">
                  {contextText || "No code context available"}
                </pre>
              </div>

              <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    {viewingContext + 1} / {cards.length} cards shown
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                    onClick={() => setViewingContext(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
