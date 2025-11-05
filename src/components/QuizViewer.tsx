import { Suspense } from "react";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { TreeSitterAstNode } from "../lib/treeSitter";
import { randomString, shuffleArray } from "../lib/utils";
import * as pyCuration from "../lib/pyCuration";
import { isDocstringNode } from "../lib/pyCuration";
import * as jsCuration from "../lib/jsCuration";
import { ErrorBoundary } from "./ErrorBoundary";
import { SavedCustomQuizzesPanel } from "./SavedCustomQuizzesPanel";
import * as pyQuiz from "../lib/pyQuiz";
import * as jsQuiz from "../lib/jsQuiz";
import * as pyLesson from "../lib/pyLesson";
import * as jsLesson from "../lib/jsLesson";

// Constants moved inside component to depend on language
type QuizMode = "setup" | "active" | "complete";
type LanguageKind = "python" | "js";

export type QuizViewerProps = {
  root: TreeSitterAstNode;
  // Full source code for computing exact text of nodes
  code?: string;
  // File context to load saved custom quizzes
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  mode: QuizMode;
  language?: LanguageKind;
  onStart: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onReturnToAst: () => void;
  // Notify parent of the absolute end index to reveal in the code viewer
  onRevealChange?: (endIndex: number | undefined) => void;
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

const gatherContainerTypes = (node: TreeSitterAstNode, acc: Set<string>) => {
  if ((node.namedChildren || []).length > 0) {
    acc.add(node.type);
    for (const c of node.namedChildren || []) gatherContainerTypes(c, acc);
  }
  return acc;
};

const generateDistractors = (correct: string): string[] => {
  const out = new Set<string>();
  while (out.size < 3) {
    const d = randomString(correct.length);
    if (d !== correct) out.add(d);
  }
  return Array.from(out);
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
  breakdownTypes: Set<string>,
  code?: string,
  opts?: { source?: "base" | "expanded" }
): Question[] => {
  const questions: Question[] = [];
  const children = (node.namedChildren || []).filter(
    (c) => c.type !== "comment" && !isDocstringNode(c, node)
  );
  children.forEach((child, idx) => {
    if (
      breakdownTypes.has(child.type) &&
      (child.namedChildren || []).length > 0
    ) {
      questions.push(...generateQuestions(child, breakdownTypes, code, opts));
    } else {
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
        isDigable: (child.namedChildren || []).length > 0,
        revealStart,
        revealEndBeforeChild,
        revealEndAfterChild,
      });
    }
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
      // Prefer provided optionPool; fallback to a minimal pool containing correct answers
      let options = Array.isArray(c.optionPool) ? (c.optionPool as string[]).slice() : [];
      if (!options.length) {
        const correct = Array.isArray(c.multiCorrect) ? c.multiCorrect : [];
        // pad with harmless gibberish to reach at least 6 options
        const pad: string[] = [];
        while (pad.length < Math.max(0, 6 - correct.length)) {
          const d = randomString(6);
          if (!correct.includes(d) && !pad.includes(d)) pad.push(d);
        }
        options = [...correct, ...pad];
      }
      options = shuffleArray(options);
      qs.push({
        stem,
        answerLabel: "", // unused for multi
        options,
        questionType: "multi",
        answerLabels: (c.multiCorrect as string[]) || [],
        kind: c.type,
        generatorRule: c.generatorRule,
        difficulty: c.difficulty,
        sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
        snippetText: c.text,
      });
      continue;
    }

    // Single-choice fallback
    const correct = c.text;
    const stem = c.question || "What comes next?";
    // Prefer saved LLM distractors when present; sample up to 3
    const llm = Array.isArray(c.llmDistractors)
      ? (c.llmDistractors as string[]).filter((d) => d && d !== correct)
      : [];
    const sample = (arr: string[], k: number) => {
      const a = shuffleArray(arr.slice());
      return a.slice(0, k);
    };
    const distractors = [...sample(llm, 3)];
    while (distractors.length < 3) {
      const d = randomString(Math.max(4, Math.min(8, String(correct || "").length || 6)));
      if (d !== correct && !distractors.includes(d)) distractors.push(d);
    }
    const options = shuffleArray([correct, ...distractors]);
    qs.push({
      stem,
      answerLabel: correct,
      options,
      questionType: "single",
      kind: c.type,
      generatorRule: c.generatorRule,
      difficulty: c.difficulty,
      sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
    });
  }

  return qs;
};

// Heuristic helpers removed; using buildHeuristicQuiz from src/lib/pyQuiz.

export const QuizViewer = ({
  root,
  code,
  fileKey,
  mode,
  language = "python",
  onStart,
  onCancel,
  onComplete,
  onReturnToAst,
  onRevealChange,
}: QuizViewerProps) => {
  // Treat blocks/suites or JS BlockStatements as containers
  const BLOCK_TYPES = useMemo(
    () =>
      language === "python"
        ? new Set(["block", "suite"])
        : new Set(["BlockStatement"]),
    [language]
  );
  const CURATABLE_ANCHORS = useMemo(
    () =>
      language === "python"
        ? new Set([
            "function_definition",
            "decorated_definition",
            "class_definition",
            "assignment",
            "expression_statement",
            "call",
            "if_statement",
            "if_stmt",
            "elif_clause",
            "else_clause",
            "for_statement",
            "for_stmt",
            "while_statement",
            "while_stmt",
            "with_statement",
            "try_statement",
          ])
        : new Set([
            "FunctionDeclaration",
            "FunctionExpression",
            "ArrowFunctionExpression",
            "ClassDeclaration",
            "ClassExpression",
            "VariableDeclaration",
            "ExpressionStatement",
            "CallExpression",
            "IfStatement",
            "ForStatement",
            "ForInStatement",
            "ForOfStatement",
            "WhileStatement",
            "TryStatement",
          ]),
    [language]
  );
  // Setup state
  const containerTypes = useMemo(
    () => Array.from(gatherContainerTypes(root, new Set<string>())),
    [root]
  );
  const [breakdownTypes, setBreakdownTypes] = useState<Set<string>>(
    () => new Set(containerTypes.filter((t) => t === "block"))
  );

  // Custom quiz selection state
  const [selectedCustom, setSelectedCustom] = useState<
    SavedCustomQuizV11 | undefined
  >(undefined);

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  // Removed split preview list; split actions now save quizzes directly
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
  const hasExpanded = useMemo(
    () => questions.some((q) => q.source === "expanded"),
    [questions]
  );

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
      } catch {}
      throw new Error(msg);
    }
  };

  // Save split quizzes using the same grouping heuristic as Lesson
  const saveSplitHeuristic = async (
    profile: "shallow" | "deep",
    opts?: { maxDeepPerStmt?: number }
  ) => {
    if (!root) return;
    const plan = (
      language === "python"
        ? pyLesson.generateLessonPlan
        : jsLesson.generateLessonPlan
    )(root, { includeNames: false, enableGrouping: "auto" as const });
    const groups = plan.filter(
      (s: any) => (s.node as any)?.isVirtual || s.node.type === "group"
    );
    if (!groups.length) {
      // Fallback to single save
      const single = (
        language === "python"
          ? pyQuiz.buildHeuristicQuiz
          : jsQuiz.buildHeuristicQuiz
      )(root, code || "", profile, opts);
      await saveHeuristicQuiz(single, root, `Heuristic ${profile}`);
      alert(`Saved 1 quiz (Heuristic ${profile}).`);
      return;
    }
    const topLevel = (root.namedChildren || []).filter(
      (c) => c.type !== "comment"
    );
    const buildGroupRoot = (start: number, end: number) => {
      const namedChildren = topLevel.filter(
        (n) => n.startIndex >= start && n.endIndex <= end
      );
      const vroot: any = {
        type: "group",
        named: true,
        startPosition: root.startPosition,
        endPosition: root.endPosition,
        startIndex: start,
        endIndex: end,
        text: undefined,
        children: [],
        namedChildren,
      } as TreeSitterAstNode;
      return vroot;
    };
    let saved = 0;
    for (let i = 0; i < groups.length; i++) {
      const g: any = groups[i];
      const start = g.node.startIndex;
      const end = g.node.endIndex;
      const vroot = buildGroupRoot(start, end);
      const quiz = (
        language === "python"
          ? pyQuiz.buildHeuristicQuiz
          : jsQuiz.buildHeuristicQuiz
      )(vroot, code || "", profile, opts);
      const name =
        `${g.prompt}`.slice(0, 160) || `Heuristic ${profile} (${i + 1})`;
      await saveHeuristicQuiz(quiz, vroot, name);
      saved += 1;
    }
    alert(`Saved ${saved} quiz(es) for grouped sections.`);
  };

  useEffect(() => {
    if (mode === "active") {
      const qs = selectedCustom
        ? generateQuestionsFromCustom(selectedCustom, code, root)
        : generateQuestions(root, breakdownTypes, code, { source: "base" });
      setQuestions(qs);
      setCurrent(0);
      setSelected(undefined);
      setSelectedMulti(new Set());
      setScore(0);
      setAnswers(new Array(qs.length).fill(undefined));
      setAnsweredFlags(new Array(qs.length).fill(false));
      setExpandedOptions({});
      // Initial reveal if available (applies to AST and custom)
      if (qs.length > 0 && typeof qs[0].revealEndBeforeChild === "number") {
        onRevealChange?.(qs[0].revealEndBeforeChild);
      } else {
        onRevealChange?.(undefined);
      }
    }
  }, [mode, root, breakdownTypes, code, selectedCustom]);

  // Clear reveal when leaving quiz modes
  useEffect(() => {
    if (mode !== "active") {
      onRevealChange?.(undefined);
    }
  }, [mode, onRevealChange]);

  const total = questions.length;
  const currentQ = questions[current];

  const handleToggleType = (type: string) => {
    setBreakdownTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const renderSetup = () => {
    // Show unique container-like types available for breakdown selection
    const preview = generateQuestions(root, breakdownTypes);

    return (
      <div className="space-y-4">
        <div className="mb-2">
          <h3 className="text-lg font-semibold text-slate-800">Quiz Setup</h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Starting from: <span className="font-mono">{root.type}</span>
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-sm text-slate-700">
            Break down these node types into their children:
          </p>
          {containerTypes.length === 0 ? (
            <p className="text-xs italic text-slate-400">
              No container nodes detected
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {containerTypes.map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-2 rounded bg-white px-2 py-1 text-sm shadow-sm"
                >
                  <input
                    id={`bd-${t}`}
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    checked={breakdownTypes.has(t)}
                    onChange={() => handleToggleType(t)}
                  />
                  <label
                    htmlFor={`bd-${t}`}
                    className="font-mono text-xs text-slate-700"
                  >
                    {t}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">
              Preview questions:{" "}
              <span className="font-semibold">{preview.length}</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
                onClick={() => {
                  setSelectedCustom(undefined);
                  onStart();
                }}
              >
                Start Quiz
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Heuristic presets:
            </span>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => {
                if (!root) return;
                const quiz = (
                  language === "python"
                    ? pyQuiz.buildHeuristicQuiz
                    : jsQuiz.buildHeuristicQuiz
                )(root, code || "", "shallow");
                saveHeuristicQuiz(quiz, root, "Heuristic shallow")
                  .then(() => alert("Saved heuristic shallow quiz."))
                  .catch(() => alert("Failed to save heuristic shallow quiz."));
              }}
            >
              Shallow (Line-by-Line)
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => {
                if (!root) return;
                const quiz = (
                  language === "python"
                    ? pyQuiz.buildHeuristicQuiz
                    : jsQuiz.buildHeuristicQuiz
                )(root, code || "", "deep", { maxDeepPerStmt: 6 });
                saveHeuristicQuiz(quiz, root, "Heuristic deep")
                  .then(() => alert("Saved heuristic deep quiz."))
                  .catch(() => alert("Failed to save heuristic deep quiz."));
              }}
            >
              Deep (With Expression Detail)
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => {
                saveSplitHeuristic("shallow");
              }}
            >
              Shallow (Split)
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={() => {
                saveSplitHeuristic("deep", { maxDeepPerStmt: 6 });
              }}
            >
              Deep (Split)
            </button>
          </div>
        </div>

        {/* Heuristic split now saves quizzes directly to DB */}

        <ErrorBoundary
          fallback={
            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600">
              Failed to load quizzes.
            </div>
          }
        >
          <Suspense
            fallback={
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Loading saved quizzes…
              </div>
            }
          >
            <SavedCustomQuizzesPanel
              fileKey={fileKey}
              onStartSaved={(q) => {
                // panel is isolated; only it remounts on refresh/errors
                setSelectedCustom(q as any);
                onStart();
              }}
            />
          </Suspense>
        </ErrorBoundary>
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
          if (next.has(opt)) {
            next.delete(opt);
          } else {
            next.add(opt);
          }
          return next;
        });
        setAnswers((prev) => {
          const next = prev.slice();
          next[current] = Array.from(new Set([...selectedMulti, opt]));
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
        if (typeof currentQ.revealEndAfterChild === "number") {
          onRevealChange?.(currentQ.revealEndAfterChild);
        }
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
    };

    const next = () => {
      if (current + 1 >= total) {
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
        const nextQ = questions[current + 1];
        if (nextQ && typeof nextQ.revealEndBeforeChild === "number") {
          onRevealChange?.(nextQ.revealEndBeforeChild);
        } else {
          onRevealChange?.(undefined);
        }
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
        if (q && typeof q.revealEndBeforeChild === "number") {
          onRevealChange?.(q.revealEndBeforeChild);
        } else {
          onRevealChange?.(undefined);
        }
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
      if (q && typeof q.revealEndBeforeChild === "number") {
        onRevealChange?.(q.revealEndBeforeChild);
      } else {
        onRevealChange?.(undefined);
      }
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

    const handleDigDeeper = () => {
      if (selectedCustom) return; // Only supported for AST-sourced questions
      const q = questions[current];
      const childNode = q?.node;
      if (
        !childNode ||
        !childNode.namedChildren ||
        childNode.namedChildren.length === 0
      )
        return;
      const deeper = generateQuestions(childNode, breakdownTypes, code, {
        source: "expanded",
      });
      if (!deeper.length) return;
      const before = questions.slice(0, current);
      const after = questions.slice(current + 1);
      const nextQs = [...before, ...deeper, ...after];
      setQuestions(nextQs);
      setAnswers(new Array(nextQs.length).fill(undefined));
      setAnsweredFlags(new Array(nextQs.length).fill(false));
      setSelected(undefined);
      setCurrent(before.length);
      const first = deeper[0];
      if (first && typeof first.revealEndBeforeChild === "number") {
        onRevealChange?.(first.revealEndBeforeChild);
      } else {
        onRevealChange?.(undefined);
      }
    };

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
            {hasExpanded && (
              <span className="ml-2 text-amber-600">· Expanded</span>
            )}
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
            {!selectedCustom && (
              <button
                type="button"
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                onClick={handleDigDeeper}
                disabled={!currentQ?.node || !currentQ?.isDigable}
              >
                <BookOpen className="h-4 w-4" />
                Dig Deeper
              </button>
            )}
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
              const correctCls = "border-green-200 bg-green-50 text-green-700";
              const wrongCls = "border-rose-200 bg-rose-50 text-rose-700";
              const cls = !isAnswered
                ? `${base} ${idle}`
                : `${base} ${
                    isSelected
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
                        className={`font-mono whitespace-pre-wrap break-all sm:break-words ${
                          isLong && !isExpanded ? "line-clamp-2" : ""
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
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                correct
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
      const deepest = (
        language === "python"
          ? pyCuration.findDeepestNodeCoveringSpan
          : jsCuration.findDeepestNodeCoveringSpan
      )(root, s, e);
      if (deepest && BLOCK_TYPES.has(deepest.type)) {
        // If user marked a body span exactly, keep the block as the anchor
        return deepest;
      }
      const anchor = (
        language === "python"
          ? pyCuration.findNearestAnchorCoveringSpan
          : jsCuration.findNearestAnchorCoveringSpan
      )(root, s, e, CURATABLE_ANCHORS);
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
    const isWhile =
      anchor.type === "while_statement" || anchor.type === "while_stmt";
    const isIf = anchor.type === "if_statement" || anchor.type === "if_stmt";
    const isFor = anchor.type === "for_statement" || anchor.type === "for_stmt";
    const isElif = anchor.type === "elif_clause";
    const isElse = anchor.type === "else_clause";
    const groupOrder = isFunc
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

    let pieces =
      (language === "python"
        ? pyCuration.cardsFromCuratedSections
        : jsCuration.cardsFromCuratedSections)(anchor, code, {
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
              path: (language === "python"
                ? pyQuiz.computeAstPath
                : jsQuiz.computeAstPath)(root, node),
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
        <button
          type="button"
          className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
          onClick={onReturnToAst}
        >
          Return to AST
        </button>
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
