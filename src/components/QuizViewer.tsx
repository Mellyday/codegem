import { Suspense } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, FileUp, FolderUp, Code, HelpCircle } from "lucide-react";
import type { TreeSitterAstNode } from "../lib/treeSitter";
import { randomString, shuffleArray } from "../lib/utils";
import { getLanguageToolsForFileName } from "../lib/languages/registry";
import { ErrorBoundary } from "./ErrorBoundary";
import { SavedCustomQuizzesPanel } from "./SavedCustomQuizzesPanel";

// Constants moved inside component
type QuizMode = "setup" | "active" | "complete";

export type QuizViewerProps = {
  root: TreeSitterAstNode;
  // Full source code for computing exact text of nodes
  code?: string;
  // File context to load saved custom quizzes
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  fileName?: string;
  // Session-scoped storage key for in-progress quiz persistence
  progressStorageKey?: string;
  mode: QuizMode;
  onStart: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onReturnToAst: () => void;
  onReturnToSetup: () => void;
  // Notify parent of the absolute end index to reveal in the code viewer
  onRevealChange?: (endIndex: number | undefined) => void;
  // Medal tracking for saved quizzes
  quizId?: string;
  sectionIndex?: number;
  // Callback to notify parent when quiz metadata changes (starting saved quiz)
  onQuizMetadataChange?: (quizId: string, sectionIndex: number) => void;
  // Navigation URL for Back to Folder action
  parentFolderUrl?: string;
};

type Question = {
  // Human-readable stem for the current question
  stem: string;
  // The label corresponding to the correct answer
  answerLabel: string;
  // Options to display
  options: string[];
  // Multi-select support
  questionType?: "single" | "multi" | "orderedMulti" | "sequence";
  // For multi-select questions, the set of correct labels
  answerLabels?: string[];
  // For multi-select questions, how many to select
  numToSelect?: number;
  // Optional snippet text to show (used by custom quizzes)
  snippetText?: string;
  // Optional v1.1 metadata
  kind?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  sourceRefs?: SourceRef[];
  // For controlling how much of the parent's code to reveal while this question is active
  // Absolute indices within the source file.
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};

type PersistedQuizProgressV1 = {
  version: 1;
  activeQuizMeta?: { quizId?: string; sectionIndex?: number };
  questions: Question[];
  current: number;
  answers: Array<string | string[] | null>;
  answeredFlags: boolean[];
  score: number;
  updatedAt: number;
};

const normalizePool = (pool: string[] | undefined, correct: Set<string>) => {
  if (!Array.isArray(pool)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of pool) {
    const v = String(item ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (correct.has(key) || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(v);
  }
  return cleaned;
};

const sampleDistractors = (
  pool: string[],
  count: number,
  correct: Set<string>
) => {
  const shuffled = shuffleArray(pool.slice());
  const seen = new Set<string>();
  const picks: string[] = [];
  for (const item of shuffled) {
    const v = String(item ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (correct.has(key) || seen.has(key)) continue;
    seen.add(key);
    picks.push(v);
    if (picks.length >= count) break;
  }
  return picks;
};

const buildSingleChoiceOptions = (
  correct: string,
  llmPool?: string[] | null
) => {
  const correctKey = correct.toLowerCase();
  const correctSet = new Set([correctKey]);
  const pool = normalizePool(llmPool ?? undefined, correctSet);
  const distractors = sampleDistractors(pool, 3, correctSet);
  while (distractors.length < 3) {
    const d = randomString(
      Math.max(4, Math.min(8, String(correct || "").length || 6))
    );
    const key = d.toLowerCase();
    if (
      !correctSet.has(key) &&
      !distractors.some((x) => x.toLowerCase() === key)
    ) {
      distractors.push(d);
    }
  }
  return shuffleArray([correct, ...distractors]);
};

const MULTI_OPTION_TARGET = 10;
const buildMultiChoiceOptions = (
  correct: string[],
  llmPool?: string[] | null,
  fallbackPool?: string[] | null
) => {
  const correctSet = new Set(correct.map((c) => c.toLowerCase()));
  const falseNeeded = Math.max(0, MULTI_OPTION_TARGET - correct.length);
  const poolSource = [
    ...(Array.isArray(llmPool) ? llmPool : []),
    ...(Array.isArray(fallbackPool) ? fallbackPool : []),
  ];
  const pool = normalizePool(poolSource, correctSet);
  const distractors = sampleDistractors(pool, falseNeeded, correctSet);
  while (distractors.length < falseNeeded) {
    const d = randomString(6);
    const key = d.toLowerCase();
    if (
      !correctSet.has(key) &&
      !distractors.some((x) => x.toLowerCase() === key)
    ) {
      distractors.push(d);
    }
  }
  const options = shuffleArray([...correct, ...distractors]);
  return options;
};

const buildSequenceOptions = (
  correct: string[],
  llmPool?: string[] | null,
  fallbackPool?: string[] | null
) => {
  const uniqueCorrect = Array.from(new Set(correct));
  const correctSet = new Set(uniqueCorrect.map((c) => c.toLowerCase()));
  const falseNeeded = Math.max(0, MULTI_OPTION_TARGET - uniqueCorrect.length);
  const poolSource = [
    ...(Array.isArray(llmPool) ? llmPool : []),
    ...(Array.isArray(fallbackPool) ? fallbackPool : []),
  ];
  const pool = normalizePool(poolSource, correctSet);
  const distractors = sampleDistractors(pool, falseNeeded, correctSet);
  while (distractors.length < falseNeeded) {
    const d = randomString(6);
    const key = d.toLowerCase();
    if (
      !correctSet.has(key) &&
      !distractors.some((x) => x.toLowerCase() === key)
    ) {
      distractors.push(d);
    }
  }
  return shuffleArray([...uniqueCorrect, ...distractors]).slice(0, MULTI_OPTION_TARGET);
};

// v1.1: stable reference to an AST node or slice
type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

// Saved Custom Quiz structures (v1 and v1.1)
type SavedCustomQuizCardV11 = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  // v1.1 additions
  sourceRef?: SourceRef;
  semanticRole?: string;
  question?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  // multi-select (optional)
  questionType?: "single" | "multi" | "orderedMulti" | "sequence";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  // optional LLM distractors pool (future enrichment)
  llmDistractors?: string[];
  // optional progressive reveal anchors
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};

type SavedCustomQuizV11 = {
  id: string;
  kind: "custom-quiz";
  createdAt: string;
  typeLabel?: string; // e.g., CustomQuizV1.1
  profile?: "shallow" | "normal" | "deep";
  root: {
    type: string;
    text?: string;
    start?: number;
    end?: number;
    path?: number[];
  };
  totalCards: number;
  cards: SavedCustomQuizCardV11[];
  // Section markers: array of card indices where new sections begin
  // e.g., [0, 5, 10] creates sections: 0-4, 5-9, 10-end
  sectionMarkers?: number[];
  // Optional custom names for each section
  sectionNames?: string[];
};

// fetching of saved quizzes moved to SavedCustomQuizzesPanel

const generateQuestionsFromCustom = (
  quiz: SavedCustomQuizV11,
  code?: string
): Question[] => {
  // Trust saved cards; do not reconstruct answers for multi-select.
  const cards = quiz.cards
    .filter((c) => c.action !== "dig")
    .slice()
    .sort((a, b) => a.order - b.order);
  const qs: Question[] = [];

  for (const c of cards) {
    const multiCorrect = Array.isArray(c.multiCorrect) ? c.multiCorrect : undefined;
    const hasMultiCorrect = !!multiCorrect;
    const isSequence = c.questionType === "sequence" && hasMultiCorrect;
    if (isSequence) {
      const correct = multiCorrect ?? [];
      const llmPool = Array.isArray(c.llmDistractors) ? c.llmDistractors : undefined;
      const optionPool = Array.isArray(c.optionPool) ? c.optionPool : undefined;
      const options = buildSequenceOptions(correct, llmPool, optionPool);
      qs.push({
        stem: c.question || "Build the sequence in order.",
        answerLabel: "", // unused for sequence
        options,
        questionType: "sequence",
        answerLabels: correct,
        numToSelect: correct.length,
        kind: c.type,
        generatorRule: c.generatorRule,
        difficulty: c.difficulty,
        sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
        snippetText: c.text,
        revealStart: typeof c.revealStart === "number" ? c.revealStart : undefined,
        revealEndBeforeChild:
          typeof c.revealEndBeforeChild === "number"
            ? c.revealEndBeforeChild
            : undefined,
        revealEndAfterChild:
          typeof c.revealEndAfterChild === "number"
            ? c.revealEndAfterChild
            : undefined,
      });
      continue;
    }
    const isOrderedMulti = c.questionType === "orderedMulti" && hasMultiCorrect;
    const isMulti =
      (c.questionType === "multi" || isOrderedMulti || (!c.questionType && hasMultiCorrect)) &&
      hasMultiCorrect;
    if (isMulti) {
      const stem =
        c.question || (isOrderedMulti ? "Select the answers in order." : "Select all that apply.");
      const correct = multiCorrect ?? [];
      const llmPool = Array.isArray(c.llmDistractors) ? c.llmDistractors : undefined;
      const optionPool = Array.isArray(c.optionPool) ? c.optionPool : undefined;
      const options = buildMultiChoiceOptions(correct, llmPool, optionPool);
      const numToSelect =
        typeof c.multiSelectHint === "number" ? c.multiSelectHint : correct.length;
      qs.push({
        stem,
        answerLabel: "", // unused for multi
        options,
        questionType: isOrderedMulti ? "orderedMulti" : "multi",
        answerLabels: correct,
        numToSelect,
        kind: c.type,
        generatorRule: c.generatorRule,
        difficulty: c.difficulty,
        sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
        snippetText: c.text,
        // carry reveal anchors if present (enables initial progressive reveal)
        revealStart: typeof c.revealStart === "number" ? c.revealStart : undefined,
        revealEndBeforeChild:
          typeof c.revealEndBeforeChild === "number"
            ? c.revealEndBeforeChild
            : undefined,
        revealEndAfterChild:
          typeof c.revealEndAfterChild === "number"
            ? c.revealEndAfterChild
            : undefined,
      });
      continue;
    }

    // Single-choice fallback
    const correct = c.text || "";
    const stem = c.question || "What comes next?";
    const llmPool = Array.isArray(c.llmDistractors) ? c.llmDistractors : undefined;
    const options = buildSingleChoiceOptions(correct, llmPool);
    qs.push({
      stem,
      answerLabel: correct,
      options,
      questionType: "single",
      kind: c.type,
      generatorRule: c.generatorRule,
      difficulty: c.difficulty,
      sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
      // carry reveal anchors if present
      revealStart: typeof c.revealStart === "number" ? c.revealStart : undefined,
      revealEndBeforeChild:
        typeof c.revealEndBeforeChild === "number"
          ? c.revealEndBeforeChild
          : undefined,
      revealEndAfterChild:
        typeof c.revealEndAfterChild === "number"
          ? c.revealEndAfterChild
          : undefined,
    });
  }

  return qs;
};

// Compute reveal anchors for a question, with robust fallbacks so that
// older quizzes (that only have sourceRefs) still drive the code viewer.
const revealBeforeForQuestion = (q: Question | undefined): number | undefined => {
  if (!q) return undefined;
  if (typeof q.revealEndBeforeChild === "number") return q.revealEndBeforeChild;
  if (typeof q.revealStart === "number") return q.revealStart;
  const firstRef = Array.isArray(q.sourceRefs) ? q.sourceRefs[0] : undefined;
  if (firstRef && typeof firstRef.start === "number") return firstRef.start;
  return undefined;
};

const revealAfterForQuestion = (q: Question | undefined): number | undefined => {
  if (!q) return undefined;
  if (typeof q.revealEndAfterChild === "number") return q.revealEndAfterChild;
  const firstRef = Array.isArray(q.sourceRefs) ? q.sourceRefs[0] : undefined;
  if (firstRef && typeof firstRef.end === "number") return firstRef.end;
  if (typeof q.revealEndBeforeChild === "number") return q.revealEndBeforeChild;
  if (typeof q.revealStart === "number") return q.revealStart;
  return undefined;
};

// Heuristic helpers use the language engine when available.

export const QuizViewer = ({
  root,
  code,
  fileKey,
  fileName,
  progressStorageKey,
  mode,
  onStart,
  onCancel,
  onComplete,
  onReturnToAst,
  onReturnToSetup,
  onRevealChange,
  quizId,
  sectionIndex,
  onQuizMetadataChange,
  parentFolderUrl,
}: QuizViewerProps) => {
  const { engine } = useMemo(
    () => getLanguageToolsForFileName(fileName ?? fileKey?.path),
    [fileName, fileKey?.path]
  );
  // Custom quiz selection state
  const [selectedCustom, setSelectedCustom] = useState<
    SavedCustomQuizV11 | undefined
  >(undefined);
  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());
  const [selectedOrdered, setSelectedOrdered] = useState<string[]>([]);
  const [selectedSequence, setSelectedSequence] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  // Persist answers per question index so navigation retains choices
  const [answers, setAnswers] = useState<Array<string | string[] | undefined>>(
    []
  );
  const [answeredFlags, setAnsweredFlags] = useState<boolean[]>([]);
  // Track per-option expansion state (keyed by question+option index)
  const [expandedOptions, setExpandedOptions] = useState<
    Record<string, boolean>
  >({});
  const [activeQuizMeta, setActiveQuizMeta] = useState<{
    quizId?: string;
    sectionIndex?: number;
  }>({});

  const didInitializeRef = useRef(false);

  const clearProgress = () => {
    if (!progressStorageKey) return;
    try {
      sessionStorage.removeItem(progressStorageKey);
    } catch {
      // ignore
    }
  };

  const persistNow = (payload: PersistedQuizProgressV1) => {
    if (!progressStorageKey) return;
    try {
      sessionStorage.setItem(progressStorageKey, JSON.stringify(payload));
    } catch {
      // ignore persist errors (storage full/private mode)
    }
  };

  useEffect(() => {
    if (mode !== "active") {
      didInitializeRef.current = false;
    }
  }, [mode]);

  // Restore in-progress quiz state on refresh (session-scoped).
  useEffect(() => {
    if (mode !== "active") return;
    if (!progressStorageKey) return;
    if (didInitializeRef.current) return;

    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(progressStorageKey);
    } catch {
      raw = null;
    }
    if (!raw) return;

    let data: PersistedQuizProgressV1 | undefined;
    try {
      data = JSON.parse(raw) as PersistedQuizProgressV1;
    } catch {
      return;
    }
    if (!data || data.version !== 1) return;
    if (!Array.isArray(data.questions) || data.questions.length === 0) return;
    if (!Array.isArray(data.answers) || !Array.isArray(data.answeredFlags)) return;

    didInitializeRef.current = true;

    const qs = data.questions as unknown as Question[];
    const total = qs.length;
    const clampedCurrent = Math.min(
      Math.max(0, Math.floor(Number(data.current ?? 0))),
      Math.max(0, total - 1)
    );
    const answersRestored = (data.answers ?? []).slice(0, total).map((a) => {
      if (a === null) return undefined;
      return a;
    }) as Array<string | string[] | undefined>;
    const answeredFlagsRestored = (data.answeredFlags ?? [])
      .slice(0, total)
      .map((v) => !!v);

    setActiveQuizMeta(data.activeQuizMeta ?? {});
    setQuestions(qs);
    setCurrent(clampedCurrent);
    setAnswers(answersRestored);
    setAnsweredFlags(answeredFlagsRestored);
    setScore(Number.isFinite(data.score) ? data.score : 0);
    setExpandedOptions({});

    const curQ = qs[clampedCurrent];
    const curAns = answersRestored[clampedCurrent];
    if (Array.isArray(curAns)) {
      setSelected(undefined);
      setSelectedMulti(new Set());
      setSelectedOrdered([]);
      setSelectedSequence([]);
      if (curQ?.questionType === "sequence") {
        setSelectedSequence(curAns);
      } else if (curQ?.questionType === "orderedMulti") {
        setSelectedOrdered(curAns);
      } else {
        setSelectedMulti(new Set(curAns));
      }
    } else {
      setSelected(curAns as string | undefined);
      setSelectedMulti(new Set());
      setSelectedOrdered([]);
      setSelectedSequence([]);
    }

    const meta = data.activeQuizMeta;
    if (meta?.quizId && typeof meta.sectionIndex === "number") {
      onQuizMetadataChange?.(meta.quizId, meta.sectionIndex);
    }
    onRevealChange?.(revealBeforeForQuestion(qs[clampedCurrent]));
  }, [mode, progressStorageKey, onQuizMetadataChange, onRevealChange]);

  // Save a generated heuristic quiz to the database via /api/quizzes
  const saveHeuristicQuiz = async (
    quiz: any,
    vroot: TreeSitterAstNode,
    name: string
  ) => {
    const payload = {
      fileKey,
      name,
      type: "CustomQuizV1.1" as const,
      profile: quiz.profile as any,
      rootNode: {
        type: vroot.type,
        text:
          typeof code === "string"
            ? code.substring(vroot.startIndex, vroot.endIndex)
            : undefined,
        start: vroot.startIndex,
        end: vroot.endIndex,
      },
      cards: (quiz.cards || []).map((c: any) => ({
        order: c.order,
        type: c.type,
        text: String(c.text ?? ""),
        action: c.action || "next",
        question: c.question || c.stem,
        generatorRule: c.generatorRule,
        difficulty: c.difficulty,
        sourceRef: c.sourceRef,
        questionType: c.questionType,
        multiCorrect: c.multiCorrect,
        multiSelectHint: c.multiSelectHint,
        optionPool: c.optionPool,
        llmDistractors: c.llmDistractors,
        // persist reveal anchors when present on generated cards
        revealStart: c.revealStart,
        revealEndBeforeChild: c.revealEndBeforeChild,
        revealEndAfterChild: c.revealEndAfterChild,
      })),
    };
    const res = await fetch("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg += ` — ${data.error}`;
      } catch { }
      throw new Error(msg);
    }
  };

  const buildEnginePayload = (
    vroot: TreeSitterAstNode,
    profile: "shallow" | "deep"
  ) => {
    const steps = engine.generateEngineSteps(vroot, vroot, code || "", {
      profile,
      includeNames: false,
      generateQuiz: true,
    }) as any[];
    return engine.buildCustomQuizPayload({
      fileKey,
      root: vroot,
      code: code || "",
      history: [],
      lessonQueue: steps as any,
      currentStep: 0,
    }) as any;
  };

  const saveEngineQuiz = async (
    payload: any,
    vroot: TreeSitterAstNode,
    name: string,
    profile: "shallow" | "deep"
  ) => {
    const rootText =
      typeof code === "string"
        ? code.substring(vroot.startIndex, vroot.endIndex)
        : payload?.rootNode?.text;
    const quizPayload = {
      ...payload,
      fileKey,
      name,
      profile,
      rootNode: payload?.rootNode || {
        type: vroot.type,
        text: rootText,
        start: vroot.startIndex,
        end: vroot.endIndex,
      },
    };
    if (!quizPayload.rootNode?.text && typeof code === "string") {
      quizPayload.rootNode.text = rootText;
    }
    const res = await fetch("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quizPayload),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg += ` — ${data.error}`;
      } catch { }
      throw new Error(msg);
    }
  };

  useEffect(() => {
    if (mode === "active") {
      if (didInitializeRef.current) return;
      didInitializeRef.current = true;
      const qs = generateQuestionsFromCustom(selectedCustom as SavedCustomQuizV11, code);
      setQuestions(qs);
      setCurrent(0);
      setSelected(undefined);
      setSelectedMulti(new Set());
      setSelectedOrdered([]);
      setSelectedSequence([]);
      setScore(0);
      setAnswers(new Array(qs.length).fill(undefined));
      setAnsweredFlags(new Array(qs.length).fill(false));
      setExpandedOptions({});
      // Initial reveal window for the first question.
      const initialReveal = qs.length > 0 ? revealBeforeForQuestion(qs[0]) : undefined;
      onRevealChange?.(initialReveal);

      // Persist immediately so a fast refresh doesn't drop the run.
      const persistableQuestions = qs.map((q) => ({ ...q }));
      persistNow({
        version: 1,
        activeQuizMeta,
        questions: persistableQuestions,
        current: 0,
        answers: new Array(qs.length).fill(null),
        answeredFlags: new Array(qs.length).fill(false),
        score: 0,
        updatedAt: Date.now(),
      });
    }
  }, [mode, code, selectedCustom]);

  // Clear reveal when leaving quiz modes
  useEffect(() => {
    if (mode !== "active") {
      onRevealChange?.(undefined);
    }
  }, [mode, onRevealChange]);

  // Persist progress while the quiz is active.
  useEffect(() => {
    if (mode !== "active") return;
    if (!progressStorageKey) return;
    if (!questions.length) return;

    const handle = window.setTimeout(() => {
      const persistableQuestions = questions.map((q) => ({ ...q }));
      persistNow({
        version: 1,
        activeQuizMeta,
        questions: persistableQuestions,
        current,
        answers: answers.map((a) => (typeof a === "undefined" ? null : a)),
        answeredFlags,
        score,
        updatedAt: Date.now(),
      });
    }, 150);

    return () => window.clearTimeout(handle);
  }, [
    mode,
    progressStorageKey,
    activeQuizMeta,
    questions,
    current,
    answers,
    answeredFlags,
    score,
  ]);

  const total = questions.length;
  const currentQ = questions[current];



  const renderSetup = () => {
    return (
      <div className="space-y-6">
        {/* Generate & Save Preset */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Generate & Save Preset
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Shallow Option */}
            <button
              type="button"
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-purple-300 hover:shadow-md"
              onClick={() => {
                if (!root) return;
                const payload = buildEnginePayload(root, "shallow");
                saveEngineQuiz(
                  payload,
                  root,
                  "Heuristic shallow",
                  "shallow"
                )
                  .then(() => alert("Saved heuristic shallow quiz."))
                  .catch(() => alert("Failed to save heuristic shallow quiz."));
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 transition-colors group-hover:bg-purple-100">
                  <svg className="h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900">Shallow</h3>
                  <p className="mt-1 text-sm text-slate-600">Line-by-line</p>
                </div>
              </div>
            </button>

            {/* Deep Option */}
            <button
              type="button"
              className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-pink-300 hover:shadow-md"
              onClick={() => {
                if (!root) return;
                const payload = buildEnginePayload(root, "deep");
                saveEngineQuiz(payload, root, "Heuristic deep", "deep")
                  .then(() => alert("Saved heuristic deep quiz."))
                  .catch(() => alert("Failed to save heuristic deep quiz."));
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-50 transition-colors group-hover:bg-pink-100">
                  <svg className="h-5 w-5 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900">Deep</h3>
                  <p className="mt-1 text-sm text-slate-600">Expression detail</p>
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Saved Quizzes */}
        <ErrorBoundary
          fallback={
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
              Failed to load quizzes.
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Loading saved quizzes…
              </div>
            }
          >
            <SavedCustomQuizzesPanel
              fileKey={fileKey}
              onStartSaved={(q, qId, secIdx) => {
                // panel is isolated; only it remounts on refresh/errors
                setSelectedCustom(q as any);
                setActiveQuizMeta({ quizId: qId, sectionIndex: secIdx });
                // Notify parent of quiz metadata for medal tracking
                onQuizMetadataChange?.(qId, secIdx);
                clearProgress();
                onStart();
              }}
            />
          </Suspense>
        </ErrorBoundary>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            onClick={onCancel}
          >
            Back to File
          </button>
        </div>
      </div>
    );
  };
  const renderActive = () => {
    if (!currentQ) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Generating questions…
        </div>
      );
    }

    const isSequence =
      currentQ.questionType === "sequence" &&
      Array.isArray(currentQ.answerLabels);
    const isOrderedMulti =
      currentQ.questionType === "orderedMulti" &&
      Array.isArray(currentQ.answerLabels);
    const isMulti =
      (currentQ.questionType === "multi" || isOrderedMulti) &&
      Array.isArray(currentQ.answerLabels);
    const correctLabels = (isMulti || isSequence)
      ? (currentQ.answerLabels as string[])
      : [];
    const correctSet = new Set<string>(correctLabels);
    const selectionTarget =
      typeof currentQ.numToSelect === "number"
        ? currentQ.numToSelect
        : correctLabels.length;
    const sequenceTarget = isSequence ? correctLabels.length : 0;
    const isAnswered = answeredFlags[current] || false;
    const unorderedCorrect =
      isAnswered &&
      selectedMulti.size === correctLabels.length &&
      (() => {
        for (const v of selectedMulti) if (!correctSet.has(v)) return false;
        return true;
      })();
    const orderedCorrect =
      isAnswered &&
      selectedOrdered.length === correctLabels.length &&
      selectedOrdered.every((v, idx) => v === correctLabels[idx]);
    const sequenceCorrect =
      isAnswered &&
      selectedSequence.length === correctLabels.length &&
      selectedSequence.every((v, idx) => v === correctLabels[idx]);
    const correct = isSequence
      ? sequenceCorrect
      : isMulti
        ? isOrderedMulti
          ? orderedCorrect
          : unorderedCorrect
        : isAnswered && selected === currentQ.answerLabel;

    const handleSelect = (opt: string) => {
      if (isAnswered) return;
      if (isSequence) return;
      if (isMulti) {
        if (isOrderedMulti) {
          setSelectedOrdered((prev) => {
            const idx = prev.indexOf(opt);
            let next = prev.slice();
            if (idx >= 0) {
              next.splice(idx, 1);
            } else if (!selectionTarget || next.length < selectionTarget) {
              next = [...next, opt];
            }
            setAnswers((prevAns) => {
              const n = prevAns.slice();
              n[current] = next;
              return n;
            });
            return next;
          });
        } else {
          setSelectedMulti((prev) => {
            const next = new Set(prev);
            if (next.has(opt)) next.delete(opt);
            else next.add(opt);
            // keep persisted answers in sync with the toggled set
            setAnswers((prevAns) => {
              const n = prevAns.slice();
              n[current] = Array.from(next);
              return n;
            });
            return next;
          });
        }
      } else {
        setSelected(opt);
        setAnswers((prev) => {
          const next = prev.slice();
          next[current] = opt;
          return next;
        });
        setAnsweredFlags((prev) => {
          const n = prev.slice();
          n[current] = true;
          return n;
        });
        if (opt === currentQ.answerLabel) setScore((s) => s + 1);
        onRevealChange?.(revealAfterForQuestion(currentQ));
      }
    };

    const syncSequenceAnswer = (next: string[]) => {
      setSelectedSequence(next);
      setAnswers((prev) => {
        const n = prev.slice();
        n[current] = next;
        return n;
      });
    };

    const handleSequenceAdd = (opt: string) => {
      if (isAnswered) return;
      if (sequenceTarget && selectedSequence.length >= sequenceTarget) return;
      syncSequenceAnswer([...selectedSequence, opt]);
    };

    const handleSequenceRemove = (idx: number) => {
      if (isAnswered) return;
      if (idx < 0 || idx >= selectedSequence.length) return;
      const next = selectedSequence.slice();
      next.splice(idx, 1);
      syncSequenceAnswer(next);
    };

    const handleSequenceMove = (idx: number, dir: -1 | 1) => {
      if (isAnswered) return;
      const target = idx + dir;
      if (target < 0 || target >= selectedSequence.length) return;
      const next = selectedSequence.slice();
      const temp = next[idx];
      next[idx] = next[target];
      next[target] = temp;
      syncSequenceAnswer(next);
    };

    const handleSubmitMulti = () => {
      if (isAnswered) return;
      setAnsweredFlags((prev) => {
        const n = prev.slice();
        n[current] = true;
        return n;
      });
      const isRight = isSequence
        ? selectedSequence.length === correctLabels.length &&
        selectedSequence.every((v, idx) => v === correctLabels[idx])
        : isOrderedMulti
          ? selectedOrdered.length === correctLabels.length &&
          selectedOrdered.every((v, idx) => v === correctLabels[idx])
          : selectedMulti.size === correctLabels.length &&
          (() => {
            for (const v of selectedMulti) if (!correctSet.has(v)) return false;
            return true;
          })();
      if (isRight) setScore((s) => s + 1);
      onRevealChange?.(revealAfterForQuestion(currentQ));
    };

    const next = async () => {
      if (current + 1 >= total) {
        // Quiz complete - record attempt if quizId exists
        const attemptQuizId = activeQuizMeta.quizId ?? quizId ?? selectedCustom?.id;
        const attemptSectionIndex =
          typeof activeQuizMeta.sectionIndex === "number"
            ? activeQuizMeta.sectionIndex
            : sectionIndex ?? 0;
        if (attemptQuizId) {
          try {
            const requestPayload = {
              quizId: attemptQuizId,
              sectionIndex: attemptSectionIndex,
              totalQuestions: total,
              correctAnswers: score,
            };
            const response = await fetch("/api/quiz-attempts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestPayload),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok) {
              const msg = result?.error || `HTTP ${response.status}`;
              console.error("[QuizViewer] Attempt failed:", msg, result);
            } else {
            }
          } catch (error) {
            console.error("Failed to record quiz attempt:", error);
            // Continue to onComplete even if recording fails
          }
        } else {
        }
        clearProgress();
        onComplete();
      } else {
        const nextIdx = current + 1;
        setCurrent(nextIdx);
        const nextQ = questions[nextIdx];
        const ans = answers[nextIdx];
        if (Array.isArray(ans)) {
          setSelected(undefined);
          setSelectedMulti(new Set());
          setSelectedOrdered([]);
          setSelectedSequence([]);
          if (nextQ?.questionType === "sequence") {
            setSelectedSequence(ans);
          } else if (nextQ?.questionType === "orderedMulti") {
            setSelectedOrdered(ans);
          } else {
            setSelectedMulti(new Set(ans));
          }
        } else {
          setSelected(ans as string | undefined);
          setSelectedMulti(new Set());
          setSelectedOrdered([]);
          setSelectedSequence([]);
        }
        // Update reveal window for the next question if available
        const curAfter = revealAfterForQuestion(currentQ);
        const nextBefore = revealBeforeForQuestion(nextQ);
        const nextReveal =
          typeof curAfter === "number" && typeof nextBefore === "number"
            ? Math.max(curAfter, nextBefore)
            : nextBefore ?? curAfter;
        onRevealChange?.(nextReveal);
      }
    };

    const prev = () => {
      if (current > 0) {
        const idx = current - 1;
        setCurrent(idx);
        const q = questions[idx];
        const ans = answers[idx];
        if (Array.isArray(ans)) {
          setSelected(undefined);
          setSelectedMulti(new Set());
          setSelectedOrdered([]);
          setSelectedSequence([]);
          if (q?.questionType === "sequence") {
            setSelectedSequence(ans);
          } else if (q?.questionType === "orderedMulti") {
            setSelectedOrdered(ans);
          } else {
            setSelectedMulti(new Set(ans));
          }
        } else {
          setSelected(ans as string | undefined);
          setSelectedMulti(new Set());
          setSelectedOrdered([]);
          setSelectedSequence([]);
        }
        onRevealChange?.(revealBeforeForQuestion(q));
      }
    };

    const jumpTo = (idx: number) => {
      if (!Number.isFinite(idx)) return;
      const clamped = Math.min(
        Math.max(0, Math.floor(idx)),
        Math.max(0, total - 1)
      );
      setCurrent(clamped);
      const q = questions[clamped];
      const ans = answers[clamped];
      if (Array.isArray(ans)) {
        setSelected(undefined);
        setSelectedMulti(new Set());
        setSelectedOrdered([]);
        setSelectedSequence([]);
        if (q?.questionType === "sequence") {
          setSelectedSequence(ans);
        } else if (q?.questionType === "orderedMulti") {
          setSelectedOrdered(ans);
        } else {
          setSelectedMulti(new Set(ans));
        }
      } else {
        setSelected(ans as string | undefined);
        setSelectedMulti(new Set());
        setSelectedOrdered([]);
        setSelectedSequence([]);
      }
      onRevealChange?.(revealBeforeForQuestion(q));
    };

    const stepNavItems = (() => {
      const n = total;
      const cur = current;
      if (n <= 1) return [0];
      const items: Array<number | "…"> = [];
      const add = (x: number | "…") => items.push(x);
      const windowRadius = 2;
      const left = Math.max(0, cur - windowRadius);
      const right = Math.min(n - 1, cur + windowRadius);
      add(0);
      if (left > 1) add("…");
      for (let i = left; i <= right; i++) {
        if (i !== 0 && i !== n - 1) add(i);
      }
      if (right < n - 2) add("…");
      if (n - 1 !== 0) add(n - 1);
      return items;
    })();


    return (
      <div className="flex flex-col gap-8 h-full">
        {/* Header with Navigation Icons */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500 flex items-center justify-center">
              <Code className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Custom Quiz</h1>
              <p className="text-sm text-slate-500">
                Q {current + 1} / {total}
              </p>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              title="Back to File"
              onClick={onReturnToAst}
            >
              <FileUp className="w-4 h-4" />
            </button>
            {parentFolderUrl && (
              <a
                href={parentFolderUrl}
                className="h-8 w-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                title="Back to Folder"
              >
                <FolderUp className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* Progress Section */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Progress</span>
            <span className="text-sm text-slate-500">{total ? Math.round(((current + 1) / total) * 100) : 0}%</span>
          </div>
          <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-600 to-cyan-500 transition-all duration-300"
              style={{ width: `${total ? ((current + 1) / total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Step Navigator - chips + desktop slider */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hidden py-1 -mx-1 px-1">
            {stepNavItems.map((it, idx) =>
              typeof it === "number" ? (
                <button
                  key={`s-${idx}-${it}`}
                  type="button"
                  onClick={() => jumpTo(it)}
                  className={
                    it === current
                      ? "min-w-8 h-7 px-2 rounded-md bg-cyan-600 text-white text-xs font-medium shadow-sm"
                      : "min-w-8 h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-600 text-xs hover:bg-slate-50"
                  }
                >
                  {it + 1}
                </button>
              ) : (
                <span key={`e-${idx}`} className="px-0.5 text-slate-400 text-xs">
                  {it}
                </span>
              )
            )}
          </div>
          {/* Desktop slider */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <label htmlFor="q-range" className="text-xs text-slate-400">
              Jump
            </label>
            <input
              id="q-range"
              type="range"
              min={0}
              max={Math.max(0, total - 1)}
              value={current}
              onChange={(e) => jumpTo(Number(e.target.value))}
              className="h-1 w-28 cursor-pointer appearance-none rounded bg-slate-200 accent-cyan-600"
            />
          </div>
        </div>

        {/* Question Card - flex-1 to fill available space */}
        <div className="space-y-6 flex-1">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">{currentQ.stem}</h2>
            <p className="text-sm text-slate-600">
              {isSequence
                ? `Build the sequence${sequenceTarget ? ` (${sequenceTarget})` : ""}.`
                : isMulti
                  ? isOrderedMulti
                    ? `Select in order${selectionTarget ? ` (${selectionTarget})` : ""}.`
                    : "Select all that apply."
                  : "Choose the next part of the code."}
            </p>
          </div>

          {/* Answer Options */}
          {isSequence ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Palette
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentQ.options.map((opt, i) => (
                    <button
                      key={`palette-${current}-${i}`}
                      type="button"
                      onClick={() => handleSequenceAdd(opt)}
                      disabled={
                        isAnswered ||
                        (sequenceTarget > 0 && selectedSequence.length >= sequenceTarget)
                      }
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Your Sequence
                </div>
                {selectedSequence.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400">
                    Add items from the palette.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedSequence.map((item, idx) => (
                      <div
                        key={`seq-${current}-${idx}`}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <span className="text-xs font-semibold text-slate-400">{idx + 1}.</span>
                        <span className="text-sm font-mono text-slate-800">{item}</span>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleSequenceMove(idx, -1)}
                            disabled={isAnswered || idx === 0}
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Move left"
                          >
                            {"<"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSequenceMove(idx, 1)}
                            disabled={isAnswered || idx === selectedSequence.length - 1}
                            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Move right"
                          >
                            {">"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSequenceRemove(idx)}
                            disabled={isAnswered}
                            className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Remove item"
                          >
                            x
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {currentQ.options.map((opt, i) => {
                const isCorrect = isMulti
                  ? correctSet.has(opt)
                  : opt === currentQ.answerLabel;
                const isSelected = isMulti
                  ? isOrderedMulti
                    ? selectedOrdered.includes(opt)
                    : selectedMulti.has(opt)
                  : selected === opt;
                const orderIndex = isOrderedMulti ? selectedOrdered.indexOf(opt) : -1;

                const optionId = `${current}-${i}`;
                const isExpanded = !!expandedOptions[optionId];
                const isLong = opt.length > 100;

                return (
                  <button
                    key={optionId}
                    type="button"
                    onClick={() => handleSelect(opt)}
                    disabled={isAnswered}
                    className={`w-full p-3 rounded-lg text-left text-sm font-mono transition-all ${!isAnswered
                      ? isSelected
                        ? "bg-cyan-100 border-2 border-cyan-600 text-cyan-900 shadow-md"
                        : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                      : isSelected
                        ? isCorrect
                          ? "bg-green-50 border-2 border-green-500 text-green-700"
                          : "bg-rose-50 border-2 border-rose-500 text-rose-700"
                        : isCorrect
                          ? "bg-green-50 border border-green-200 text-green-700"
                          : "bg-white border border-slate-200 text-slate-500"
                      }`}
                  >
                    {isOrderedMulti && orderIndex >= 0 && (
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-200 text-[11px] font-semibold text-cyan-900">
                        {orderIndex + 1}
                      </span>
                    )}
                    <span
                      className={`whitespace-pre-wrap break-all ${isLong && !isExpanded ? "line-clamp-2" : ""}`}
                      style={{ overflowWrap: "anywhere" }}
                    >
                      {opt}
                    </span>
                    {isLong && (
                      <span
                        className="ml-2 text-xs font-semibold text-cyan-600 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedOptions((prev) => ({
                            ...prev,
                            [optionId]: !prev[optionId],
                          }));
                        }}
                      >
                        {isExpanded ? "Show Less" : "Show More"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {isAnswered && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${correct
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
            >
              {correct
                ? "Correct!"
                : isSequence
                  ? `Incorrect — sequence: ${(currentQ.answerLabels || []).join(" -> ")}`
                  : isMulti
                    ? `Incorrect — answers: ${(currentQ.answerLabels || []).join(", ")}`
                    : `Incorrect — answer: ${currentQ.answerLabel}`}
            </div>
          )}

          {/* Multi-select / sequence submit */}
          {(isMulti || isSequence) && !isAnswered && (
            <button
              type="button"
              className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-cyan-700"
              onClick={handleSubmitMulti}
            >
              Check Answer
            </button>
          )}
        </div>

        {/* Navigation - fixed at bottom */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={prev}
            disabled={current <= 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronsLeft className="w-4 h-4" />
            Prev
          </button>
          <button
            type="button"
            onClick={next}
            disabled={isMulti ? !isAnswered : !isAnswered}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {current + 1 >= total ? "Finish" : "Next"}
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile slider - at bottom, away from answer options */}
        <div className="flex sm:hidden items-center gap-3 pt-2 border-t border-slate-100">
          <span className="text-xs text-slate-400 shrink-0">Jump to Q</span>
          <input
            id="q-range-mobile"
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={current}
            onChange={(e) => jumpTo(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded bg-slate-200 accent-cyan-600"
            style={{ touchAction: "pan-y" }}
          />
          <span className="text-xs text-slate-500 font-medium w-8 text-right">{current + 1}</span>
        </div>
      </div>
    );
  };
  const renderComplete = () => {
    const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
    const isGoodScore = percentage >= 80;
    const isAverageScore = percentage >= 50 && percentage < 80;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isGoodScore ? 'bg-green-100' : isAverageScore ? 'bg-amber-100' : 'bg-rose-100'
            }`}>
            <span className="text-3xl">
              {isGoodScore ? '🎉' : isAverageScore ? '👍' : '💪'}
            </span>
          </div>
          <h3 className="text-xl font-bold text-slate-800">Quiz Complete!</h3>
        </div>

        {/* Score Card */}
        <div className={`rounded-xl border-2 p-6 text-center ${isGoodScore
          ? 'border-green-200 bg-green-50'
          : isAverageScore
            ? 'border-amber-200 bg-amber-50'
            : 'border-rose-200 bg-rose-50'
          }`}>
          <p className="text-sm font-medium text-slate-500 mb-2">Your Score</p>
          <p className={`text-4xl font-bold mb-1 ${isGoodScore
            ? 'text-green-600'
            : isAverageScore
              ? 'text-amber-600'
              : 'text-rose-600'
            }`}>
            {score} / {total}
          </p>
          <p className={`text-lg font-semibold ${isGoodScore
            ? 'text-green-500'
            : isAverageScore
              ? 'text-amber-500'
              : 'text-rose-500'
            }`}>
            {percentage}%
          </p>
          <p className="text-sm text-slate-600 mt-3">
            {isGoodScore
              ? 'Excellent work! You really know this code!'
              : isAverageScore
                ? 'Good effort! Keep practicing to improve.'
                : 'Keep studying - you\'ll get better with practice!'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onReturnToSetup}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-cyan-700"
          >
            <HelpCircle className="h-4 w-4" />
            Take Another Quiz
          </button>
          <button
            type="button"
            onClick={onReturnToAst}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <FileUp className="h-4 w-4" />
            Back to File
          </button>
          {parentFolderUrl && (
            <a
              href={parentFolderUrl}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              <FolderUp className="h-4 w-4" />
              Back to Folder
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {mode === "setup" && renderSetup()}
      {mode === "active" && renderActive()}
      {mode === "complete" && renderComplete()}
    </div>
  );
};
