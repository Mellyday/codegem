"use client";
import { useEffect, useState } from "react";
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
    let cancelled = false;
    (async () => {
      await load({ shouldUpdate: () => !cancelled });
    })();
    return () => {
      cancelled = true;
    };
    // reload when fileKey changes
  }, [fileKey?.kind, fileKey?.id, fileKey?.path]);

  const handleGenerateDistractors = async (quizId: string) => {
    // Only enable debug mode in development
    const isDev = process.env.NODE_ENV === "development";

    // Import debug store functions only in dev to avoid bundling in production
    let debugStore: {
      createRun: typeof import("@/src/lib/distractorDebugStore").createRun;
      addBatchToRun: typeof import("@/src/lib/distractorDebugStore").addBatchToRun;
      updateBatch: typeof import("@/src/lib/distractorDebugStore").updateBatch;
      completeRun: typeof import("@/src/lib/distractorDebugStore").completeRun;
    } | null = null;

    if (isDev) {
      debugStore = await import("@/src/lib/distractorDebugStore");
    }

    // Fix #10: Add AbortController for unmount/cancel handling
    const abortController = new AbortController();
    let cancelled = false;

    const decoder = new TextDecoder();
    let buffer = "";
    let runId: string | undefined;
    let batchSize = 20; // default
    let totalCards = 0;
    let serverProvider = "deepseek";
    let serverModel = "deepseek-chat";

    const handleLine = (line: string) => {
      if (!line || cancelled) return;
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
        if (!cancelled) {
          setProgress({
            total: evt.total ?? 0,
            completed: 0,
            failed: 0,
          });
        }
        // Create debug run only in dev
        if (isDev && debugStore) {
          const run = debugStore.createRun({
            quizId,
            totalCards,
            batchSize,
            provider: serverProvider,
            model: serverModel,
          });
          runId = run.runId;
        }
      } else if (evt.type === "progress") {
        if (!cancelled) {
          setProgress({
            total: evt.total ?? 0,
            completed: evt.completed ?? 0,
            failed: evt.failed ?? 0,
          });
        }
      } else if (evt.type === "batch-detail" && runId && isDev && debugStore) {
        // Save batch detail to debug log (dev only)
        if (evt.phase === "start") {
          debugStore.addBatchToRun(runId, {
            batchId: evt.batchId,
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
          debugStore.updateBatch(runId, evt.batchId, {
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
        if (!cancelled) {
          setStatus(
            `Generated distractors for ${updated} card${updated === 1 ? "" : "s"}.`
          );
        }
        if (runId && isDev && debugStore) {
          debugStore.completeRun(runId, "completed");
        }
      } else if (evt.type === "error") {
        if (runId && isDev && debugStore) {
          debugStore.completeRun(runId, "failed");
        }
        throw new Error(evt.error || "Failed to generate distractors.");
      }
    };
    try {
      setGeneratingId(quizId);
      setStatus(undefined);
      setProgress(null);
      // isDev is already defined at the top of handleGenerateDistractors
      const res = await fetch(
        `/api/quizzes/${encodeURIComponent(quizId)}/distractors?progress=1${isDev ? "&debug=1" : ""}`,
        {
          method: "POST",
          cache: "no-store",
          signal: abortController.signal,
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
      // Only set error status if not cancelled/aborted
      if (!cancelled && e?.name !== "AbortError") {
        setStatus(e?.message || "Failed to generate distractors.");
      }
      if (runId && isDev && debugStore) {
        debugStore.completeRun(runId, "failed");
      }
    } finally {
      cancelled = true; // Mark as cancelled to prevent any pending handleLine calls
      if (!abortController.signal.aborted) {
        setGeneratingId(undefined);
        setProgress(null);
        await load();
      }
    }
  };

  const handleRegenerateMissing = async (quizId: string) => {
    // Reuse the same logic as handleGenerateDistractors but with missingOnly flag
    const isDev = process.env.NODE_ENV === "development";

    let debugStore: {
      createRun: typeof import("@/src/lib/distractorDebugStore").createRun;
      addBatchToRun: typeof import("@/src/lib/distractorDebugStore").addBatchToRun;
      updateBatch: typeof import("@/src/lib/distractorDebugStore").updateBatch;
      completeRun: typeof import("@/src/lib/distractorDebugStore").completeRun;
    } | null = null;

    if (isDev) {
      debugStore = await import("@/src/lib/distractorDebugStore");
    }

    const abortController = new AbortController();
    let cancelled = false;

    const decoder = new TextDecoder();
    let buffer = "";
    let runId: string | undefined;
    let batchSize = 20;
    let totalCards = 0;
    let serverProvider = "deepseek";
    let serverModel = "deepseek-chat";

    const handleLine = (line: string) => {
      if (!line || cancelled) return;
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
        serverProvider = evt.provider ?? "deepseek";
        serverModel = evt.model ?? "deepseek-chat";
        const skipped = evt.skipped ?? 0;
        if (!cancelled) {
          setProgress({
            total: evt.total ?? 0,
            completed: 0,
            failed: 0,
          });
          if (skipped > 0) {
            setStatus(`Skipped ${skipped} card${skipped === 1 ? '' : 's'} with distractors. Regenerating ${totalCards} missing...`);
          }
        }
        if (isDev && debugStore) {
          const run = debugStore.createRun({
            quizId,
            totalCards,
            batchSize,
            provider: serverProvider,
            model: serverModel,
          });
          runId = run.runId;
        }
      } else if (evt.type === "progress") {
        if (!cancelled) {
          setProgress({
            total: evt.total ?? 0,
            completed: evt.completed ?? 0,
            failed: evt.failed ?? 0,
          });
        }
      } else if (evt.type === "batch-detail" && runId && isDev && debugStore) {
        if (evt.phase === "start") {
          debugStore.addBatchToRun(runId, {
            batchId: evt.batchId,
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
          debugStore.updateBatch(runId, evt.batchId, {
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
        const skipped = evt.skipped ?? 0;
        if (!cancelled) {
          setStatus(
            `Generated distractors for ${updated} missing card${updated === 1 ? "" : "s"}. ${skipped > 0 ? `Skipped ${skipped} complete.` : ''}`
          );
        }
        if (runId && isDev && debugStore) {
          debugStore.completeRun(runId, "completed");
        }
      } else if (evt.type === "error") {
        if (runId && isDev && debugStore) {
          debugStore.completeRun(runId, "failed");
        }
        throw new Error(evt.error || "Failed to generate distractors.");
      }
    };

    try {
      setGeneratingId(quizId);
      setStatus(undefined);
      setProgress(null);
      const res = await fetch(
        `/api/quizzes/${encodeURIComponent(quizId)}/distractors?progress=1&missingOnly=1${isDev ? "&debug=1" : ""}`,
        {
          method: "POST",
          cache: "no-store",
          signal: abortController.signal,
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
      if (!cancelled && e?.name !== "AbortError") {
        setStatus(e?.message || "Failed to generate distractors.");
      }
      if (runId && isDev && debugStore) {
        debugStore.completeRun(runId, "failed");
      }
    } finally {
      cancelled = true;
      if (!abortController.signal.aborted) {
        setGeneratingId(undefined);
        setProgress(null);
        await load();
      }
    }
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

      {/* Progress Indicator */}
      {progress && progress.total > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>Generating distractors</span>
            <span className="font-mono">
              {progress.completed}/{progress.total}
              {progress.failed ? ` · ${progress.failed} failed` : ""}
            </span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
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

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
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
                        disabled={loading || generatingId === q.id}
                        title={`Regenerate ${distractorStats.missing} missing card${distractorStats.missing === 1 ? '' : 's'}`}
                      >
                        {generatingId === q.id ? "Generating…" : `Regenerate Missing (${distractorStats.missing})`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => handleGenerateDistractors(q.id)}
                      disabled={loading || generatingId === q.id}
                    >
                      {generatingId === q.id ? "Generating…" : "Regenerate All"}
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
