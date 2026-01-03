import type { TreeSitterAstNode } from "../../treeSitter";
import {
  childByField,
  collectDescendants,
  extractDeclaratorName,
  extractDeclaredNames,
  extractDeclaredTypeText,
  extractInitializerText,
  findParameterList,
  getDeclaratorsForDeclaration,
  getSectionFirstItem,
  textForRange,
  extractDeclaratorNameNode,
} from "./cCuration";
import { randomString } from "../../utils";

// ============================================================================
// Types
// ============================================================================

export type EngineOptions = {
  profile: "shallow" | "deep";
  includeNames?: boolean;
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

export type QuizQuestion = {
  kind: string;
  stem: string;
  answerLabel: string;
  options: string[];
  sourceRefs: SourceRef[];
  generatorRule: string;
  difficulty?: "easy" | "medium" | "hard";
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  optionPool?: string[];
  multiSelectHint?: number;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
  distractorPoolSize?: number;
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

// ============================================================================
// Helpers
// ============================================================================

export const textForNode = (node: TreeSitterAstNode, code: string): string =>
  code.substring(node.startIndex, node.endIndex);

export const textForRangeSafe = (
  start: number | undefined,
  end: number | undefined,
  code?: string
) => textForRange(start, end, code);

const headerSpanForNode = (
  node: TreeSitterAstNode,
  code?: string
): { start: number; end: number } => {
  const body =
    getSectionFirstItem(node, "body") || getSectionFirstItem(node, "then");
  let headerEnd = body?.startIndex ?? node.endIndex;
  if (code && headerEnd <= node.startIndex) {
    const snippet = code.slice(node.startIndex, node.endIndex);
    const braceIdx = snippet.indexOf("{");
    const colonIdx = snippet.indexOf(":");
    const semiIdx = snippet.indexOf(";");
    const candidates: number[] = [];
    if (braceIdx >= 0) candidates.push(node.startIndex + braceIdx);
    if (colonIdx >= 0) candidates.push(node.startIndex + colonIdx + 1);
    if (semiIdx >= 0) candidates.push(node.startIndex + semiIdx);
    if (candidates.length) headerEnd = Math.min(...candidates);
  }
  return { start: node.startIndex, end: headerEnd };
};

const headerAnswer = (node: TreeSitterAstNode, code?: string): string => {
  if (!code) return node.type;
  const span = headerSpanForNode(node, code);
  return code.slice(span.start, span.end).trimEnd();
};

const displaySpanForNode = (
  node: TreeSitterAstNode,
  code?: string
): { start: number; end: number } => {
  const span = headerSpanForNode(node, code);
  if (span.end <= span.start) {
    return { start: node.startIndex, end: node.endIndex };
  }
  return span;
};

// Path cache: WeakMap keyed by root node, then by target node object.
const pathCache = new WeakMap<TreeSitterAstNode, WeakMap<TreeSitterAstNode, number[]>>();

export const computeAstPath = (
  root: TreeSitterAstNode,
  target: TreeSitterAstNode
): number[] => {
  let rootCache = pathCache.get(root);
  if (!rootCache) {
    rootCache = new WeakMap<TreeSitterAstNode, number[]>();
    pathCache.set(root, rootCache);
  }

  const cached = rootCache.get(target);
  if (cached !== undefined) {
    return cached;
  }

  const path: number[] = [];
  let found = false;
  const dfs = (n: TreeSitterAstNode, cur: number[]) => {
    if (found) return;
    if (
      n.startIndex === target.startIndex &&
      n.endIndex === target.endIndex &&
      n.type === target.type
    ) {
      path.push(...cur);
      found = true;
      return;
    }
    (n.namedChildren || []).forEach((c, idx) => dfs(c, cur.concat(idx)));
  };
  dfs(root, []);

  rootCache.set(target, path);
  return path;
};

const GENERIC_IDENTIFIERS = [
  "i",
  "j",
  "k",
  "n",
  "x",
  "y",
  "z",
  "ptr",
  "buf",
  "len",
  "size",
  "count",
  "index",
  "value",
  "result",
  "temp",
  "flag",
];

const INCLUDE_DISTRACTORS = [
  "stdio.h",
  "stdlib.h",
  "string.h",
  "stdint.h",
  "stdbool.h",
  "math.h",
  "time.h",
  "ctype.h",
  "limits.h",
  "assert.h",
];

// ============================================================================
// Quiz helpers
// ============================================================================

const sourceRefForNode = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  code?: string
): SourceRef => ({
  nodeType: node.type,
  start: node.startIndex,
  end: node.endIndex,
  path: computeAstPath(root, node),
  preview: textForRangeSafe(node.startIndex, node.endIndex, code)?.slice(0, 120),
});

const makeQuestion = (args: {
  root: TreeSitterAstNode;
  node: TreeSitterAstNode;
  code?: string;
  kind: string;
  stem: string;
  answerLabel: string;
  generatorRule: string;
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  optionPool?: string[];
  multiSelectHint?: number;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
}): QuizQuestion => ({
  kind: args.kind,
  stem: args.stem,
  answerLabel: args.answerLabel,
  options: [],
  sourceRefs: [sourceRefForNode(args.root, args.node, args.code)],
  generatorRule: args.generatorRule,
  questionType: args.questionType,
  multiCorrect: args.multiCorrect,
  optionPool: args.optionPool,
  multiSelectHint: args.multiSelectHint,
  revealStart: args.revealStart,
  revealEndBeforeChild: args.revealEndBeforeChild,
  revealEndAfterChild: args.revealEndAfterChild,
});

const extractIncludePath = (
  node: TreeSitterAstNode,
  code: string
): { path: string; isSystem: boolean } | undefined => {
  const pathNode = getSectionFirstItem(node, "path");
  const raw =
    (pathNode && textForNode(pathNode, code)) || textForNode(node, code);
  const match = raw.match(/<([^>]+)>|\"([^\"]+)\"/);
  const path = (match?.[1] || match?.[2] || raw).trim();
  const isSystem = raw.includes("<") && raw.includes(">");
  return path ? { path, isSystem } : undefined;
};

const extractFunctionDeclarator = (node: TreeSitterAstNode) =>
  childByField(node, "declarator") ||
  (node.namedChildren || []).find((c) => c.type.includes("declarator"));

const extractFunctionName = (node: TreeSitterAstNode, code?: string) => {
  const declarator = extractFunctionDeclarator(node);
  return extractDeclaratorName(declarator, code);
};

const extractFunctionParams = (node: TreeSitterAstNode, code?: string) => {
  const declarator = extractFunctionDeclarator(node);
  const paramsList = findParameterList(declarator);
  const params = paramsList ? paramsList.namedChildren || [] : [];
  const names: string[] = [];
  let variadic = false;
  for (const param of params) {
    if (param.type === "ellipsis") {
      variadic = true;
      continue;
    }
    const name = extractDeclaratorName(param, code);
    if (name) names.push(name);
  }
  return { names, variadic, params };
};

const extractReturnType = (node: TreeSitterAstNode, code?: string) =>
  extractDeclaredTypeText(node, code);

const extractStructFields = (node: TreeSitterAstNode, code?: string) => {
  const fields = collectDescendants(
    node,
    (c) => c.type === "field_declaration"
  );
  const names: string[] = [];
  const types: Record<string, string> = {};
  for (const field of fields) {
    const fieldNames = extractDeclaredNames(field, code);
    const fieldType = extractDeclaredTypeText(field, code);
    for (const name of fieldNames) {
      names.push(name);
      if (fieldType) types[name] = fieldType;
    }
  }
  return { names: Array.from(new Set(names)), types };
};

const extractEnumEnumerators = (node: TreeSitterAstNode, code?: string) => {
  const enumerators = collectDescendants(node, (c) => c.type === "enumerator");
  const names: string[] = [];
  const values: Record<string, string> = {};
  for (const enumerator of enumerators) {
    const nameNode =
      extractDeclaratorNameNode(enumerator) ||
      (enumerator.namedChildren || []).find((c) => c.type === "identifier");
    const name = nameNode
      ? textForRangeSafe(nameNode.startIndex, nameNode.endIndex, code)
      : undefined;
    if (name) names.push(name);
    const valueNode =
      childByField(enumerator, "value") || (enumerator.namedChildren || [])[1];
    if (name && valueNode && code) {
      values[name] = code
        .slice(valueNode.startIndex, valueNode.endIndex)
        .trim();
    }
  }
  return { names: Array.from(new Set(names)), values };
};

// ============================================================================
// Statement anchors
// ============================================================================

const ANCHOR_NODE_TYPES = new Set<string>([
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
]);

export const isAnchorNode = (node: TreeSitterAstNode): boolean => {
  if (ANCHOR_NODE_TYPES.has(node.type)) return true;
  if (node.type.endsWith("_statement") && node.type !== "compound_statement")
    return true;
  return false;
};

const BODY_NODE_TYPES = new Set(["compound_statement"]);

const getStatementChildren = (node: TreeSitterAstNode): TreeSitterAstNode[] =>
  (node.namedChildren || []).filter((c) => c.type !== "comment");

const statementHasAnchor = (node: TreeSitterAstNode): boolean => {
  const stack = (node.namedChildren || []).slice();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (BODY_NODE_TYPES.has(cur.type)) continue;
    if (isAnchorNode(cur)) return true;
    if (cur.namedChildren && cur.namedChildren.length) {
      stack.push(...cur.namedChildren);
    }
  }
  return false;
};

const hasQuizChildren = (node: TreeSitterAstNode): boolean => {
  const stack = (node.namedChildren || []).slice();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (BODY_NODE_TYPES.has(cur.type)) {
      const statements = getStatementChildren(cur);
      for (const stmt of statements) {
        if (isAnchorNode(stmt) || statementHasAnchor(stmt)) return true;
      }
      continue;
    }
    if (cur.namedChildren && cur.namedChildren.length) {
      stack.push(...cur.namedChildren);
    }
  }
  return false;
};

// ============================================================================
// Quiz rules
// ============================================================================

type DecompositionLevel = "shallow" | "deep";

const generateQuestionsForAnchor = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  profile: DecompositionLevel,
  code: string
): QuizQuestion[] => {
  const questions: QuizQuestion[] = [];

  switch (node.type) {
    case "function_definition": {
      const headerSpan = headerSpanForNode(node, code);
      questions.push(
        makeQuestion({
          root,
          node,
          code,
          kind: "header",
          stem: "Write the full header line",
          answerLabel: headerAnswer(node, code),
          generatorRule: "header.line",
          revealStart: node.startIndex,
          revealEndBeforeChild: headerSpan.end,
          revealEndAfterChild: headerSpan.end,
        })
      );

      const name = extractFunctionName(node, code);
      if (name) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "function.name",
            stem: "What is the function name?",
            answerLabel: name,
            generatorRule: "function.name",
          })
        );
      }

      const { names: params, variadic, params: paramNodes } =
        extractFunctionParams(node, code);
      if (params.length > 0) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "function.params",
            stem: "Which parameters does this function take?",
            answerLabel: "",
            generatorRule: "function.params",
            questionType: "multi",
            multiCorrect: params,
            optionPool: GENERIC_IDENTIFIERS,
            multiSelectHint: params.length,
          })
        );
      }

      if (profile === "deep") {
        const returnType = extractReturnType(node, code);
        if (returnType) {
          questions.push(
            makeQuestion({
              root,
              node,
              code,
              kind: "function.return_type",
              stem: "What is the return type?",
              answerLabel: returnType,
              generatorRule: "function.return_type",
            })
          );
        }
        for (const paramNode of paramNodes) {
          const paramName = extractDeclaratorName(paramNode, code);
          const paramType = extractDeclaredTypeText(paramNode, code);
          if (paramName && paramType) {
            questions.push(
              makeQuestion({
                root,
                node,
                code,
                kind: "param.type",
                stem: `What is the type of parameter ${paramName}?`,
                answerLabel: paramType,
                generatorRule: "param.type",
              })
            );
          }
        }
        if (variadic) {
          questions.push(
            makeQuestion({
              root,
              node,
              code,
              kind: "function.variadic",
              stem: "Is this function variadic?",
              answerLabel: "yes",
              generatorRule: "function.variadic",
            })
          );
        }
      }
      return questions;
    }

    case "declaration":
    case "type_definition": {
      const names = extractDeclaredNames(node, code);
      if (names.length > 0) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "decl.names",
            stem: "Which names are declared here?",
            answerLabel: "",
            generatorRule: "decl.names",
            questionType: "multi",
            multiCorrect: names,
            optionPool: GENERIC_IDENTIFIERS,
            multiSelectHint: names.length,
          })
        );
      }

      const baseType = extractDeclaredTypeText(node, code);
      if (baseType) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "decl.type",
            stem: "What is the declared base type?",
            answerLabel: baseType,
            generatorRule: "decl.type",
          })
        );
      }

      if (profile === "deep") {
        const declarators = getDeclaratorsForDeclaration(node);
        for (const decl of declarators) {
          const name = extractDeclaratorName(decl, code);
          const init = extractInitializerText(decl, code);
          if (name && init) {
            questions.push(
              makeQuestion({
                root,
                node,
                code,
                kind: "decl.init",
                stem: `What is the initializer for ${name}?`,
                answerLabel: init,
                generatorRule: "decl.init",
              })
            );
          }
        }
      }

      const structNode = collectDescendants(
        node,
        (n) => n.type === "struct_specifier"
      )[0];
      if (structNode) {
        questions.push(
          ...generateQuestionsForAnchor(root, structNode, profile, code)
        );
      }
      const enumNode = collectDescendants(
        node,
        (n) => n.type === "enum_specifier"
      )[0];
      if (enumNode) {
        questions.push(
          ...generateQuestionsForAnchor(root, enumNode, profile, code)
        );
      }
      return questions;
    }

    case "struct_specifier": {
      const { names, types } = extractStructFields(node, code);
      if (names.length > 0) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "struct.fields",
            stem: "Which fields are declared?",
            answerLabel: "",
            generatorRule: "struct.fields",
            questionType: "multi",
            multiCorrect: names,
            optionPool: GENERIC_IDENTIFIERS,
            multiSelectHint: names.length,
          })
        );
      }
      if (profile === "deep") {
        for (const name of names) {
          const fieldType = types[name];
          if (fieldType) {
            questions.push(
              makeQuestion({
                root,
                node,
                code,
                kind: "struct.field_type",
                stem: `What is the type of field ${name}?`,
                answerLabel: fieldType,
                generatorRule: "struct.field_type",
              })
            );
          }
        }
      }
      return questions;
    }

    case "enum_specifier": {
      const { names, values } = extractEnumEnumerators(node, code);
      if (names.length > 0) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "enum.enumerators",
            stem: "Which enumerators are declared?",
            answerLabel: "",
            generatorRule: "enum.enumerators",
            questionType: "multi",
            multiCorrect: names,
            optionPool: GENERIC_IDENTIFIERS,
            multiSelectHint: names.length,
          })
        );
      }
      if (profile === "deep") {
        for (const name of names) {
          const value = values[name];
          if (value) {
            questions.push(
              makeQuestion({
                root,
                node,
                code,
                kind: "enum.value",
                stem: `What is the value of ${name}?`,
                answerLabel: value,
                generatorRule: "enum.value",
              })
            );
          }
        }
      }
      return questions;
    }

    case "if_statement":
    case "for_statement":
    case "while_statement":
    case "do_statement":
    case "switch_statement": {
      const headerSpan = headerSpanForNode(node, code);
      questions.push(
        makeQuestion({
          root,
          node,
          code,
          kind: "header",
          stem: "Write the full header line",
          answerLabel: headerAnswer(node, code),
          generatorRule: "header.line",
          revealStart: node.startIndex,
          revealEndBeforeChild: headerSpan.end,
          revealEndAfterChild: headerSpan.end,
        })
      );

      if (profile === "deep") {
        const condition =
          childByField(node, "condition") ||
          childByField(node, "value") ||
          (node.namedChildren || [])[0];
        if (condition) {
          questions.push(
            makeQuestion({
              root,
              node,
              code,
              kind: "control.condition",
              stem:
                node.type === "switch_statement"
                  ? "What value is switched on?"
                  : "What is the condition?",
              answerLabel: textForNode(condition, code),
              generatorRule: "control.condition",
            })
          );
        }

        if (node.type === "switch_statement") {
          const body = getSectionFirstItem(node, "body");
          const cases = body
            ? collectDescendants(body, (c) =>
                c.type === "case_statement" || c.type === "labeled_statement"
              )
            : [];
          const labels = cases
            .map((c) => headerAnswer(c, code))
            .filter(Boolean);
          if (labels.length > 0) {
            questions.push(
              makeQuestion({
                root,
                node,
                code,
                kind: "switch.cases",
                stem: "Which case labels exist?",
                answerLabel: "",
                generatorRule: "switch.cases",
                questionType: "multi",
                multiCorrect: labels,
                optionPool: labels.concat(GENERIC_IDENTIFIERS),
                multiSelectHint: labels.length,
              })
            );
          }
        }
      }
      return questions;
    }

    case "case_statement":
    case "labeled_statement": {
      const headerSpan = headerSpanForNode(node, code);
      questions.push(
        makeQuestion({
          root,
          node,
          code,
          kind: "header",
          stem: "Write the full header line",
          answerLabel: headerAnswer(node, code),
          generatorRule: "header.line",
          revealStart: node.startIndex,
          revealEndBeforeChild: headerSpan.end,
          revealEndAfterChild: headerSpan.end,
        })
      );
      return questions;
    }

    case "return_statement": {
      const value = (node.namedChildren || [])[0];
      if (value) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "return.value",
            stem: "What value is returned?",
            answerLabel: textForNode(value, code),
            generatorRule: "return.value",
          })
        );
      }
      return questions;
    }

    case "goto_statement": {
      const label = (node.namedChildren || [])[0];
      if (label) {
        questions.push(
          makeQuestion({
            root,
            node,
            code,
            kind: "goto.label",
            stem: "What label is jumped to?",
            answerLabel: textForNode(label, code),
            generatorRule: "goto.label",
          })
        );
      }
      return questions;
    }

    case "expression_statement": {
      const expr = (node.namedChildren || [])[0];
      if (!expr) return questions;
      if (expr.type === "call_expression") {
        const callee =
          childByField(expr, "function") ||
          childByField(expr, "callee") ||
          (expr.namedChildren || [])[0];
        if (callee) {
          questions.push(
            makeQuestion({
              root,
              node,
              code,
              kind: "call.callee",
              stem: "What function is called?",
              answerLabel: textForNode(callee, code),
              generatorRule: "call.callee",
            })
          );
        }
      }
      if (expr.type === "assignment_expression" && profile === "deep") {
        const left = childByField(expr, "left") || (expr.namedChildren || [])[0];
        const right =
          childByField(expr, "right") || (expr.namedChildren || [])[1];
        if (left) {
          questions.push(
            makeQuestion({
              root,
              node,
              code,
              kind: "assign.left",
              stem: "What is the left-hand side?",
              answerLabel: textForNode(left, code),
              generatorRule: "assign.left",
            })
          );
        }
        if (right) {
          questions.push(
            makeQuestion({
              root,
              node,
              code,
              kind: "assign.right",
              stem: "What is the right-hand side?",
              answerLabel: textForNode(right, code),
              generatorRule: "assign.right",
            })
          );
        }
      }
      return questions;
    }

    default:
      return questions;
  }
};

const generateImportRunQuestions = (
  root: TreeSitterAstNode,
  run: TreeSitterAstNode[],
  code: string,
  profile: DecompositionLevel
): QuizQuestion[] => {
  const includes = run
    .map((n) => extractIncludePath(n, code))
    .filter(Boolean) as Array<{ path: string; isSystem: boolean }>;
  if (includes.length === 0) return [];
  const paths = includes.map((i) => i.path);
  const questions: QuizQuestion[] = [];
  questions.push(
    makeQuestion({
      root,
      node: run[0],
      code,
      kind: "import_group",
      stem: "Which headers are included here?",
      answerLabel: "",
      generatorRule: "import_group.headers",
      questionType: "multi",
      multiCorrect: paths,
      optionPool: INCLUDE_DISTRACTORS,
      multiSelectHint: paths.length,
    })
  );

  if (profile === "deep") {
    const systemHeaders = includes.filter((i) => i.isSystem).map((i) => i.path);
    if (systemHeaders.length > 0) {
      questions.push(
        makeQuestion({
          root,
          node: run[0],
          code,
          kind: "import_group.system",
          stem: "Which of these are system includes (<...>)?",
          answerLabel: "",
          generatorRule: "import_group.system",
          questionType: "multi",
          multiCorrect: systemHeaders,
          optionPool: paths.concat(INCLUDE_DISTRACTORS),
          multiSelectHint: systemHeaders.length,
        })
      );
    }
  }
  return questions;
};

const NO_FALLBACK_QUIZ_NODE_TYPES = new Set<string>([
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
]);

const isHeaderQuestion = (q: QuizQuestion): boolean =>
  q.stem === "Write the full header line" || q.generatorRule === "header.line";

const spanForQuestion = (
  q: QuizQuestion
): { start: number; end: number } | undefined => {
  if (
    typeof q.revealEndBeforeChild === "number" &&
    typeof q.revealEndAfterChild === "number" &&
    Number.isFinite(q.revealEndBeforeChild) &&
    Number.isFinite(q.revealEndAfterChild) &&
    q.revealEndAfterChild >= q.revealEndBeforeChild
  ) {
    return { start: q.revealEndBeforeChild, end: q.revealEndAfterChild };
  }
  if (Array.isArray(q.sourceRefs) && q.sourceRefs.length > 0) {
    let best = q.sourceRefs[0];
    for (const ref of q.sourceRefs) {
      if (ref.end - ref.start < best.end - best.start) best = ref;
    }
    return { start: best.start, end: best.end };
  }
  return undefined;
};

const applyOverlapGuard = (steps: EngineStep[]) => {
  type Entry = {
    question: QuizQuestion;
    span: { start: number; end: number };
    isHeader: boolean;
  };

  const entries: Entry[] = [];
  const collect = (step: EngineStep) => {
    for (const q of step.quiz?.questions || []) {
      const span = spanForQuestion(q);
      if (span) {
        entries.push({ question: q, span, isHeader: isHeaderQuestion(q) });
      }
    }
    for (const child of step.lesson?.childSteps || []) collect(child);
  };
  steps.forEach(collect);

  const sorted = entries.slice().sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    if (lenA !== lenB) return lenA - lenB;
    return a.span.start - b.span.start;
  });

  const seenKeys = new Set<string>();
  const kept: typeof entries = [];
  const drop = new Set<QuizQuestion>();

  const makeDuplicateKey = (entry: Entry) =>
    `${entry.span.start}:${entry.span.end}:${entry.question.stem}:${entry.question.answerLabel}`;

  for (const entry of sorted) {
    const dupKey = makeDuplicateKey(entry);
    if (seenKeys.has(dupKey)) {
      drop.add(entry.question);
      continue;
    }

    if (!entry.isHeader && kept.length > 0) {
      const entryLen = entry.span.end - entry.span.start;
      const smallestKeptLen = kept[0].span.end - kept[0].span.start;
      if (entryLen > smallestKeptLen) {
        const containsKept = kept.some(
          (k) =>
            entry.span.start <= k.span.start &&
            entry.span.end >= k.span.end &&
            (entry.span.start < k.span.start || entry.span.end > k.span.end)
        );
        if (containsKept) {
          drop.add(entry.question);
          continue;
        }
      }
    }

    seenKeys.add(dupKey);
    kept.push(entry);
  }

  const filter = (step: EngineStep) => {
    if (step.quiz?.questions?.length) {
      step.quiz.questions = step.quiz.questions.filter((q) => !drop.has(q));
      if (step.quiz.questions.length === 0) step.quiz = undefined;
    }
    const children = step.lesson?.childSteps || [];
    if (children.length) children.forEach(filter);
  };

  steps.forEach(filter);
};

// ============================================================================
// Main walker
// ============================================================================

export const generateEngineSteps = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  code: string,
  options: EngineOptions
): EngineStep[] => {
  const steps: EngineStep[] = [];
  const mappedProfile: DecompositionLevel =
    options.profile === "deep" ? "deep" : "shallow";

  const buildQuestionsForAnchor = (anchor: TreeSitterAstNode): QuizQuestion[] => {
    if (options.generateQuiz === false) return [];
    const ruleQuestions = generateQuestionsForAnchor(
      root,
      anchor,
      mappedProfile,
      code
    );
    if (ruleQuestions.length) return ruleQuestions;
    if (NO_FALLBACK_QUIZ_NODE_TYPES.has(anchor.type)) return [];
    if (hasQuizChildren(anchor)) return [];
    const txt = textForNode(anchor, code);
    return [
      {
        kind: "shallow_ident",
        stem: "What comes next?",
        answerLabel: txt,
        options: [],
        sourceRefs: [sourceRefForNode(root, anchor, code)],
        generatorRule: "shallow_statement",
      },
    ];
  };

  const buildLessonDataForAnchor = (
    anchor: TreeSitterAstNode,
    hasChildStatements: boolean
  ): EngineStep["lesson"] | undefined => {
    switch (anchor.type) {
      case "function_definition": {
        const name = extractFunctionName(anchor, code);
        const nameText = name && options.includeNames !== false ? ` ${name}` : "";
        return {
          prompt: `We define a function${nameText}.`,
          semanticRole: "function_definition",
          isDigable: hasChildStatements,
        };
      }
      case "declaration":
      case "type_definition": {
        const names = extractDeclaredNames(anchor, code);
        const nameText =
          names.length && options.includeNames !== false
            ? `: ${names.join(", ")}`
            : ".";
        return {
          prompt: `We declare variable(s)${nameText}`,
          semanticRole: "declaration",
          isDigable: hasChildStatements,
        };
      }
      case "struct_specifier":
        return {
          prompt: "We define a struct.",
          semanticRole: "struct_specifier",
          isDigable: hasChildStatements,
        };
      case "enum_specifier":
        return {
          prompt: "We define an enum.",
          semanticRole: "enum_specifier",
          isDigable: hasChildStatements,
        };
      case "if_statement":
        return {
          prompt: "We check a condition.",
          semanticRole: "if_statement",
          isDigable: hasChildStatements,
        };
      case "for_statement":
      case "while_statement":
      case "do_statement":
        return {
          prompt: "We enter a loop.",
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      case "switch_statement":
        return {
          prompt: "We branch on a switch.",
          semanticRole: "switch_statement",
          isDigable: hasChildStatements,
        };
      case "case_statement":
      case "labeled_statement":
        return {
          prompt: "We handle a labeled case.",
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      case "return_statement":
        return {
          prompt: "We return from the function.",
          semanticRole: "return_statement",
          isDigable: false,
        };
      case "expression_statement":
        return {
          prompt: "We execute a statement.",
          semanticRole: "expression_statement",
          isDigable: false,
        };
      default:
        return {
          prompt: `We encounter a ${anchor.type.replaceAll("_", " ")}.`,
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
    }
  };

  const emitAnchorStep = (
    anchor: TreeSitterAstNode,
    hasChildStatements: boolean
  ) => {
    const questions = buildQuestionsForAnchor(anchor);
    const lessonData = buildLessonDataForAnchor(anchor, hasChildStatements);
    steps.push({
      id: randomString(8),
      node: anchor,
      displaySpan: displaySpanForNode(anchor, code),
      lesson: lessonData,
      quiz: questions.length > 0 ? { questions } : undefined,
    });
  };

  const blockHasStatements = (block?: TreeSitterAstNode) =>
    Boolean(block && getStatementChildren(block).some(isAnchorNode));
  const nodeHasAnchors = (child?: TreeSitterAstNode) => {
    if (!child) return false;
    if (isAnchorNode(child)) return true;
    if (BODY_NODE_TYPES.has(child.type)) return blockHasStatements(child);
    return statementHasAnchor(child);
  };

  const isIncludeStmt = (stmt: TreeSitterAstNode) =>
    stmt.type === "preproc_include";

  const collectIncludeRun = (
    children: TreeSitterAstNode[],
    startIndex: number
  ): { run: TreeSitterAstNode[]; nextIndex: number } => {
    const run: TreeSitterAstNode[] = [];
    let i = startIndex;
    while (i < children.length && isIncludeStmt(children[i])) {
      run.push(children[i]);
      i++;
    }
    return { run, nextIndex: i };
  };

  const emitIncludeRunStep = (run: TreeSitterAstNode[]) => {
    if (!run.length) return;
    const first = run[0];
    const last = run[run.length - 1];
    const span = { start: first.startIndex, end: last.endIndex };
    const virtualNode = {
      ...first,
      type: "import_group",
      startIndex: span.start,
      endIndex: span.end,
      isVirtual: true,
    };

    const questions =
      options.generateQuiz !== false
        ? generateImportRunQuestions(root, run, code, mappedProfile)
        : [];

    const childSteps: EngineStep[] = run.map((includeNode) => ({
      id: randomString(8),
      node: includeNode,
      displaySpan: { start: includeNode.startIndex, end: includeNode.endIndex },
      lesson: {
        semanticRole: includeNode.type,
        prompt: "Include directive.",
        isDigable: false,
      },
    }));

    const lessonPrompt =
      run.length === 1
        ? "We include a header."
        : `We include ${run.length} headers.`;

    steps.push({
      id: randomString(8),
      node: virtualNode,
      displaySpan: span,
      lesson: {
        semanticRole: "import_group",
        prompt: lessonPrompt,
        isDigable: childSteps.length > 0,
        childSteps,
      },
      quiz: questions.length > 0 ? { questions } : undefined,
    });
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    const children = getStatementChildren(block);
    let i = 0;
    while (i < children.length) {
      const stmt = children[i];
      if (isIncludeStmt(stmt)) {
        const { run, nextIndex } = collectIncludeRun(children, i);
        emitIncludeRunStep(run);
        i = nextIndex;
      } else if (isAnchorNode(stmt)) {
        walkStmt(stmt);
        i++;
      } else {
        i++;
      }
    }
  };

  const walkBodyNode = (body?: TreeSitterAstNode) => {
    if (!body) return;
    if (body.type === "compound_statement") {
      walkBlock(body);
      return;
    }
    if (isAnchorNode(body)) {
      walkStmt(body);
    }
  };

  const walkStmt = (stmt: TreeSitterAstNode) => {
    if (!isAnchorNode(stmt)) return;
    switch (stmt.type) {
      case "function_definition": {
        const body = getSectionFirstItem(stmt, "body");
        const hasChildStatements = nodeHasAnchors(body);
        emitAnchorStep(stmt, hasChildStatements);
        if (body) walkBlock(body);
        break;
      }
      case "if_statement": {
        const thenBody = getSectionFirstItem(stmt, "then");
        const elseBody = getSectionFirstItem(stmt, "else");
        const hasChildStatements =
          nodeHasAnchors(thenBody) || nodeHasAnchors(elseBody);
        emitAnchorStep(stmt, hasChildStatements);
        walkBodyNode(thenBody);
        walkBodyNode(elseBody);
        break;
      }
      case "for_statement":
      case "while_statement":
      case "do_statement":
      case "switch_statement": {
        const body = getSectionFirstItem(stmt, "body");
        const hasChildStatements = nodeHasAnchors(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBodyNode(body);
        break;
      }
      case "case_statement":
      case "labeled_statement": {
        const body = getSectionFirstItem(stmt, "body");
        const hasChildStatements = body
          ? nodeHasAnchors(body)
          : false;
        emitAnchorStep(stmt, hasChildStatements);
        walkBodyNode(body);
        break;
      }
      default: {
        emitAnchorStep(stmt, false);
        break;
      }
    }
  };

  if (node.type === "translation_unit") {
    walkBlock(node);
  } else if (BODY_NODE_TYPES.has(node.type)) {
    walkBlock(node);
  } else if (isAnchorNode(node)) {
    walkStmt(node);
  } else {
    walkBlock(node);
  }

  applyOverlapGuard(steps);
  return steps;
};

// ============================================================================
// Lesson + quiz integrations
// ============================================================================

export type LessonHistoryItem = EngineStep & { action?: "next" | "dig" };

type MaskRange = { start: number; end: number };

function headerMaskAndAnswer(
  stmt: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  const { end: headerEnd } = headerSpanForNode(stmt, code);
  const answerText = headerAnswer(stmt, code);
  const masks =
    headerEnd > stmt.startIndex
      ? [{ start: stmt.startIndex, end: headerEnd }]
      : [];
  return { masks, answerText };
}

export function maskAndAnswerForStep(
  step: EngineStep,
  root: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  if ((step.node as any).isVirtual || step.node.type === "import_group") {
    return { masks: [], answerText: textForNode(step.node, code) };
  }
  const headerTypes = new Set([
    "function_definition",
    "if_statement",
    "for_statement",
    "while_statement",
    "do_statement",
    "switch_statement",
    "case_statement",
    "labeled_statement",
  ]);
  if (headerTypes.has(step.node.type)) {
    return headerMaskAndAnswer(step.node, code);
  }
  return { masks: [], answerText: textForNode(step.node, code) };
}

type CustomQuizCard = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  question?: string;
  semanticRole?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  sourceRef?: SourceRef;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
  distractorPoolSize?: number;
};

export function buildCustomQuizPayload(params: {
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  root: TreeSitterAstNode;
  code: string;
  history: LessonHistoryItem[];
  lessonQueue: EngineStep[];
  currentStep: number;
}) {
  const { fileKey, root, code, history, lessonQueue, currentStep } = params;

  const bestSourceRef = (q: QuizQuestion): SourceRef | undefined => {
    if (!Array.isArray(q.sourceRefs) || q.sourceRefs.length === 0) return undefined;
    let best = q.sourceRefs[0];
    for (const ref of q.sourceRefs) {
      if (ref.end - ref.start < best.end - best.start) best = ref;
    }
    const preview = textForRangeSafe(best.start, best.end, code)?.slice(0, 120);
    return preview ? { ...best, preview } : best;
  };

  const revealSpanForCard = (
    q: QuizQuestion,
    fallback?: SourceRef
  ): { start: number; end: number } | undefined => {
    const start =
      typeof q.revealStart === "number" ? q.revealStart : fallback?.start;
    const end =
      typeof q.revealEndAfterChild === "number"
        ? q.revealEndAfterChild
        : typeof q.revealEndBeforeChild === "number"
          ? q.revealEndBeforeChild
          : fallback?.end;
    if (typeof start === "number" && typeof end === "number" && end >= start) {
      return { start, end };
    }
    return undefined;
  };

  const questionToCard = (
    step: EngineStep,
    q: QuizQuestion,
    order: number,
    action: "next" | "dig"
  ): CustomQuizCard => {
    const isMulti =
      q.questionType === "multi" ||
      (Array.isArray(q.multiCorrect) && q.multiCorrect.length > 0);
    const span = step.displaySpan ?? {
      start: step.node.startIndex,
      end: step.node.endIndex,
    };
    const snippet = code.slice(span.start, span.end).trimEnd();
    const baseRef = bestSourceRef(q);
    const revealSpan = revealSpanForCard(q, baseRef);
    const cardRef =
      baseRef && revealSpan
        ? {
            ...baseRef,
            start: revealSpan.start,
            end: revealSpan.end,
            preview: textForRangeSafe(revealSpan.start, revealSpan.end, code)?.slice(0, 120),
          }
        : baseRef;
    return {
      order,
      type: q.kind,
      text: isMulti ? snippet : q.answerLabel,
      action,
      question: q.stem,
      semanticRole: step.lesson?.semanticRole,
      generatorRule: q.generatorRule,
      difficulty: q.difficulty,
      questionType: isMulti ? "multi" : undefined,
      multiCorrect: q.multiCorrect,
      multiSelectHint: q.multiSelectHint,
      optionPool: q.optionPool,
      sourceRef: cardRef,
      revealStart: q.revealStart,
      revealEndBeforeChild: q.revealEndBeforeChild,
      revealEndAfterChild: q.revealEndAfterChild,
      distractorPoolSize: q.distractorPoolSize,
    };
  };

  const cards: CustomQuizCard[] = [];
  let order = 0;

  const appendStepCards = (step: EngineStep, action: "next" | "dig") => {
    const questions = step.quiz?.questions || [];
    for (const q of questions) {
      cards.push(questionToCard(step, q, order++, action));
    }
    const children = step.lesson?.childSteps || [];
    for (const child of children) appendStepCards(child, action);
  };

  const filteredHistory = history.filter((h) => h.action !== "dig");
  for (const step of filteredHistory) {
    appendStepCards(step, step.action ?? "next");
  }
  for (const step of lessonQueue.slice(currentStep)) {
    appendStepCards(step, "next");
  }

  return {
    fileKey,
    name: `Custom quiz ${new Date().toLocaleString()}`,
    type: "CustomQuizV1.1" as const,
    profile: "shallow" as const,
    rootNode: {
      type: root.type,
      text: textForNode(root, code),
      start: root.startIndex,
      end: root.endIndex,
      path: [] as number[],
    },
    cards,
  };
}
