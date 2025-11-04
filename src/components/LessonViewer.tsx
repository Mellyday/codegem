import React, { useState, useEffect } from "react";
import { type TreeSitterAstNode } from "../lib/treeSitter";
import { BookOpen, ChevronsRight, ChevronsLeft, FileJson } from "lucide-react";
import * as pyLesson from "../lib/pyLesson";
import * as jsLesson from "../lib/jsLesson";
import type { LessonStep as PyLessonStep, LessonHistoryItem as PyLessonHistoryItem } from "../lib/pyLesson";
import type { LessonStep as JsLessonStep, LessonHistoryItem as JsLessonHistoryItem } from "../lib/jsLesson";

export type LessonViewerProps = {
  root: TreeSitterAstNode;
  code: string;
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  language?: "python" | "js";
  onReturnToAst: () => void;
  onRevealEndIndexChange: (endIndex: number | undefined) => void;
  onMaskRangesChange: (ranges: { start: number; end: number }[]) => void;
};

// Compute child-index path from root to the target node for stable anchoring

type MaskRange = { start: number; end: number };

// Find nearest ancestor statement among the given types by walking down from root

// Build mask for the leading keyword and compute answer text (header without trailing colon)

// Compute mask and statement-anchored answer for a step

export const LessonViewer: React.FC<LessonViewerProps> = ({
  root,
  code,
  fileKey,
  language = "python",
  onReturnToAst,
  onRevealEndIndexChange,
  onMaskRangesChange,
}) => {
  type LessonStep = PyLessonStep | JsLessonStep;
  type LessonHistoryItem = PyLessonHistoryItem | JsLessonHistoryItem;
  const [lessonQueue, setLessonQueue] = useState<LessonStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [history, setHistory] = useState<LessonHistoryItem[]>([]);
  const totalSteps = lessonQueue.length;

  useEffect(() => {
    if (root) {
      // Prefer semantic steps over raw namedChildren
      // Hide function/class names by default for more useful prompts
      const plan = (language === "python" ? pyLesson.generateLessonPlan : jsLesson.generateLessonPlan)(root, { includeNames: false });
      setLessonQueue(plan);
      setCurrentStep(0);
      setHistory([]);
    }
  }, [root, language]);

  useEffect(() => {
    if (!lessonQueue.length) return;

    const currStepObj = lessonQueue[currentStep];
    // Show leading context up to the start of the current step's node
    const targetIndex = currStepObj?.node?.startIndex ?? root.startIndex;
    onRevealEndIndexChange(targetIndex);

    const curr = lessonQueue[currentStep];
    if (curr) {
      const { masks } = (language === "python" ? pyLesson.maskAndAnswerForStep : jsLesson.maskAndAnswerForStep)(curr as any, root, code);
      onMaskRangesChange(masks);
    } else {
      onMaskRangesChange([]);
    }
  }, [
    currentStep,
    lessonQueue,
    root,
    code,
    onRevealEndIndexChange,
    onMaskRangesChange,
    language,
  ]);

  useEffect(() => {
    return () => {
      onRevealEndIndexChange(undefined);
      onMaskRangesChange([]);
    };
  }, [onRevealEndIndexChange, onMaskRangesChange]);

  const handleNext = () => {
    if (currentStep < lessonQueue.length) {
      const currentStepObject = lessonQueue[currentStep];
      setHistory((prev) => [...prev, { ...currentStepObject, action: "next" }]);
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => Math.max(0, prev - 1));
    }
  };

  const jumpToStep = (idx: number) => {
    if (Number.isFinite(idx)) {
      const clamped = Math.min(
        Math.max(0, Math.floor(idx)),
        Math.max(0, totalSteps - 1)
      );
      setCurrentStep(clamped);
    }
  };

  const handleDigDeeper = () => {
    if (currentStep < lessonQueue.length) {
      const stepToExpand = lessonQueue[currentStep];
      const childrenSteps = (language === "python" ? pyLesson.generateLessonPlan : jsLesson.generateLessonPlan)(
        stepToExpand.node,
        {
          includeNames: false,
        }
      );

      if (childrenSteps.length > 0) {
        setHistory((prev) => [...prev, { ...stepToExpand, action: "dig" }]);
        setLessonQueue((prev) => {
          const newQueue = [...prev];
          newQueue.splice(currentStep, 1, ...childrenSteps);
          return newQueue;
        });
      }
    }
  };

  const handleSaveCustomQuiz = async () => {
    try {
      const payload = (language === "python" ? pyLesson.buildCustomQuizPayload : jsLesson.buildCustomQuizPayload)({
        fileKey,
        root,
        code,
        history,
        lessonQueue,
        currentStep,
      });

      const res = await fetch("/api/quizzes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      alert("Custom quiz saved!");
    } catch (err) {
      console.error("Failed to save custom quiz:", err);
      alert("Failed to save custom quiz.");
    }
  };

  const isComplete = currentStep >= lessonQueue.length;
  const nextStep = !isComplete ? lessonQueue[currentStep] : null;
  const nextNode = nextStep?.node;

  // Compact, scalable step navigator items for large quizzes
  const stepNavItems = (() => {
    const n = totalSteps;
    const cur = currentStep;
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

  if (isComplete) {
    return (
      <div className="flex h-full flex-col justify-between">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-800">
            Lesson Complete!
          </h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            You've walked through the entire code structure.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-sm text-slate-700">Great job!</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={handleSaveCustomQuiz}
          >
            <FileJson className="h-4 w-4" />
            Save Custom Quiz
          </button>
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
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Code Lesson</h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Step {currentStep + 1} / {totalSteps}
          </p>
        </div>
      </div>

      <div className="grow rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{
              width: `${
                totalSteps ? ((currentStep + 1) / totalSteps) * 100 : 0
              }%`,
            }}
          />
        </div>
        <p className="text-sm text-slate-800">{nextStep?.prompt}</p>
        <pre className="text-sm text-slate-900 font-mono bg-slate-100 p-2 rounded overflow-auto">
          <code>{nextNode ? (language === "python" ? pyLesson.textForNode : jsLesson.textForNode)(nextNode, code) : ""}</code>
        </pre>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 -mx-2 px-2">
            {stepNavItems.map((it, idx) =>
              typeof it === "number" ? (
                <button
                  key={`s-${idx}-${it}`}
                  type="button"
                  onClick={() => jumpToStep(it)}
                  className={
                    it === currentStep
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
          <div className="hidden sm:flex items-center gap-2">
            <label
              htmlFor="step-range"
              className="text-xs text-slate-500 whitespace-nowrap"
            >
              Jump
            </label>
            <input
              id="step-range"
              type="range"
              min={0}
              max={Math.max(0, totalSteps - 1)}
              value={currentStep}
              onChange={(e) => jumpToStep(Number(e.target.value))}
              className="h-1.5 w-40 cursor-pointer appearance-none rounded bg-slate-200 accent-amber-500"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handlePrev}
              disabled={currentStep <= 0}
            >
              <ChevronsLeft className="h-4 w-4" />
              Prev
            </button>
            <div className="flex items-center gap-2">
              <label htmlFor="step-input" className="text-xs text-slate-500">
                Go to
              </label>
              <input
                id="step-input"
                type="number"
                min={1}
                max={Math.max(1, totalSteps)}
                defaultValue={currentStep + 1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).valueAsNumber;
                    if (Number.isFinite(v)) jumpToStep(v - 1);
                  }
                }}
                className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                onClick={(e) => {
                  const input =
                    (e.currentTarget
                      .previousElementSibling as HTMLInputElement) ?? null;
                  if (input) {
                    const v = input.valueAsNumber;
                    if (Number.isFinite(v)) jumpToStep(v - 1);
                  }
                }}
              >
                Go
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={handleSaveCustomQuiz}
            >
              <FileJson className="h-4 w-4" />
              Save Custom Quiz
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDigDeeper}
              disabled={!nextStep?.isDigable}
            >
              <BookOpen className="h-4 w-4" />
              Dig Deeper
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
              onClick={handleNext}
            >
              Next
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
