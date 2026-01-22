import type { TreeSitterAstNode } from "../treeSitter";
import type {
  EngineOptions,
  EngineStep,
  LessonHistoryItem,
} from "./engineTypes";
import * as pyEngine from "./python/pyEngine";
import * as pyCuration from "./python/pyCuration";
import * as rubyEngine from "./ruby/rubyEngine";
import * as rubyCuration from "./ruby/rubyCuration";
import * as cEngine from "./c/cEngine";
import * as cCuration from "./c/cCuration";
import * as goEngine from "./go/goEngine";
import * as goCuration from "./go/goCuration";
import * as javaEngine from "./java/javaEngine";
import * as javaCuration from "./java/javaCuration";
import * as jsEngine from "./javascript/jsEngine";
import * as jsCuration from "./javascript/jsCuration";

export type { EngineOptions, EngineStep, LessonHistoryItem } from "./engineTypes";

export type LanguageEngine = {
  generateEngineSteps: (
    root: TreeSitterAstNode,
    node: TreeSitterAstNode,
    code: string,
    options: EngineOptions
  ) => EngineStep[];
  maskAndAnswerForStep: (
    step: EngineStep,
    root: TreeSitterAstNode,
    code: string
  ) => { masks: { start: number; end: number }[]; answerText: string };
  buildCustomQuizPayload: (params: {
    fileKey?: { kind: "repo" | "project"; id: string; path: string };
    root: TreeSitterAstNode;
    code: string;
    history: LessonHistoryItem[];
    lessonQueue: EngineStep[];
    currentStep: number;
  }) => any;
  computeAstPath: (
    root: TreeSitterAstNode,
    target: TreeSitterAstNode
  ) => number[];
};

export type LanguageCuration = {
  buildCuratedSections: (node: TreeSitterAstNode) => pyCuration.CuratedSection[];
  findDeepestNodeCoveringSpan: (
    root: TreeSitterAstNode,
    start: number,
    end: number
  ) => TreeSitterAstNode | undefined;
  findNearestAnchorCoveringSpan: (
    root: TreeSitterAstNode,
    start: number,
    end: number,
    types: Set<string>
  ) => TreeSitterAstNode | undefined;
  cardsFromCuratedSections: (
    node: TreeSitterAstNode,
    code: string,
    opts?: { includeBody?: boolean; groupOrder?: string[] }
  ) => Array<{
    order: number;
    type: string;
    text: string;
    action: "next";
    semanticRole?: string;
    question?: string;
  }>;
  isDocstringNode?: (node: TreeSitterAstNode, parent?: TreeSitterAstNode) => boolean;
  isYieldFrom?: (node: TreeSitterAstNode, code?: string) => boolean;
};

export type LanguageId =
  | "python"
  | "c"
  | "go"
  | "ruby"
  | "java"
  | "javascript"
  | "typescript";

export type LanguageTools = {
  id: LanguageId;
  engine: LanguageEngine;
  curation: LanguageCuration;
  ui: {
    blockTypes: Set<string>;
    curatableAnchors: Set<string>;
  };
};

const PY_TOOLS: LanguageTools = {
  id: "python",
  engine: pyEngine,
  curation: {
    buildCuratedSections: pyCuration.buildCuratedSections,
    findDeepestNodeCoveringSpan: pyCuration.findDeepestNodeCoveringSpan,
    findNearestAnchorCoveringSpan: pyCuration.findNearestAnchorCoveringSpan,
    cardsFromCuratedSections: pyCuration.cardsFromCuratedSections,
    isDocstringNode: pyCuration.isDocstringNode,
    isYieldFrom: pyCuration.isYieldFrom,
  },
  ui: {
    blockTypes: new Set(["block", "suite"]),
    curatableAnchors: new Set([
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
    ]),
  },
};

const C_TOOLS: LanguageTools = {
  id: "c",
  engine: cEngine,
  curation: {
    buildCuratedSections: cCuration.buildCuratedSections,
    findDeepestNodeCoveringSpan: cCuration.findDeepestNodeCoveringSpan,
    findNearestAnchorCoveringSpan: cCuration.findNearestAnchorCoveringSpan,
    cardsFromCuratedSections: cCuration.cardsFromCuratedSections,
    isDocstringNode: cCuration.isDocstringNode,
    isYieldFrom: cCuration.isYieldFrom,
  },
  ui: {
    blockTypes: new Set(["compound_statement"]),
    curatableAnchors: new Set([
      "preproc_include",
      "function_definition",
      "declaration",
      "type_definition",
      "struct_specifier",
      "enum_specifier",
      "if_statement",
      "for_statement",
      "while_statement",
      "do_statement",
      "switch_statement",
      "case_statement",
      "labeled_statement",
      "return_statement",
      "break_statement",
      "continue_statement",
      "goto_statement",
      "expression_statement",
    ]),
  },
};

const RUBY_TOOLS: LanguageTools = {
  id: "ruby",
  engine: rubyEngine,
  curation: {
    buildCuratedSections: rubyCuration.buildCuratedSections,
    findDeepestNodeCoveringSpan: rubyCuration.findDeepestNodeCoveringSpan,
    findNearestAnchorCoveringSpan: rubyCuration.findNearestAnchorCoveringSpan,
    cardsFromCuratedSections: rubyCuration.cardsFromCuratedSections,
    isDocstringNode: rubyCuration.isDocstringNode,
    isYieldFrom: rubyCuration.isYieldFrom,
  },
  ui: {
    blockTypes: new Set(["body_statement", "statement_list", "block", "do_block", "brace_block"]),
    curatableAnchors: new Set([
      "class",
      "module",
      "singleton_class",
      "method",
      "method_definition",
      "singleton_method",
      "singleton_method_definition",
      "assignment",
      "multiple_assignment",
      "call",
      "command",
      "command_call",
      "method_call",
      "block",
      "do_block",
      "brace_block",
      "if",
      "unless",
      "elsif",
      "case",
      "when",
      "when_clause",
      "while",
      "until",
      "for",
      "begin",
      "rescue",
      "rescue_clause",
      "ensure",
      "return",
      "break",
      "next",
    ]),
  },
};

const GO_TOOLS: LanguageTools = {
  id: "go",
  engine: goEngine,
  curation: {
    buildCuratedSections: goCuration.buildCuratedSections,
    findDeepestNodeCoveringSpan: goCuration.findDeepestNodeCoveringSpan,
    findNearestAnchorCoveringSpan: goCuration.findNearestAnchorCoveringSpan,
    cardsFromCuratedSections: goCuration.cardsFromCuratedSections,
  },
  ui: {
    blockTypes: new Set(["block"]),
    curatableAnchors: new Set([
      "package_clause",
      "import_declaration",
      "const_declaration",
      "var_declaration",
      "type_declaration",
      "function_declaration",
      "method_declaration",
      "short_var_declaration",
      "assignment_statement",
      "inc_statement",
      "dec_statement",
      "if_statement",
      "for_statement",
      "expression_switch_statement",
      "type_switch_statement",
      "select_statement",
      "expression_case",
      "type_case",
      "communication_case",
      "default_case",
      "return_statement",
      "go_statement",
      "defer_statement",
      "break_statement",
      "continue_statement",
      "goto_statement",
      "fallthrough_statement",
      "expression_statement",
    ]),
  },
};

const JAVA_TOOLS: LanguageTools = {
  id: "java",
  engine: javaEngine,
  curation: {
    buildCuratedSections: javaCuration.buildCuratedSections,
    findDeepestNodeCoveringSpan: javaCuration.findDeepestNodeCoveringSpan,
    findNearestAnchorCoveringSpan: javaCuration.findNearestAnchorCoveringSpan,
    cardsFromCuratedSections: javaCuration.cardsFromCuratedSections,
    isDocstringNode: javaCuration.isDocstringNode,
    isYieldFrom: javaCuration.isYieldFrom,
  },
  ui: {
    blockTypes: new Set(["block", "constructor_body", "switch_block"]),
    curatableAnchors: new Set([
      "package_declaration",
      "import_declaration",
      "class_declaration",
      "interface_declaration",
      "enum_declaration",
      "record_declaration",
      "annotation_type_declaration",
      "method_declaration",
      "constructor_declaration",
      "compact_constructor_declaration",
      "field_declaration",
      "local_variable_declaration",
      "static_initializer",
      "if_statement",
      "for_statement",
      "enhanced_for_statement",
      "while_statement",
      "do_statement",
      "switch_expression",
      "try_statement",
      "try_with_resources_statement",
      "catch_clause",
      "finally_clause",
      "synchronized_statement",
      "return_statement",
      "throw_statement",
      "break_statement",
      "continue_statement",
      "assert_statement",
      "expression_statement",
    ]),
  },
};

const JS_TOOLS: LanguageTools = {
  id: "javascript",
  engine: jsEngine,
  curation: {
    buildCuratedSections: jsCuration.buildCuratedSections,
    findDeepestNodeCoveringSpan: jsCuration.findDeepestNodeCoveringSpan,
    findNearestAnchorCoveringSpan: jsCuration.findNearestAnchorCoveringSpan,
    cardsFromCuratedSections: jsCuration.cardsFromCuratedSections,
    isDocstringNode: jsCuration.isDocstringNode,
  },
  ui: {
    blockTypes: new Set(["statement_block", "class_body", "switch_body"]),
    curatableAnchors: new Set([
      "import_statement",
      "export_statement",
      "lexical_declaration",
      "variable_declaration",
      "function_declaration",
      "generator_function_declaration",
      "class_declaration",
      "method_definition",
      "field_definition",
      "public_field_definition",
      "class_static_block",
      "if_statement",
      "else_clause",
      "for_statement",
      "for_in_statement",
      "while_statement",
      "do_statement",
      "switch_statement",
      "switch_case",
      "switch_default",
      "try_statement",
      "catch_clause",
      "finally_clause",
      "return_statement",
      "throw_statement",
      "break_statement",
      "continue_statement",
      "expression_statement",
    ]),
  },
};

const TS_TOOLS: LanguageTools = {
  ...JS_TOOLS,
  id: "typescript",
};

const LANGUAGE_BY_EXTENSION: Record<string, LanguageId> = {
  py: "python",
  c: "c",
  h: "c",
  go: "go",
  rb: "ruby",
  java: "java",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
};

export const getLanguageIdFromFileName = (
  fileName?: string
): LanguageId | undefined => {
  if (!fileName) return undefined;
  const parts = fileName.split(".");
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION[ext];
};

export const getLanguageToolsForFileName = (
  fileName?: string
): LanguageTools => {
  const languageId = getLanguageIdFromFileName(fileName);
  if (languageId === "c") return C_TOOLS;
  if (languageId === "go") return GO_TOOLS;
  if (languageId === "ruby") return RUBY_TOOLS;
  if (languageId === "java") return JAVA_TOOLS;
  if (languageId === "javascript") return JS_TOOLS;
  if (languageId === "typescript") return TS_TOOLS;
  return PY_TOOLS;
};
