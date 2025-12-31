import { Suspense } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
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
  mode: QuizMode;
  onStart: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onReturnToAst: () => void;
  // Notify parent of the absolute end index to reveal in the code viewer
  onRevealChange?: (endIndex: number | undefined) => void;
  // Medal tracking for saved quizzes
  quizId?: string;
  sectionIndex?: number;
  // Callback to notify parent when quiz metadata changes (starting saved quiz)
  onQuizMetadataChange?: (quizId: string, sectionIndex: number) => void;
};

type Question = {
  // Human-readable stem for the current question
  stem: string;
  // The label corresponding to the correct answer
  answerLabel: string;
  // Options to display
  options: string[];
  // Multi-select support
  questionType?: "single" | "multi";
  // For multi-select questions, the set of correct labels
  answerLabels?: string[];
  // For multi-select questions, how many to select
  numToSelect?: number;
  // Optional snippet text to show (used by custom quizzes)
  snippetText?: string;
  // Optional metadata for AST-sourced questions
  parentType?: string;
  childType?: string;
  index?: number;
  // Optional v1.1 metadata
  kind?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  sourceRefs?: SourceRef[];
  // AST linkage for inline breakdown
  parentNode?: TreeSitterAstNode;
  node?: TreeSitterAstNode;
  // Track origin for save filtering
  source?: "base" | "expanded";
  // Whether we can break this into smaller questions
  isDigable?: boolean;
  // For controlling how much of the parent's code to reveal while this question is active
  // Absolute indices within the source file. Only set for AST-sourced questions
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};


const generateDistractors = (correct: string): string[] => {
  const out = new Set<string>();
  while (out.size < 3) {
    const d = randomString(correct.length);
    if (d !== correct) out.add(d);
  }
  return Array.from(out);
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

const textForNode = (
  node: TreeSitterAstNode,
  code?: string
): string | undefined => {
  if (node.text && node.text.length > 0) return node.text;
  if (code) {
    return code.substring(node.startIndex, node.endIndex);
  }
  return undefined;
};

const generateQuestions = (
  node: TreeSitterAstNode,
  code?: string,
  opts?: { source?: "base" | "expanded" },
  shouldSkipNode?: (node: TreeSitterAstNode, parent?: TreeSitterAstNode) => boolean
): Question[] => {
  const questions: Question[] = [];
  const skipNode = shouldSkipNode || (() => false);
  const children = (node.namedChildren || []).filter(
    (c) => c.type !== "comment" && !skipNode(c, node)
  );
  children.forEach((child, idx) => {
    const childType = child.type;
    // Prefer the actual source text where available (identifier, parameters, etc.)
    const preferredLabel = textForNode(child, code) || childType;
    const distractors = generateDistractors(preferredLabel);
    const options = shuffleArray([preferredLabel, ...distractors]);

    // Compute reveal ranges relative to the parent
    const parentStart = node.startIndex;
    const revealStart = parentStart;
    const revealEndBeforeChild = child.startIndex;
    const revealEndAfterChild = child.endIndex;

    questions.push({
      stem: "What comes next?",
      answerLabel: preferredLabel,
      options,
      parentType: node.type,
      index: idx,
      childType,
      parentNode: node,
      node: child,
      source: opts?.source ?? "base",
      revealStart,
      revealEndBeforeChild,
      revealEndAfterChild,
    });
  });
  return questions;
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
  questionType?: "single" | "multi";
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
  code?: string,
  astRootFallback?: TreeSitterAstNode
): Question[] => {
  // Trust saved cards; do not reconstruct answers for multi-select.
  const cards = quiz.cards
    .filter((c) => c.action !== "dig")
    .slice()
    .sort((a, b) => a.order - b.order);
  const qs: Question[] = [];

  for (const c of cards) {
    const isMulti = c.questionType === "multi" && Array.isArray(c.multiCorrect);
    if (isMulti) {
      const stem = c.question || "Select all that apply.";
      const correct = Array.isArray(c.multiCorrect) ? c.multiCorrect : [];
      const llmPool = Array.isArray(c.llmDistractors) ? c.llmDistractors : undefined;
      const optionPool = Array.isArray(c.optionPool) ? c.optionPool : undefined;
      const options = buildMultiChoiceOptions(correct, llmPool, optionPool);
      qs.push({
        stem,
        answerLabel: "", // unused for multi
        options,
        questionType: "multi",
        answerLabels: correct || [],
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
  mode,
  onStart,
  onCancel,
  onComplete,
  onReturnToAst,
  onRevealChange,
  quizId,
  sectionIndex,
  onQuizMetadataChange,
}: QuizViewerProps) => {
  const languageTools = useMemo(
    () => getLanguageToolsForFileName(fileName ?? fileKey?.path),
    [fileName, fileKey?.path]
  );
  const { engine, curation, ui, id: languageId } = languageTools;
  const BLOCK_TYPES = ui.blockTypes;
  const CURATABLE_ANCHORS = ui.curatableAnchors;
  // Memoize to prevent infinite re-render loop when isDocstringNode is undefined (e.g., Go)
  const shouldSkipNode = useMemo(
    () => curation.isDocstringNode || (() => false),
    [curation.isDocstringNode]
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
      const qs = selectedCustom
        ? generateQuestionsFromCustom(selectedCustom, code, root)
        : generateQuestions(root, code, { source: "base" }, shouldSkipNode);
      setQuestions(qs);
      setCurrent(0);
      setSelected(undefined);
      setSelectedMulti(new Set());
      setScore(0);
      setAnswers(new Array(qs.length).fill(undefined));
      setAnsweredFlags(new Array(qs.length).fill(false));
      setExpandedOptions({});
      // Initial reveal window for the first question (AST, heuristic, or custom).
      const initialReveal = qs.length > 0 ? revealBeforeForQuestion(qs[0]) : undefined;
      onRevealChange?.(initialReveal);
    }
  }, [mode, root, code, selectedCustom, shouldSkipNode]);

  // Clear reveal when leaving quiz modes
  useEffect(() => {
    if (mode !== "active") {
      onRevealChange?.(undefined);
    }
  }, [mode, onRevealChange]);

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
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50 transition-colors group-hover:bg-purple-100">
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
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-pink-50 transition-colors group-hover:bg-pink-100">
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
                // Notify parent of quiz metadata for medal tracking
                onQuizMetadataChange?.(qId, secIdx);
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
          <button
            type="button"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600"
            onClick={() => {
              setSelectedCustom(undefined);
              onStart();
            }}
          >
            Start Quiz
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

    const isMulti =
      currentQ.questionType === "multi" && Array.isArray(currentQ.answerLabels);
    const correctSet = new Set<string>(
      isMulti ? (currentQ.answerLabels as string[]) : []
    );
    const isAnswered = answeredFlags[current] || false;
    const correct = isMulti
      ? isAnswered &&
      ((): boolean => {
        if (!isMulti) return false;
        if (selectedMulti.size !== (currentQ.answerLabels?.length ?? 0))
          return false;
        for (const v of selectedMulti) if (!correctSet.has(v)) return false;
        return true;
      })()
      : isAnswered && selected === currentQ.answerLabel;

    const handleSelect = (opt: string) => {
      if (isAnswered) return;
      if (isMulti) {
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

    const handleSubmitMulti = () => {
      if (isAnswered) return;
      setAnsweredFlags((prev) => {
        const n = prev.slice();
        n[current] = true;
        return n;
      });
      const isRight = (() => {
        if (selectedMulti.size !== (currentQ.answerLabels?.length ?? 0))
          return false;
        for (const v of selectedMulti) if (!correctSet.has(v)) return false;
        return true;
      })();
      if (isRight) setScore((s) => s + 1);
      onRevealChange?.(revealAfterForQuestion(currentQ));
    };

    const next = async () => {
      if (current + 1 >= total) {
        // Quiz complete - record attempt if quizId exists
        if (quizId) {
          try {
            await fetch("/api/quiz-attempts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                quizId,
                sectionIndex: sectionIndex ?? 0,
                totalQuestions: total,
                correctAnswers: score,
              }),
            });
          } catch (error) {
            console.error("Failed to record quiz attempt:", error);
            // Continue to onComplete even if recording fails
          }
        }
        onComplete();
      } else {
        const nextIdx = current + 1;
        setCurrent(nextIdx);
        const ans = answers[nextIdx];
        if (Array.isArray(ans)) {
          setSelected(undefined);
          setSelectedMulti(new Set(ans));
        } else {
          setSelected(ans as string | undefined);
          setSelectedMulti(new Set());
        }
        // Update reveal window for the next question if available (AST or custom)
        const nextQ = questions[nextIdx];
        onRevealChange?.(revealBeforeForQuestion(nextQ));
      }
    };

    const prev = () => {
      if (current > 0) {
        const idx = current - 1;
        setCurrent(idx);
        const ans = answers[idx];
        if (Array.isArray(ans)) {
          setSelected(undefined);
          setSelectedMulti(new Set(ans));
        } else {
          setSelected(ans as string | undefined);
          setSelectedMulti(new Set());
        }
        const q = questions[idx];
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
      const ans = answers[clamped];
      if (Array.isArray(ans)) {
        setSelected(undefined);
        setSelectedMulti(new Set(ans));
      } else {
        setSelected(ans as string | undefined);
        setSelectedMulti(new Set());
      }
      const q = questions[clamped];
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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">
              {selectedCustom ? "Custom Quiz" : "AST Quiz"}
            </h3>
            {!selectedCustom && currentQ.parentType && (
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Parent: <span className="font-mono">{currentQ.parentType}</span>
              </p>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Q {current + 1} / {total} · Score {score}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${total ? ((current + 1) / total) * 100 : 0}%` }}
          />
        </div>

        {/* Step navigator: chips + slider + go-to */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 -mx-2 px-2">
              {stepNavItems.map((it, idx) =>
                typeof it === "number" ? (
                  <button
                    key={`s-${idx}-${it}`}
                    type="button"
                    onClick={() => jumpTo(it)}
                    className={
                      it === current
                        ? "min-w-9 px-2 py-1 rounded-md bg-amber-500 text-white text-xs font-medium shadow"
                        : "min-w-9 px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700 text-xs shadow-sm hover:bg-slate-50"
                    }
                  >
                    {it + 1}
                  </button>
                ) : (
                  <span key={`e-${idx}`} className="px-1 text-slate-400">
                    {it}
                  </span>
                )
              )}
            </div>
            {/* Desktop/tablet slider */}
            <div className="hidden sm:flex items-center gap-2">
              <label
                htmlFor="q-range"
                className="text-xs text-slate-500 whitespace-nowrap"
              >
                Jump
              </label>
              <input
                id="q-range"
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={current}
                onChange={(e) => jumpTo(Number(e.target.value))}
                className="h-1.5 w-40 cursor-pointer appearance-none rounded bg-slate-200 accent-amber-500"
              />
            </div>
          </div>
          {/* Mobile slider shown on its own row - ensure always visible */}
          <div className="flex items-center gap-2 sm:hidden px-2">
            <label
              htmlFor="q-range-mobile"
              className="text-xs text-slate-500 whitespace-nowrap"
            >
              Jump
            </label>
            <input
              id="q-range-mobile"
              type="range"
              min={0}
              max={Math.max(0, total - 1)}
              value={current}
              onChange={(e) => jumpTo(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded bg-slate-200"
              style={{ touchAction: "pan-y" }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              onClick={prev}
              disabled={current <= 0}
            >
              <ChevronsLeft className="h-4 w-4" />
              Prev
            </button>

            <div className="flex items-center gap-2">
              <label htmlFor="q-input" className="text-xs text-slate-500">
                Go to
              </label>
              <input
                id="q-input"
                type="number"
                min={1}
                max={Math.max(1, total)}
                defaultValue={current + 1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).valueAsNumber;
                    if (Number.isFinite(v)) jumpTo(v - 1);
                  }
                }}
                className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-700 shadow-sm hover:bg-slate-50 shrink-0"
                onClick={(e) => {
                  const input =
                    (e.currentTarget
                      .previousElementSibling as HTMLInputElement) ?? null;
                  if (input) {
                    const v = input.valueAsNumber;
                    if (Number.isFinite(v)) jumpTo(v - 1);
                  }
                }}
              >
                Go
              </button>
            </div>
            {isMulti && !isAnswered && (
              <button
                type="button"
                className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600 disabled:opacity-50 shrink-0"
                onClick={handleSubmitMulti}
              >
                Check Answer
              </button>
            )}
            <button
              type="button"
              className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600 disabled:opacity-50 shrink-0 w-full sm:w-auto sm:ml-auto justify-center"
              onClick={next}
              disabled={isMulti ? !isAnswered : !isAnswered}
            >
              {current + 1 >= total ? "Finish" : "Next"}
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-800">{currentQ.stem}</p>
          <p className="text-xs text-slate-500">
            {isMulti
              ? `Select all that apply.`
              : "Choose the next part of the code."}
          </p>

          <ul className="mt-3 grid gap-2">
            {currentQ.options.map((opt, i) => {
              const isCorrect = isMulti
                ? correctSet.has(opt)
                : opt === currentQ.answerLabel;
              const isSelected = isMulti
                ? selectedMulti.has(opt)
                : selected === opt;
              const base =
                "w-full rounded-md border px-3 py-2 text-left text-sm shadow-sm";
              const idle =
                "border-slate-200 bg-white hover:bg-slate-50 text-slate-700";
              const selectedCls =
                "border-amber-300 bg-amber-50 text-slate-800";
              const correctCls = "border-green-200 bg-green-50 text-green-700";
              const wrongCls = "border-rose-200 bg-rose-50 text-rose-700";
              const cls = !isAnswered
                ? `${base} ${isSelected ? selectedCls : idle}`
                : `${base} ${isSelected
                  ? isCorrect
                    ? correctCls
                    : wrongCls
                  : isCorrect
                    ? correctCls
                    : idle
                }`;

              const optionId = `${current}-${i}`;
              const isExpanded = !!expandedOptions[optionId];
              const isLong = opt.length > 100;

              return (
                <li key={optionId}>
                  {/* Make the whole row a non-button clickable region */}
                  <div className={`${cls}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="w-full text-left"
                      onClick={() => handleSelect(opt)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelect(opt);
                        }
                      }}
                    >
                      <span
                        className={`font-mono whitespace-pre-wrap break-all sm:break-words ${isLong && !isExpanded ? "line-clamp-2" : ""
                          }`}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {opt}
                      </span>
                    </div>

                    {/* Show More/Less outside the clickable area and stop events early */}
                    {isLong && (
                      <button
                        type="button"
                        className="mt-1 text-xs font-semibold text-amber-600 hover:underline"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedOptions((prev) => ({
                            ...prev,
                            [optionId]: !prev[optionId],
                          }));
                        }}
                      >
                        {isExpanded ? "Show Less" : "Show More"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {isAnswered && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${correct
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
            >
              {correct
                ? "Correct!"
                : isMulti
                  ? `Incorrect — answers: ${(currentQ.answerLabels || []).join(
                    ", "
                  )}`
                  : `Incorrect — answer: ${currentQ.answerLabel}`}
            </div>
          )}

          {/* Old inline breakdown/drill actions removed in favor of Mark flow */}
        </div>
      </div>
    );
  };

  // Helper to locate the AST node for a given question
  function nodeFromQuestion(
    q: Question,
    root: TreeSitterAstNode,
    code?: string
  ): TreeSitterAstNode | undefined {
    if (!root) return undefined;

    // Prefer block/suite if the span is exactly a block, else land on a statement anchor
    const resolveAnchor = (s: number, e: number) => {
      const deepest = curation.findDeepestNodeCoveringSpan(root, s, e);
      if (deepest && BLOCK_TYPES.has(deepest.type)) {
        // If user marked a body span exactly, keep the block as the anchor
        return deepest;
      }
      const anchor = curation.findNearestAnchorCoveringSpan(
        root,
        s,
        e,
        CURATABLE_ANCHORS
      );
      return anchor ?? deepest;
    };

    // Prefer explicit reveal spans (child range)
    if (
      typeof q.revealEndBeforeChild === "number" &&
      typeof q.revealEndAfterChild === "number"
    ) {
      const n = resolveAnchor(q.revealEndBeforeChild, q.revealEndAfterChild);
      if (n) return n;
    }

    // Fallback: locate answer text and resolve deepest covering node
    if (code && q.answerLabel) {
      const idx = code.indexOf(q.answerLabel);
      if (idx >= 0) {
        const n = resolveAnchor(idx, idx + q.answerLabel.length);
        if (n) return n;
      }
    }

    return undefined;
  }

  // Helpers to ensure we include a single body card for function definitions
  function findBlockChild(n?: TreeSitterAstNode) {
    if (!n?.namedChildren) return undefined;
    return n.namedChildren.find((c) => BLOCK_TYPES.has(c.type));
  }
  function hasBodyPiece(pieces: any[]) {
    return pieces.some(
      (p) =>
        p?.semanticRole === "body" ||
        p?.semanticRole === "block" ||
        p?.type === "body" ||
        p?.type === "block"
    );
  }

  function deriveCardsEnsuringBody(
    anchor: TreeSitterAstNode,
    code: string
  ): any[] {
    // Treat decorated_definition as function/class-like by peeking at its inner definition
    const innerDef =
      anchor.type === "decorated_definition"
        ? (anchor.namedChildren || []).find(
          (c) =>
            c.type === "function_definition" || c.type === "class_definition"
        )
        : undefined;
    const effective = innerDef || anchor;

    const isFunc =
      effective.type === "function_definition" ||
      anchor.type === "function_definition";
    const isClass =
      effective.type === "class_definition" ||
      anchor.type === "class_definition";
    const hasBlock = !!findBlockChild(effective);

    // Optional stable group ordering for common statements (handle _stmt/_statement)
    const groupOrder = (() => {
      if (languageId === "python") {
        const isWhile =
          anchor.type === "while_statement" || anchor.type === "while_stmt";
        const isIf = anchor.type === "if_statement" || anchor.type === "if_stmt";
        const isFor = anchor.type === "for_statement" || anchor.type === "for_stmt";
        const isElif = anchor.type === "elif_clause";
        const isElse = anchor.type === "else_clause";
        return isFunc
          ? ["type_params", "args", "returns", "body", "decorators"]
          : isClass
            ? ["type_params", "bases", "body", "decorators", "keywords"]
            : isWhile
              ? ["test", "body", "orelse"]
              : isIf
                ? ["test", "body", "orelse"]
                : isElif
                  ? ["test", "body"]
                  : isElse
                    ? ["body"]
                    : isFor
                      ? ["target", "iter", "body", "orelse"]
                      : anchor.type === "with_statement"
                        ? ["items", "body"]
                        : anchor.type === "try_statement"
                          ? ["body", "handlers", "orelse", "finalbody"]
                          : undefined;
      }
      if (languageId === "c") {
        if (anchor.type === "function_definition") return ["name", "params", "body"];
        if (anchor.type === "declaration" || anchor.type === "type_definition")
          return ["type", "names", "initializers"];
        if (anchor.type === "struct_specifier") return ["name", "fields"];
        if (anchor.type === "enum_specifier") return ["name", "enumerators"];
        if (anchor.type === "if_statement") return ["condition", "then", "else"];
        if (anchor.type === "for_statement")
          return ["init", "condition", "update", "body"];
        if (anchor.type === "while_statement" || anchor.type === "do_statement")
          return ["condition", "body"];
        if (anchor.type === "switch_statement")
          return ["value", "cases", "body"];
      }
      return undefined;
    })();

    let pieces =
      curation.cardsFromCuratedSections(anchor, code, {
        // Show a single "body" card whenever this node actually owns a block/suite
        includeBody: hasBlock || isFunc,
        groupOrder,
      }) || [];

    // Fallback: if for any reason we still didn't get a body card but this node owns one,
    // synthesize exactly one body card from the block/suite span.
    if (hasBlock && !hasBodyPiece(pieces)) {
      const body = findBlockChild(effective);
      if (body) {
        pieces = [
          ...pieces,
          {
            order: 0, // caller will overwrite
            type: "block",
            text: code.substring(body.startIndex, body.endIndex),
            action: "next" as const,
            semanticRole: "body",
            question: "What is the body?",
          },
        ];
      }
    }
    return pieces;
  }

  // Types and builders for saving derived quizzes
  type SavedCustomQuizCard = {
    order: number;
    type: string;
    text: string;
    source: "visited" | "pending";
    action: "next" | "dig";
    semanticRole?: string;
    question?: string;
  };

  function baseCardsFromQuestions(
    qs: Question[],
    code?: string
  ): SavedCustomQuizCard[] {
    return qs.map((q, i) => {
      const text =
        typeof q.revealEndBeforeChild === "number" &&
          typeof q.revealEndAfterChild === "number" &&
          code
          ? code.substring(q.revealEndBeforeChild, q.revealEndAfterChild)
          : q.answerLabel;
      return {
        order: i,
        type: q.childType || "unknown",
        text: String(text ?? ""),
        source: "visited",
        action: "next",
        semanticRole: q.parentType,
        question: q.stem,
      };
    });
  }

  function derivedCardsFromMarks(
    markedIdxs: number[],
    qs: Question[],
    root: TreeSitterAstNode,
    code: string
  ): SavedCustomQuizCard[] {
    let order = 0;
    const out: SavedCustomQuizCard[] = [];
    for (const qi of markedIdxs) {
      const q = qs[qi];
      if (!q) continue;
      const node = nodeFromQuestion(q, root, code);
      if (!node) continue;
      const cards = deriveCardsEnsuringBody(node, code).map((c) => ({
        ...c,
        order: order++,
        source: "visited" as const,
        action: "next" as const,
      }));
      out.push(...cards);
    }
    return out;
  }

  // Build v1.1 custom quiz cards from current questions (AST-backed where possible)
  function buildV11Cards(
    qs: Question[],
    code?: string
  ): SavedCustomQuizCardV11[] {
    const out: SavedCustomQuizCardV11[] = [];
    let order = 0;
    for (const q of qs) {
      const node = q.node;
      const text = node
        ? (code ?? "").substring(node.startIndex, node.endIndex)
        : typeof q.revealEndBeforeChild === "number" &&
          typeof q.revealEndAfterChild === "number" &&
          typeof code === "string"
          ? code.substring(q.revealEndBeforeChild, q.revealEndAfterChild)
          : q.answerLabel;
      const card: SavedCustomQuizCardV11 = {
        order: order++,
        type: q.childType || q.kind || "unknown",
        text: String(text ?? ""),
        action: "next",
        question: q.stem,
        semanticRole: q.parentType,
        sourceRef: node
          ? {
            nodeType: node.type,
            start: node.startIndex,
            end: node.endIndex,
            path: engine.computeAstPath(root, node),
            preview:
              typeof code === "string"
                ? code.substring(node.startIndex, node.endIndex).slice(0, 120)
                : undefined,
          }
          : undefined,
      };
      out.push(card);
    }
    return out;
  }

  const renderComplete = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-800">Quiz Complete</h3>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          You can return to the AST view.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-700">Thanks for playing!</p>
      </div>
      <div className="flex justify-end gap-2">
        {code && (
          <>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={async () => {
                try {
                  const cards = buildV11Cards(questions, code);
                  const payload = {
                    fileKey,
                    name: `Custom quiz ${new Date().toLocaleString()}`,
                    type: "CustomQuizV1.1" as const,
                    profile: "normal" as const,
                    rootNode: {
                      type: root.type,
                      text: code.substring(root.startIndex, root.endIndex),
                      start: root.startIndex,
                      end: root.endIndex,
                    },
                    cards,
                  };
                  const res = await fetch("/api/quizzes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  alert("Custom quiz saved (all cards).");
                } catch (err) {
                  console.error(err);
                  alert("Failed to save custom quiz.");
                }
              }}
            >
              Save Quiz: All Cards
            </button>

            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={!questions.some((q) => q.source === "expanded")}
              onClick={async () => {
                try {
                  const onlyNew = questions.filter(
                    (q) => q.source === "expanded"
                  );
                  if (onlyNew.length === 0) {
                    alert("No new cards to save.");
                    return;
                  }
                  const cards = buildV11Cards(onlyNew, code);
                  const payload = {
                    fileKey,
                    name: `New cards ${new Date().toLocaleString()}`,
                    type: "CustomQuizV1.1" as const,
                    profile: "normal" as const,
                    rootNode: {
                      type: root.type,
                      text: code.substring(root.startIndex, root.endIndex),
                      start: root.startIndex,
                      end: root.endIndex,
                    },
                    cards,
                  };
                  const res = await fetch("/api/quizzes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  alert("Custom quiz saved (new cards only).");
                } catch (err) {
                  console.error(err);
                  alert("Failed to save new-cards quiz.");
                }
              }}
            >
              Save Quiz: New Only
            </button>
          </>
        )}
        {!selectedCustom && (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={async () => {
              const exportPayload = {
                type: "ast-quiz",
                root: {
                  type: root.type,
                  startIndex: root.startIndex,
                  endIndex: root.endIndex,
                },
                totalQuestions: questions.length,
                questions: questions.map((q, i) => ({
                  index: i,
                  stem: q.stem,
                  parentType: q.parentType,
                  childType: q.childType,
                  correctAnswer: q.answerLabel,
                  revealStart: q.revealStart,
                  revealEndBeforeChild: q.revealEndBeforeChild,
                  revealEndAfterChild: q.revealEndAfterChild,
                  codeSnippet:
                    typeof code === "string" &&
                      typeof q.revealStart === "number" &&
                      typeof q.revealEndBeforeChild === "number"
                      ? code.substring(q.revealStart, q.revealEndBeforeChild)
                      : undefined,
                  childText:
                    typeof code === "string" &&
                      typeof q.revealEndBeforeChild === "number" &&
                      typeof q.revealEndAfterChild === "number"
                      ? code.substring(
                        q.revealEndBeforeChild,
                        q.revealEndAfterChild
                      )
                      : undefined,
                  options: q.options,
                })),
              };

              const json = JSON.stringify(exportPayload, null, 2);

              const fallbackCopy = (text: string) => {
                try {
                  const ta = document.createElement("textarea");
                  ta.value = text;
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
                  await navigator.clipboard.writeText(json);
                } else {
                  const ok = fallbackCopy(json);
                  if (!ok) throw new Error("Clipboard unavailable");
                }
              } catch {
                // ignore
              }
            }}
          >
            Copy JSON
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {mode === "setup" && renderSetup()}
      {mode === "active" && renderActive()}
      {mode === "complete" && renderComplete()}
    </div>
  );
};
