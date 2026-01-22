import type { TreeSitterAstNode } from "../treeSitter";

export type EngineOptions = {
  profile: "shallow" | "deep";
  includeNames?: boolean;
  // Skip quiz generation when only lesson output is needed (e.g., Teach Me flow)
  generateQuiz?: boolean;
};

export type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

export type QuestionType =
  | "single"
  | "multi"
  | "orderedMulti"
  | "sequence"
  | "mapping";

export type MappingPair = {
  key: string;
  value: string;
};

export type QuizQuestion = {
  kind: string;
  stem: string;
  answerLabel: string;
  options: string[];
  sourceRefs: SourceRef[];
  generatorRule: string;
  difficulty?: "easy" | "medium" | "hard";
  questionType?: QuestionType;
  multiCorrect?: string[];
  optionPool?: string[];
  multiSelectHint?: number;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
  distractorPoolSize?: number;
  pairs?: MappingPair[];
  matchlessKeys?: string[];
  keyDistractors?: string[];
  valueDistractors?: string[];
};

export type EngineStep = {
  id: string;
  node: TreeSitterAstNode & { isVirtual?: boolean };
  displaySpan?: { start: number; end: number };
  lesson?: {
    prompt: string;
    semanticRole: string;
    isDigable: boolean;
    childSteps?: EngineStep[];
  };
  quiz?: {
    questions: QuizQuestion[];
  };
};

export type LessonHistoryItem = EngineStep & { action?: "next" | "dig" };
