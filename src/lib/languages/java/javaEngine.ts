import type { TreeSitterAstNode } from "../../treeSitter";
import {
  childByField,
  childrenByField,
  childrenOfType,
  firstChildOfType,
  getRevealAnchors,
  getSectionItems,
  getSectionSpan,
} from "./javaCuration";
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

export const textForRange = (
  start: number | undefined,
  end: number | undefined,
  code?: string
) => {
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    typeof code === "string"
  ) {
    return code.slice(start, end);
  }
  return undefined;
};

const headerAnswer = (stmt: TreeSitterAstNode, code: string): string => {
  const { headerEnd } = getRevealAnchors(stmt);
  return code.substring(stmt.startIndex, headerEnd).trimEnd();
};

const headerSpanByAst = (
  node: TreeSitterAstNode
): { start: number; end: number } => {
  const { headerEnd } = getRevealAnchors(node);
  return { start: node.startIndex, end: headerEnd };
};

const displaySpanForNode = (
  node: TreeSitterAstNode
): { start: number; end: number } => {
  const span = headerSpanByAst(node);
  if (span.end <= span.start) {
    return { start: node.startIndex, end: node.endIndex };
  }
  return span;
};

const pathCache = new WeakMap<
  TreeSitterAstNode,
  WeakMap<TreeSitterAstNode, number[]>
>();

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
  if (cached !== undefined) return cached;

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

const GENERIC_DISTRACTORS = [
  "i",
  "j",
  "k",
  "x",
  "y",
  "z",
  "val",
  "item",
  "result",
  "data",
  "temp",
  "count",
  "index",
  "key",
  "value",
  "error",
  "response",
  "request",
  "config",
  "settings",
];

const COMMON_IMPORT_DISTRACTORS = [
  "java.util.*",
  "java.io.*",
  "java.lang.*",
  "java.time.*",
  "java.util.List",
  "java.util.Map",
  "java.util.Set",
  "java.util.stream.*",
  "javax.swing.*",
  "org.junit.*",
  "org.junit.jupiter.api.*",
];

const MODIFIER_KEYWORDS = [
  "public",
  "private",
  "protected",
  "static",
  "final",
  "abstract",
  "sealed",
  "non-sealed",
  "synchronized",
  "native",
  "strictfp",
  "transient",
  "volatile",
  "default",
];

const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
};

const splitCorrectIntoCards = (correct: string[]): string[][] => {
  const unique = [...new Set(correct)];
  if (unique.length <= 6) return [unique];

  const shuffled = shuffle(unique);
  const numCards = Math.ceil(unique.length / 6);
  const baseSize = Math.floor(unique.length / numCards);
  const remainder = unique.length % numCards;

  const cardIndices = [...Array(numCards).keys()];
  const shuffledIndices = shuffle(cardIndices);
  const extraSlots = new Set(shuffledIndices.slice(0, remainder));

  const cards: string[][] = [];
  let idx = 0;

  for (let c = 0; c < numCards; c++) {
    const size = baseSize + (extraSlots.has(c) ? 1 : 0);
    cards.push(shuffled.slice(idx, idx + size));
    idx += size;
  }

  return shuffle(cards);
};

const buildKeyGroupOptionPool = (
  correct: string[],
  allKeys: Set<string>,
  code: string,
  spanStart: number,
  spanEnd: number
): string[] => {
  const normalizeKeyToken = (raw: string) =>
    raw.trim().replace(/^["'`]|["'`]$/g, "");
  const normalizedKeys = new Set(
    Array.from(allKeys)
      .map(normalizeKeyToken)
      .filter(Boolean)
  );
  const candidates: string[] = [];
  const seenNormalized = new Set<string>();
  const pushCandidate = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > 40) return;
    const normalized = normalizeKeyToken(trimmed);
    if (!normalized) return;
    if (normalizedKeys.has(normalized)) return;
    if (seenNormalized.has(normalized)) return;
    seenNormalized.add(normalized);
    candidates.push(trimmed);
  };
  try {
    const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
    const reStr = /(["'`])((?:\\.|(?!\1).)*)\1/g;
    const snippet = (code || "").slice(spanStart, spanEnd);
    let m: RegExpExecArray | null;
    while ((m = reId.exec(snippet))) pushCandidate(m[0]);
    while ((m = reStr.exec(snippet))) pushCandidate(m[0]);
  } catch {}

  let pool = Array.from(new Set<string>([...correct, ...candidates]));
  if (pool.length < 10) {
    const needed = 10 - pool.length;
    const pad = shuffle(GENERIC_DISTRACTORS)
      .filter((d) => !pool.includes(d))
      .slice(0, needed);
    pool.push(...pad);
  }
  const MAX = 10;
  const extras = shuffle(pool.filter((p) => !correct.includes(p)));
  return shuffle([
    ...correct,
    ...extras.slice(0, Math.max(0, MAX - correct.length)),
  ]).slice(0, MAX);
};

// ============================================================================
// AST utilities
// ============================================================================

const unwrapStatement = (node?: TreeSitterAstNode) => {
  if (!node) return undefined;
  if (node.type === "statement" || node.type === "declaration") {
    return (node.namedChildren || [])[0] ?? node;
  }
  return node;
};

const getStatementChildren = (node: TreeSitterAstNode) => {
  const out: TreeSitterAstNode[] = [];
  for (const child of node.namedChildren || []) {
    if (child.type === "comment") continue;
    const unwrapped = unwrapStatement(child);
    if (unwrapped) out.push(unwrapped);
  }
  return out;
};

const firstNamedChild = (node?: TreeSitterAstNode) =>
  node ? (node.namedChildren || [])[0] : undefined;

const textForNodes = (nodes: TreeSitterAstNode[], code: string) =>
  nodes
    .map((n) => textForNode(n, code).trim())
    .filter((t) => t.length > 0);

const buildSourceRef = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  code: string
): SourceRef => {
  const preview = textForNode(node, code).slice(0, 120);
  return {
    nodeType: node.type,
    start: node.startIndex,
    end: node.endIndex,
    path: computeAstPath(root, node),
    preview: preview.length ? preview : undefined,
  };
};

const extractModifiersFromHeader = (
  node: TreeSitterAstNode,
  code: string
) => {
  const { headerEnd } = getRevealAnchors(node);
  const header = code.slice(node.startIndex, headerEnd);
  const found: string[] = [];
  for (const keyword of MODIFIER_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword.replace("-", "\\-")}\\b`);
    if (regex.test(header)) found.push(keyword);
  }
  return found;
};

const extractTypeTextsFromContainer = (
  node: TreeSitterAstNode | undefined,
  code: string
) => {
  if (!node) return [];
  const typeList = node.type === "type_list" ? node : firstChildOfType(node, "type_list");
  const types = typeList ? typeList.namedChildren || [] : node.namedChildren || [];
  const texts = textForNodes(types, code);
  if (texts.length > 0) return texts;
  const fallback = textForNode(node, code).trim();
  return fallback ? [fallback] : [];
};

const extractTypeParamNames = (
  typeParams: TreeSitterAstNode | undefined,
  code: string
) => {
  if (!typeParams) return [];
  const params = typeParams.namedChildren || [];
  const names = params
    .map((p) => firstChildOfType(p, "identifier") || firstNamedChild(p))
    .filter(Boolean) as TreeSitterAstNode[];
  return textForNodes(names, code);
};

const getParameterNodes = (paramsNode?: TreeSitterAstNode) => {
  if (!paramsNode) return [];
  if (paramsNode.type === "formal_parameters") return paramsNode.namedChildren || [];
  return [paramsNode];
};

const parameterName = (param: TreeSitterAstNode, code: string) => {
  if (param.type === "formal_parameter") {
    const name = childByField(param, "name");
    return name ? textForNode(name, code).trim() : undefined;
  }
  if (param.type === "receiver_parameter") {
    const name = firstChildOfType(param, "identifier") || firstChildOfType(param, "this");
    return name ? textForNode(name, code).trim() : "this";
  }
  if (param.type === "spread_parameter") {
    const decl = firstChildOfType(param, "variable_declarator");
    const name = decl ? childByField(decl, "name") : undefined;
    return name ? textForNode(name, code).trim() : undefined;
  }
  if (param.type === "identifier") {
    return textForNode(param, code).trim();
  }
  return textForNode(param, code).trim();
};

const parameterTypeNode = (param: TreeSitterAstNode) => {
  if (param.type === "formal_parameter") return childByField(param, "type");
  if (param.type === "receiver_parameter") return firstChildOfType(param, "_unannotated_type");
  if (param.type === "spread_parameter") return firstChildOfType(param, "_unannotated_type");
  return undefined;
};

const isVarArgParam = (param: TreeSitterAstNode, code: string) => {
  if (param.type === "spread_parameter") return true;
  const txt = textForNode(param, code);
  return txt.includes("...");
};

const extractAnnotations = (node: TreeSitterAstNode, code: string) => {
  const annotations = getSectionItems(node, "annotations");
  return textForNodes(annotations, code);
};

const collectAnnotationNodes = (node: TreeSitterAstNode) => {
  const modifiers = firstChildOfType(node, "modifiers");
  if (!modifiers) return [];
  const out: TreeSitterAstNode[] = [];
  const stack = (modifiers.namedChildren || []).slice();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "annotation" || cur.type === "marker_annotation") {
      out.push(cur);
    }
    if (cur.namedChildren && cur.namedChildren.length) {
      stack.push(...cur.namedChildren);
    }
  }
  return out;
};

const annotationLabel = (node: TreeSitterAstNode, code: string) => {
  const nameNode =
    childByField(node, "name") ||
    firstChildOfType(node, "scoped_identifier") ||
    firstChildOfType(node, "identifier");
  const nameText = nameNode ? textForNode(nameNode, code).trim() : "";
  return nameText ? `@${nameText}` : "this annotation";
};

const extractAnnotationValueEntries = (
  node: TreeSitterAstNode,
  code: string
) => {
  const entries: Array<{
    keyNode: TreeSitterAstNode;
    valueNode: TreeSitterAstNode;
    keyText: string;
  }> = [];
  const stack = (node.namedChildren || []).slice();
  const pairs: TreeSitterAstNode[] = [];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "element_value_pair") {
      pairs.push(cur);
      continue;
    }
    if (cur.namedChildren && cur.namedChildren.length) {
      stack.push(...cur.namedChildren);
    }
  }

  for (const pair of pairs) {
    const keyNode =
      childByField(pair, "name") ||
      childByField(pair, "key") ||
      firstChildOfType(pair, "identifier") ||
      firstChildOfType(pair, "scoped_identifier");
    const valueNode =
      childByField(pair, "value") ||
      (pair.namedChildren || []).find((c) => c !== keyNode);
    if (!keyNode || !valueNode) continue;
    const keyText = textForNode(keyNode, code).trim();
    if (!keyText) continue;
    entries.push({ keyNode, valueNode, keyText });
  }

  if (entries.length > 0) return entries;

  const implicitValue =
    childByField(node, "value") ||
    firstChildOfType(node, "element_value") ||
    firstChildOfType(node, "element_value_array_initializer");
  if (implicitValue) {
    entries.push({ keyNode: node, valueNode: implicitValue, keyText: "value" });
  }

  return entries;
};

const extractThrows = (node: TreeSitterAstNode, code: string) => {
  const throwsNode = firstChildOfType(node, "throws");
  if (!throwsNode) return [];
  return textForNodes(throwsNode.namedChildren || [], code);
};

const extractVariables = (node: TreeSitterAstNode, code: string) => {
  const declarators = childrenByField(node, "declarator");
  const names = declarators
    .map((d) => childByField(d, "name"))
    .filter(Boolean) as TreeSitterAstNode[];
  return textForNodes(names, code);
};

const extractVariableInitializers = (
  node: TreeSitterAstNode,
  code: string
) => {
  const out: Array<{ name: string; value: string; valueNode?: TreeSitterAstNode }> = [];
  const declarators = childrenByField(node, "declarator");
  for (const d of declarators) {
    const nameNode = childByField(d, "name");
    const valueNode = childByField(d, "value");
    if (!nameNode || !valueNode) continue;
    const nameText = textForNode(nameNode, code).trim();
    const valueText = textForNode(valueNode, code).trim();
    if (!nameText || !valueText) continue;
    out.push({ name: nameText, value: valueText, valueNode });
  }
  return out;
};

const extractMethodInvocationName = (
  node: TreeSitterAstNode,
  code: string
) => {
  const name = childByField(node, "name");
  const object = childByField(node, "object");
  const nameText = name ? textForNode(name, code).trim() : "";
  if (object) {
    const objText = textForNode(object, code).trim();
    if (objText && nameText) return `${objText}.${nameText}`;
  }
  return nameText || textForNode(node, code).trim();
};

const extractArguments = (node: TreeSitterAstNode) => {
  const argsNode = childByField(node, "arguments");
  return argsNode ? argsNode.namedChildren || [] : [];
};

const extractLambdaParams = (node: TreeSitterAstNode, code: string) => {
  const paramsNode = childByField(node, "parameters");
  const params = getParameterNodes(paramsNode);
  return params
    .map((p) => parameterName(p, code))
    .filter((p): p is string => Boolean(p));
};

const extractLambdaBody = (node: TreeSitterAstNode, code: string) => {
  const body = childByField(node, "body");
  return body ? textForNode(body, code).trim() : undefined;
};

// ============================================================================
// Quiz Helpers
// ============================================================================

const ANCHOR_NODE_TYPES = new Set<string>([
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
  "static_initializer",
  "local_variable_declaration",
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
]);

const HEADER_NODE_TYPES = new Set<string>([
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
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
]);

const NO_FALLBACK_QUIZ_NODE_TYPES = new Set<string>([
  "import_declaration",
  "import_group",
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "record_declaration",
  "annotation_type_declaration",
  "method_declaration",
  "constructor_declaration",
  "compact_constructor_declaration",
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
]);

const makeQuestion = (params: {
  kind: string;
  stem: string;
  answerLabel: string;
  sourceNode?: TreeSitterAstNode;
  generatorRule: string;
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  optionPool?: string[];
  revealSpan?: { start: number; end: number };
  root: TreeSitterAstNode;
  code: string;
}): QuizQuestion => {
  const sourceRefs = params.sourceNode
    ? [buildSourceRef(params.root, params.sourceNode, params.code)]
    : [];
  return {
    kind: params.kind,
    stem: params.stem,
    answerLabel: params.answerLabel,
    options: [],
    sourceRefs,
    generatorRule: params.generatorRule,
    questionType: params.questionType,
    multiCorrect: params.multiCorrect,
    optionPool: params.optionPool,
    multiSelectHint: params.multiCorrect?.length,
    revealStart: params.revealSpan?.start,
    revealEndBeforeChild: params.revealSpan?.start,
    revealEndAfterChild: params.revealSpan?.end,
  };
};

const addHeaderQuestion = (
  questions: QuizQuestion[],
  node: TreeSitterAstNode,
  root: TreeSitterAstNode,
  code: string
) => {
  const { headerEnd } = getRevealAnchors(node);
  const answer = headerAnswer(node, code);
  if (!answer.trim()) return;
  questions.push(
    makeQuestion({
      kind: "header",
      stem: "Write the full header line",
      answerLabel: answer,
      sourceNode: node,
      generatorRule: "header.line",
      revealSpan: { start: node.startIndex, end: headerEnd },
      root,
      code,
    })
  );
};

const addSingleQuestion = (
  questions: QuizQuestion[],
  params: {
    kind: string;
    stem: string;
    answer: string;
    node?: TreeSitterAstNode;
    generatorRule: string;
    revealSpan?: { start: number; end: number };
    root: TreeSitterAstNode;
    code: string;
  }
) => {
  if (!params.answer.trim()) return;
  questions.push(
    makeQuestion({
      kind: params.kind,
      stem: params.stem,
      answerLabel: params.answer,
      sourceNode: params.node,
      generatorRule: params.generatorRule,
      revealSpan: params.revealSpan,
      root: params.root,
      code: params.code,
    })
  );
};

const addMultiQuestion = (
  questions: QuizQuestion[],
  params: {
    kind: string;
    stem: string;
    answers: string[];
    node?: TreeSitterAstNode;
    generatorRule: string;
    optionPool?: string[];
    revealSpan?: { start: number; end: number };
    root: TreeSitterAstNode;
    code: string;
  }
) => {
  const cleaned = params.answers.map((a) => a.trim()).filter((a) => a.length > 0);
  if (cleaned.length === 0) return;
  questions.push(
    makeQuestion({
      kind: params.kind,
      stem: params.stem,
      answerLabel: "",
      sourceNode: params.node,
      generatorRule: params.generatorRule,
      questionType: "multi",
      multiCorrect: cleaned,
      optionPool: params.optionPool,
      revealSpan: params.revealSpan,
      root: params.root,
      code: params.code,
    })
  );
};

const addAnnotationValueQuestions = (
  questions: QuizQuestion[],
  anchor: TreeSitterAstNode,
  root: TreeSitterAstNode,
  code: string
) => {
  const annotations = collectAnnotationNodes(anchor);
  if (annotations.length === 0) return;
  for (const annotation of annotations) {
    const entries = extractAnnotationValueEntries(annotation, code);
    if (entries.length === 0) continue;
    const label = annotationLabel(annotation, code);
    const keys = entries.map((e) => e.keyText).filter(Boolean);
    const uniqueKeys = Array.from(new Set(keys));
    if (uniqueKeys.length > 0) {
      const allKeysSet = new Set(uniqueKeys);
      const keyCards = splitCorrectIntoCards(uniqueKeys);
      for (const card of keyCards) {
        const optionPool = buildKeyGroupOptionPool(
          card,
          allKeysSet,
          code,
          annotation.startIndex,
          annotation.endIndex
        );
        addMultiQuestion(questions, {
          kind: "annotation.keys",
          stem: `Which keys are present in ${label}?`,
          answers: card,
          node: annotation,
          generatorRule: "annotation.keys",
          root,
          code,
          optionPool,
        });
      }
    }

    for (const entry of entries) {
      const valueText = textForNode(entry.valueNode, code).trim();
      if (!valueText) continue;
      addSingleQuestion(questions, {
        kind: "annotation.value",
        stem: `What is the value for ${entry.keyText} in ${label}?`,
        answer: valueText,
        node: entry.valueNode,
        generatorRule: "annotation.value",
        root,
        code,
      });
    }
  }
};

type ImportInfo = {
  display: string;
  isStatic: boolean;
};

const parseImportDeclaration = (
  node: TreeSitterAstNode,
  code: string
): ImportInfo => {
  const nameNode =
    firstChildOfType(node, "scoped_identifier") ||
    firstChildOfType(node, "identifier");
  const wildcard = childrenOfType(node, "asterisk").length > 0;
  const text = textForNode(node, code);
  const isStatic = /\bstatic\b/.test(text);
  const nameText = nameNode ? textForNode(nameNode, code).trim() : text;
  const base = wildcard && nameText ? `${nameText}.*` : nameText;
  const display = isStatic ? `static ${base}` : base;
  return { display, isStatic };
};

const generateImportGroupQuestions = (
  root: TreeSitterAstNode,
  run: TreeSitterAstNode[],
  code: string,
  deep: boolean
): QuizQuestion[] => {
  const infos = run.map((n) => parseImportDeclaration(n, code));
  const all = infos.map((i) => i.display).filter(Boolean);
  const staticImports = infos
    .filter((i) => i.isStatic)
    .map((i) => i.display)
    .filter(Boolean);

  const questions: QuizQuestion[] = [];
  addMultiQuestion(questions, {
    kind: "import_group",
    stem: "Which imports are used here? (use qualified names; keep wildcard imports)",
    answers: all,
    generatorRule: "imports.group",
    optionPool: COMMON_IMPORT_DISTRACTORS,
    root,
    code,
    node: run[0],
  });

  if (deep && staticImports.length) {
    addMultiQuestion(questions, {
      kind: "import_group_static",
      stem: "Which of these are static imports?",
      answers: staticImports,
      generatorRule: "imports.static",
      optionPool: COMMON_IMPORT_DISTRACTORS,
      root,
      code,
      node: run[0],
    });
  }

  return questions;
};

const generateQuestionsForAnchor = (
  root: TreeSitterAstNode,
  anchor: TreeSitterAstNode,
  code: string,
  profile: "shallow" | "deep"
): QuizQuestion[] => {
  const questions: QuizQuestion[] = [];
  const isDeep = profile === "deep";

  if (HEADER_NODE_TYPES.has(anchor.type)) {
    addHeaderQuestion(questions, anchor, root, code);
  }

  switch (anchor.type) {
    case "package_declaration": {
      const nameNode = firstChildOfType(anchor, "scoped_identifier") || firstChildOfType(anchor, "identifier");
      const name = nameNode ? textForNode(nameNode, code).trim() : "";
      addSingleQuestion(questions, {
        kind: "package_name",
        stem: "What package is declared?",
        answer: name,
        node: nameNode,
        generatorRule: "package.name",
        revealSpan: getSectionSpan(anchor, "name"),
        root,
        code,
      });
      break;
    }

    case "class_declaration":
    case "interface_declaration":
    case "enum_declaration":
    case "record_declaration":
    case "annotation_type_declaration": {
      const nameNode = childByField(anchor, "name") || firstChildOfType(anchor, "identifier");
      const name = nameNode ? textForNode(nameNode, code).trim() : "";
      addSingleQuestion(questions, {
        kind: "type_name",
        stem: "What is the type name?",
        answer: name,
        node: nameNode,
        generatorRule: "type.name",
        revealSpan: getSectionSpan(anchor, "name"),
        root,
        code,
      });

      const typeParams = childByField(anchor, "type_parameters");
      const typeParamNames = extractTypeParamNames(typeParams, code);
      addMultiQuestion(questions, {
        kind: "type_params",
        stem: "Which type parameters are declared?",
        answers: typeParamNames,
        node: typeParams,
        generatorRule: "type_params.list",
        revealSpan: getSectionSpan(anchor, "type_params"),
        root,
        code,
        optionPool: GENERIC_DISTRACTORS,
      });

      const extendsNode =
        anchor.type === "interface_declaration"
          ? firstChildOfType(anchor, "extends_interfaces")
          : childByField(anchor, "superclass") ||
            firstChildOfType(anchor, "superclass");
      const extendsTypes = extractTypeTextsFromContainer(extendsNode, code);
      if (anchor.type === "class_declaration") {
        addSingleQuestion(questions, {
          kind: "extends",
          stem: "What class is extended?",
          answer: extendsTypes[0] || "",
          node: extendsNode,
          generatorRule: "extends.single",
          revealSpan: getSectionSpan(anchor, "extends"),
          root,
          code,
        });
      } else {
        addMultiQuestion(questions, {
          kind: "extends",
          stem: "Which interfaces are extended?",
          answers: extendsTypes,
          node: extendsNode,
          generatorRule: "extends.multi",
          revealSpan: getSectionSpan(anchor, "extends"),
          root,
          code,
          optionPool: GENERIC_DISTRACTORS,
        });
      }

      if (anchor.type !== "interface_declaration") {
        const interfacesNode =
          childByField(anchor, "interfaces") ||
          firstChildOfType(anchor, "super_interfaces");
        const implementsTypes = extractTypeTextsFromContainer(interfacesNode, code);
        addMultiQuestion(questions, {
          kind: "implements",
          stem: "Which interfaces are implemented?",
          answers: implementsTypes,
          node: interfacesNode,
          generatorRule: "implements.list",
          revealSpan: getSectionSpan(anchor, "implements"),
          root,
          code,
          optionPool: GENERIC_DISTRACTORS,
        });
      }

      const annotations = extractAnnotations(anchor, code);
      addMultiQuestion(questions, {
        kind: "annotations",
        stem: "Which annotations are applied?",
        answers: annotations,
        node: firstChildOfType(anchor, "modifiers"),
        generatorRule: "annotations.list",
        root,
        code,
        optionPool: annotations.length ? annotations : GENERIC_DISTRACTORS,
      });
      addAnnotationValueQuestions(questions, anchor, root, code);

      if (anchor.type === "enum_declaration") {
        const enumBody = childByField(anchor, "body") || firstChildOfType(anchor, "enum_body");
        const constants = enumBody ? childrenOfType(enumBody, "enum_constant") : [];
        const constantNames = constants
          .map((c) => childByField(c, "name"))
          .filter(Boolean) as TreeSitterAstNode[];
        addMultiQuestion(questions, {
          kind: "enum_constants",
          stem: "Which enum constants are declared?",
          answers: textForNodes(constantNames, code),
          node: enumBody,
          generatorRule: "enum.constants",
          root,
          code,
          optionPool: GENERIC_DISTRACTORS,
        });
      }

      if (anchor.type === "record_declaration") {
        const paramsNode = childByField(anchor, "parameters");
        const params = getParameterNodes(paramsNode);
        const names = params
          .map((p) => parameterName(p, code))
          .filter((p): p is string => Boolean(p));
        addMultiQuestion(questions, {
          kind: "record_components",
          stem: "Which components does this record declare?",
          answers: names,
          node: paramsNode,
          generatorRule: "record.components",
          root,
          code,
          optionPool: GENERIC_DISTRACTORS,
        });
      }

      if (isDeep) {
        const modifiers = extractModifiersFromHeader(anchor, code);
        addMultiQuestion(questions, {
          kind: "modifiers",
          stem: "Which modifiers are present?",
          answers: modifiers,
          node: anchor,
          generatorRule: "modifiers.list",
          root,
          code,
          optionPool: MODIFIER_KEYWORDS,
        });
      }
      break;
    }

    case "method_declaration": {
      const nameNode = childByField(anchor, "name");
      const name = nameNode ? textForNode(nameNode, code).trim() : "";
      addSingleQuestion(questions, {
        kind: "method_name",
        stem: "What is the method name?",
        answer: name,
        node: nameNode,
        generatorRule: "method.name",
        revealSpan: getSectionSpan(anchor, "name"),
        root,
        code,
      });

      const paramsNode = childByField(anchor, "parameters");
      const params = getParameterNodes(paramsNode);
      const paramNames = params
        .map((p) => parameterName(p, code))
        .filter((p): p is string => Boolean(p));
      addMultiQuestion(questions, {
        kind: "method_params",
        stem: "Which parameters does this method take?",
        answers: paramNames,
        node: paramsNode,
        generatorRule: "method.params",
        revealSpan: getSectionSpan(anchor, "params"),
        root,
        code,
        optionPool: GENERIC_DISTRACTORS,
      });

      const returnTypeNode = childByField(anchor, "type");
      const returnType = returnTypeNode
        ? textForNode(returnTypeNode, code).trim()
        : "";
      addSingleQuestion(questions, {
        kind: "return_type",
        stem: "What is the return type?",
        answer: returnType,
        node: returnTypeNode,
        generatorRule: "method.return_type",
        revealSpan: getSectionSpan(anchor, "return_type"),
        root,
        code,
      });

      const throwsTypes = extractThrows(anchor, code);
      addMultiQuestion(questions, {
        kind: "throws",
        stem: "Which exceptions can be thrown?",
        answers: throwsTypes,
        node: firstChildOfType(anchor, "throws"),
        generatorRule: "method.throws",
        root,
        code,
        optionPool: GENERIC_DISTRACTORS,
      });

      const annotations = extractAnnotations(anchor, code);
      addMultiQuestion(questions, {
        kind: "annotations",
        stem: "Which annotations are applied?",
        answers: annotations,
        node: firstChildOfType(anchor, "modifiers"),
        generatorRule: "method.annotations",
        root,
        code,
        optionPool: annotations.length ? annotations : GENERIC_DISTRACTORS,
      });
      addAnnotationValueQuestions(questions, anchor, root, code);

      if (isDeep) {
        const typeParams = childByField(anchor, "type_parameters");
        const typeParamNames = extractTypeParamNames(typeParams, code);
        addMultiQuestion(questions, {
          kind: "method_type_params",
          stem: "Which type parameters are declared on this method?",
          answers: typeParamNames,
          node: typeParams,
          generatorRule: "method.type_params",
          root,
          code,
          optionPool: GENERIC_DISTRACTORS,
        });

        const modifiers = extractModifiersFromHeader(anchor, code);
        addMultiQuestion(questions, {
          kind: "modifiers",
          stem: "Which modifiers are present?",
          answers: modifiers,
          node: anchor,
          generatorRule: "method.modifiers",
          root,
          code,
          optionPool: MODIFIER_KEYWORDS,
        });

        const vararg = params.some((p) => isVarArgParam(p, code));
        addSingleQuestion(questions, {
          kind: "varargs",
          stem: "Is this method variadic (varargs)?",
          answer: vararg ? "Yes" : "No",
          node: paramsNode,
          generatorRule: "method.varargs",
          root,
          code,
        });

        params.forEach((param) => {
          const nameText = parameterName(param, code);
          const typeNode = parameterTypeNode(param);
          const typeText = typeNode ? textForNode(typeNode, code).trim() : "";
          if (!nameText || !typeText) return;
          addSingleQuestion(questions, {
            kind: "param_type",
            stem: `What is the type of parameter ${nameText}?`,
            answer: typeText,
            node: typeNode,
            generatorRule: "method.param_type",
            root,
            code,
          });
        });
      }
      break;
    }

    case "constructor_declaration":
    case "compact_constructor_declaration": {
      const nameNode = childByField(anchor, "name") || firstChildOfType(anchor, "identifier");
      const name = nameNode ? textForNode(nameNode, code).trim() : "";
      addSingleQuestion(questions, {
        kind: "constructor_name",
        stem: "What class is constructed?",
        answer: name,
        node: nameNode,
        generatorRule: "constructor.name",
        revealSpan: getSectionSpan(anchor, "name"),
        root,
        code,
      });

      const paramsNode = childByField(anchor, "parameters");
      const params = getParameterNodes(paramsNode);
      const paramNames = params
        .map((p) => parameterName(p, code))
        .filter((p): p is string => Boolean(p));
      addMultiQuestion(questions, {
        kind: "constructor_params",
        stem: "Which parameters does this constructor take?",
        answers: paramNames,
        node: paramsNode,
        generatorRule: "constructor.params",
        revealSpan: getSectionSpan(anchor, "params"),
        root,
        code,
        optionPool: GENERIC_DISTRACTORS,
      });

      const throwsTypes = extractThrows(anchor, code);
      addMultiQuestion(questions, {
        kind: "throws",
        stem: "Which exceptions can be thrown?",
        answers: throwsTypes,
        node: firstChildOfType(anchor, "throws"),
        generatorRule: "constructor.throws",
        root,
        code,
        optionPool: GENERIC_DISTRACTORS,
      });
      addAnnotationValueQuestions(questions, anchor, root, code);
      break;
    }

    case "field_declaration":
    case "local_variable_declaration": {
      const names = extractVariables(anchor, code);
      addMultiQuestion(questions, {
        kind: "vars_declared",
        stem: "Which variables are declared here?",
        answers: names,
        node: anchor,
        generatorRule: "vars.declared",
        root,
        code,
        optionPool: GENERIC_DISTRACTORS,
      });
      addAnnotationValueQuestions(questions, anchor, root, code);

      const typeNode = childByField(anchor, "type");
      const typeText = typeNode ? textForNode(typeNode, code).trim() : "";
      addSingleQuestion(questions, {
        kind: "var_type",
        stem: "What is the declared type?",
        answer: typeText || "var",
        node: typeNode ?? anchor,
        generatorRule: "vars.type",
        revealSpan: getSectionSpan(anchor, "type"),
        root,
        code,
      });

      if (isDeep) {
        const initializers = extractVariableInitializers(anchor, code);
        initializers.forEach((init) => {
          addSingleQuestion(questions, {
            kind: "initializer",
            stem: `What initializes ${init.name}?`,
            answer: init.value,
            node: init.valueNode,
            generatorRule: "vars.init",
            root,
            code,
          });

          if (init.valueNode?.type === "lambda_expression") {
            const params = extractLambdaParams(init.valueNode, code);
            addMultiQuestion(questions, {
              kind: "lambda_params",
              stem: "Which parameters does this lambda take?",
              answers: params,
              node: init.valueNode,
              generatorRule: "lambda.params",
              root,
              code,
              optionPool: GENERIC_DISTRACTORS,
            });
            const body = extractLambdaBody(init.valueNode, code);
            if (body) {
              addSingleQuestion(questions, {
                kind: "lambda_body",
                stem: "What is the lambda body?",
                answer: body,
                node: init.valueNode,
                generatorRule: "lambda.body",
                root,
                code,
              });
            }
          }
        });
      }
      break;
    }

    case "if_statement": {
      if (isDeep) {
        const condition = childByField(anchor, "condition");
        const conditionText = condition ? textForNode(condition, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "if_condition",
          stem: "What is the condition?",
          answer: conditionText,
          node: condition,
          generatorRule: "if.condition",
          revealSpan: getSectionSpan(anchor, "condition"),
          root,
          code,
        });
      }
      break;
    }

    case "for_statement": {
      if (isDeep) {
        const init = childrenByField(anchor, "init");
        const initText = textForNodes(init, code).join(", ");
        addSingleQuestion(questions, {
          kind: "for_init",
          stem: "What is the initializer?",
          answer: initText,
          node: init[0],
          generatorRule: "for.init",
          revealSpan: getSectionSpan(anchor, "init"),
          root,
          code,
        });

        const condition = childByField(anchor, "condition");
        const conditionText = condition ? textForNode(condition, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "for_condition",
          stem: "What is the loop condition?",
          answer: conditionText,
          node: condition,
          generatorRule: "for.condition",
          revealSpan: getSectionSpan(anchor, "condition"),
          root,
          code,
        });

        const update = childrenByField(anchor, "update");
        const updateText = textForNodes(update, code).join(", ");
        addSingleQuestion(questions, {
          kind: "for_update",
          stem: "What is the update expression?",
          answer: updateText,
          node: update[0],
          generatorRule: "for.update",
          revealSpan: getSectionSpan(anchor, "update"),
          root,
          code,
        });
      }
      break;
    }

    case "enhanced_for_statement": {
      if (isDeep) {
        const nameNode = childByField(anchor, "name");
        const name = nameNode ? textForNode(nameNode, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "for_each_var",
          stem: "What is the loop variable name?",
          answer: name,
          node: nameNode,
          generatorRule: "for_each.var",
          root,
          code,
        });

        const iterable = childByField(anchor, "value");
        const iterableText = iterable ? textForNode(iterable, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "for_each_iterable",
          stem: "What is being iterated?",
          answer: iterableText,
          node: iterable,
          generatorRule: "for_each.iterable",
          root,
          code,
        });
      }
      break;
    }

    case "while_statement":
    case "do_statement": {
      if (isDeep) {
        const condition = childByField(anchor, "condition");
        const conditionText = condition ? textForNode(condition, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "loop_condition",
          stem: "What is the condition?",
          answer: conditionText,
          node: condition,
          generatorRule: "loop.condition",
          revealSpan: getSectionSpan(anchor, "condition"),
          root,
          code,
        });
      }
      break;
    }

    case "switch_expression": {
      if (isDeep) {
        const value = childByField(anchor, "condition");
        const valueText = value ? textForNode(value, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "switch_value",
          stem: "What value is being switched on?",
          answer: valueText,
          node: value,
          generatorRule: "switch.value",
          revealSpan: getSectionSpan(anchor, "value"),
          root,
          code,
        });

        const body = childByField(anchor, "body");
        const cases =
          body?.namedChildren?.filter(
            (c) =>
              c.type === "switch_block_statement_group" || c.type === "switch_rule"
          ) || [];
        cases.forEach((caseNode) => {
          const labels = childrenOfType(caseNode, "switch_label");
          const labelTexts = labels
            .map((l) => textForNode(l, code).trim())
            .filter((t) => t.length > 0);
          addMultiQuestion(questions, {
            kind: "switch_case_labels",
            stem: "Which labels are matched by this case?",
            answers: labelTexts.length ? labelTexts : ["default"],
            node: caseNode,
            generatorRule: "switch.case_labels",
            root,
            code,
            optionPool: GENERIC_DISTRACTORS,
          });
        });
      }
      break;
    }

    case "try_statement":
    case "try_with_resources_statement": {
      if (isDeep) {
        const resources = childByField(anchor, "resources");
        if (resources) {
          const resourceItems = resources.namedChildren || [];
          addMultiQuestion(questions, {
            kind: "try_resources",
            stem: "Which resources are declared?",
            answers: textForNodes(resourceItems, code),
            node: resources,
            generatorRule: "try.resources",
            root,
            code,
            optionPool: GENERIC_DISTRACTORS,
          });
        }

        const catches = childrenOfType(anchor, "catch_clause");
        catches.forEach((c) => {
          const param = firstChildOfType(c, "catch_formal_parameter");
          const typeNode = param ? firstChildOfType(param, "catch_type") : undefined;
          const typeTexts = typeNode ? textForNodes(typeNode.namedChildren || [], code) : [];
          addMultiQuestion(questions, {
            kind: "catch_types",
            stem: "What exception type(s) are caught?",
            answers: typeTexts,
            node: typeNode,
            generatorRule: "catch.types",
            root,
            code,
            optionPool: GENERIC_DISTRACTORS,
          });

          const nameNode = param ? childByField(param, "name") : undefined;
          const nameText = nameNode ? textForNode(nameNode, code).trim() : "";
          addSingleQuestion(questions, {
            kind: "catch_name",
            stem: "What is the exception binding name?",
            answer: nameText,
            node: nameNode,
            generatorRule: "catch.name",
            root,
            code,
          });
        });
      }
      break;
    }

    case "synchronized_statement": {
      if (isDeep) {
        const monitor = firstChildOfType(anchor, "parenthesized_expression");
        const monitorText = monitor ? textForNode(monitor, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "synchronized_monitor",
          stem: "What expression is synchronized on?",
          answer: monitorText,
          node: monitor,
          generatorRule: "synchronized.monitor",
          root,
          code,
        });
      }
      break;
    }

    case "return_statement":
    case "throw_statement": {
      const value = firstNamedChild(anchor);
      const valueText = value ? textForNode(value, code).trim() : "";
      if (valueText) {
        addSingleQuestion(questions, {
          kind: anchor.type === "return_statement" ? "return_value" : "throw_value",
          stem:
            anchor.type === "return_statement"
              ? "What value is returned?"
              : "What value is thrown?",
          answer: valueText,
          node: value,
          generatorRule: "return_or_throw.value",
          root,
          code,
        });
      }
      break;
    }

    case "break_statement":
    case "continue_statement": {
      const label = firstNamedChild(anchor);
      const labelText = label ? textForNode(label, code).trim() : "";
      if (labelText) {
        addSingleQuestion(questions, {
          kind: "flow_label",
          stem: "What label is targeted?",
          answer: labelText,
          node: label,
          generatorRule: "flow.label",
          root,
          code,
        });
      }
      break;
    }

    case "expression_statement": {
      const expr = firstNamedChild(anchor);
      if (!expr) break;
      if (expr.type === "assignment_expression") {
        const left = childByField(expr, "left");
        const right = childByField(expr, "right");
        const leftText = left ? textForNode(left, code).trim() : "";
        const rightText = right ? textForNode(right, code).trim() : "";
        addSingleQuestion(questions, {
          kind: "assignment_left",
          stem: "What is the left-hand side?",
          answer: leftText,
          node: left,
          generatorRule: "assignment.left",
          root,
          code,
        });
        addSingleQuestion(questions, {
          kind: "assignment_right",
          stem: "What is the right-hand side?",
          answer: rightText,
          node: right,
          generatorRule: "assignment.right",
          root,
          code,
        });
      } else if (expr.type === "method_invocation") {
        const name = extractMethodInvocationName(expr, code);
        addSingleQuestion(questions, {
          kind: "method_call",
          stem: "What method is called?",
          answer: name,
          node: expr,
          generatorRule: "method_invocation.name",
          root,
          code,
        });
        if (isDeep) {
          const args = extractArguments(expr);
          args.slice(0, 2).forEach((arg, idx) => {
            addSingleQuestion(questions, {
              kind: "call_arg",
              stem: `What is argument #${idx + 1}?`,
              answer: textForNode(arg, code).trim(),
              node: arg,
              generatorRule: "method_invocation.arg",
              root,
              code,
            });
          });
        }
      }
      break;
    }
  }

  return questions;
};

// ============================================================================
// Lesson helpers
// ============================================================================

const buildLessonDataForAnchor = (
  anchor: TreeSitterAstNode,
  hasChildStatements: boolean,
  hasQuestions: boolean
): EngineStep["lesson"] | undefined => {
  switch (anchor.type) {
    case "package_declaration":
      return {
        prompt: "This file declares a package.",
        semanticRole: "package_declaration",
        isDigable: false,
      };
    case "import_group":
      return {
        prompt: "This block imports dependencies.",
        semanticRole: "import_group",
        isDigable: hasChildStatements,
      };
    case "class_declaration":
      return {
        prompt: "We declare a class.",
        semanticRole: "class_declaration",
        isDigable: hasChildStatements,
      };
    case "interface_declaration":
      return {
        prompt: "We declare an interface.",
        semanticRole: "interface_declaration",
        isDigable: hasChildStatements,
      };
    case "enum_declaration":
      return {
        prompt: "We declare an enum.",
        semanticRole: "enum_declaration",
        isDigable: hasChildStatements,
      };
    case "record_declaration":
      return {
        prompt: "We declare a record.",
        semanticRole: "record_declaration",
        isDigable: hasChildStatements,
      };
    case "method_declaration":
      return {
        prompt: "We define a method.",
        semanticRole: "method_declaration",
        isDigable: hasChildStatements,
      };
    case "constructor_declaration":
    case "compact_constructor_declaration":
      return {
        prompt: "We define a constructor.",
        semanticRole: anchor.type,
        isDigable: hasChildStatements,
      };
    case "field_declaration":
      return {
        prompt: "We declare fields.",
        semanticRole: "field_declaration",
        isDigable: false,
      };
    case "local_variable_declaration":
      return {
        prompt: "We declare local variables.",
        semanticRole: "local_variable_declaration",
        isDigable: false,
      };
    case "if_statement":
      return {
        prompt: "An if statement controls branching.",
        semanticRole: "if_statement",
        isDigable: hasChildStatements,
      };
    case "for_statement":
    case "enhanced_for_statement":
      return {
        prompt: "A loop iterates over values.",
        semanticRole: anchor.type,
        isDigable: hasChildStatements,
      };
    case "while_statement":
    case "do_statement":
      return {
        prompt: "A loop repeats while a condition holds.",
        semanticRole: anchor.type,
        isDigable: hasChildStatements,
      };
    case "switch_expression":
      return {
        prompt: "A switch evaluates multiple cases.",
        semanticRole: "switch_expression",
        isDigable: hasChildStatements,
      };
    case "try_statement":
    case "try_with_resources_statement":
      return {
        prompt: "A try statement handles exceptions.",
        semanticRole: anchor.type,
        isDigable: hasChildStatements,
      };
    case "catch_clause":
      return {
        prompt: "A catch clause handles an exception.",
        semanticRole: "catch_clause",
        isDigable: hasChildStatements,
      };
    case "finally_clause":
      return {
        prompt: "A finally clause runs after try/catch.",
        semanticRole: "finally_clause",
        isDigable: hasChildStatements,
      };
    default: {
      const label = anchor.type.replace(/_/g, " ");
      if (hasQuestions) {
        return {
          prompt: `Analyze this ${label}.`,
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      }
      return {
        prompt: `Next, we have a ${label}.`,
        semanticRole: anchor.type,
        isDigable: hasChildStatements,
      };
    }
  }
};

// ============================================================================
// Traversal
// ============================================================================

const isAnchorNode = (node: TreeSitterAstNode) => ANCHOR_NODE_TYPES.has(node.type);

const containerTypes = new Set([
  "program",
  "block",
  "class_body",
  "interface_body",
  "enum_body",
  "annotation_type_body",
  "constructor_body",
]);

const isContainerNode = (node: TreeSitterAstNode) =>
  containerTypes.has(node.type);

const extractBodyContainers = (node: TreeSitterAstNode): TreeSitterAstNode[] => {
  const bodies: TreeSitterAstNode[] = [];
  const body = childByField(node, "body");
  if (body) bodies.push(body);

  switch (node.type) {
    case "class_declaration":
    case "interface_declaration":
    case "enum_declaration":
    case "record_declaration":
    case "annotation_type_declaration": {
      const bodyNode = childByField(node, "body");
      if (bodyNode) bodies.push(bodyNode);
      break;
    }
    case "constructor_declaration": {
      const ctorBody = childByField(node, "body");
      if (ctorBody) bodies.push(ctorBody);
      break;
    }
    case "compact_constructor_declaration": {
      const compactBody = childByField(node, "body");
      if (compactBody) bodies.push(compactBody);
      break;
    }
    case "if_statement": {
      const thenNode = childByField(node, "consequence");
      const elseNode = childByField(node, "alternative");
      if (thenNode) bodies.push(thenNode);
      if (elseNode) bodies.push(elseNode);
      break;
    }
    case "for_statement":
    case "enhanced_for_statement":
    case "while_statement":
    case "do_statement": {
      const loopBody = childByField(node, "body");
      if (loopBody) bodies.push(loopBody);
      break;
    }
    case "switch_expression": {
      const switchBody = childByField(node, "body");
      if (switchBody) bodies.push(switchBody);
      break;
    }
    case "try_statement":
    case "try_with_resources_statement": {
      const tryBody = childByField(node, "body");
      if (tryBody) bodies.push(tryBody);
      bodies.push(...childrenOfType(node, "catch_clause"));
      bodies.push(...childrenOfType(node, "finally_clause"));
      break;
    }
    case "catch_clause":
    case "finally_clause": {
      const block = firstChildOfType(node, "block");
      if (block) bodies.push(block);
      break;
    }
    case "synchronized_statement": {
      const syncBody = childByField(node, "body");
      if (syncBody) bodies.push(syncBody);
      break;
    }
  }

  return bodies;
};

const walkStatementNode = (
  stmt: TreeSitterAstNode,
  visitAnchor: (n: TreeSitterAstNode) => void,
  visitContainer: (n: TreeSitterAstNode) => void
) => {
  const unwrapped = unwrapStatement(stmt);
  if (!unwrapped) return;
  if (isContainerNode(unwrapped)) {
    visitContainer(unwrapped);
  } else if (isAnchorNode(unwrapped)) {
    visitAnchor(unwrapped);
  }
};

const hasAnchorDescendant = (node: TreeSitterAstNode): boolean => {
  let found = false;
  const visit = (n: TreeSitterAstNode) => {
    if (found) return;
    const unwrapped = unwrapStatement(n) ?? n;
    if (isAnchorNode(unwrapped)) {
      found = true;
      return;
    }
    if (isContainerNode(unwrapped)) {
      getStatementChildren(unwrapped).forEach(visit);
      return;
    }
    for (const child of unwrapped.namedChildren || []) {
      visit(child);
      if (found) return;
    }
  };
  visit(node);
  return found;
};

export const generateEngineSteps = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  code: string,
  options: EngineOptions
): EngineStep[] => {
  const steps: EngineStep[] = [];
  const isDeep = options.profile === "deep";

  const emitAnchorStep = (
    anchor: TreeSitterAstNode,
    hasChildStatements: boolean
  ) => {
    const questions =
      options.generateQuiz === false
        ? []
        : generateQuestionsForAnchor(root, anchor, code, options.profile);
    const lessonData = buildLessonDataForAnchor(
      anchor,
      hasChildStatements,
      questions.length > 0
    );
    if (lessonData || questions.length > 0) {
      steps.push({
        id: randomString(8),
        node: anchor,
        displaySpan: displaySpanForNode(anchor),
        lesson: lessonData,
        quiz: questions.length > 0 ? { questions } : undefined,
      });
    }
  };

  const emitImportRunStep = (run: TreeSitterAstNode[]) => {
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
      options.generateQuiz === false
        ? []
        : generateImportGroupQuestions(root, run, code, isDeep);

    const childSteps: EngineStep[] = run.map((importNode) => ({
      id: randomString(8),
      node: importNode,
      displaySpan: { start: importNode.startIndex, end: importNode.endIndex },
      lesson: {
        semanticRole: importNode.type,
        prompt: "Import declaration.",
        isDigable: false,
      },
    }));

    steps.push({
      id: randomString(8),
      node: virtualNode,
      displaySpan: span,
      lesson: {
        semanticRole: "import_group",
        prompt: "This block imports dependencies.",
        isDigable: childSteps.length > 0,
        childSteps,
      },
      quiz: questions.length > 0 ? { questions } : undefined,
    });
  };

  const walkContainer = (container: TreeSitterAstNode) => {
    const children = getStatementChildren(container);
    let i = 0;
    while (i < children.length) {
      const stmt = children[i];
      if (stmt.type === "import_declaration") {
        const run: TreeSitterAstNode[] = [];
        let j = i;
        while (j < children.length && children[j].type === "import_declaration") {
          run.push(children[j]);
          j += 1;
        }
        emitImportRunStep(run);
        i = j;
        continue;
      }
      if (isAnchorNode(stmt)) {
        walkAnchor(stmt);
      } else if (isContainerNode(stmt)) {
        walkContainer(stmt);
      }
      i += 1;
    }
  };

  const walkSwitchBlock = (switchBlock: TreeSitterAstNode) => {
    const groups = (switchBlock.namedChildren || []).filter(
      (c) =>
        c.type === "switch_block_statement_group" || c.type === "switch_rule"
    );
    groups.forEach((group) => {
      const bodyNodes =
        group.type === "switch_rule"
          ? (group.namedChildren || []).filter(
              (c) =>
                c.type === "block" ||
                c.type === "expression_statement" ||
                c.type === "throw_statement"
            )
          : (group.namedChildren || []).filter((c) => c.type === "statement");
      bodyNodes.forEach((n) => walkStatementNode(n, walkAnchor, walkContainer));
    });
  };

  const walkAnchor = (anchor: TreeSitterAstNode) => {
    if (!isAnchorNode(anchor)) return;
    const childContainers = extractBodyContainers(anchor);
    const hasChildStatements = childContainers.some((c) => hasAnchorDescendant(c));
    emitAnchorStep(anchor, hasChildStatements);

    switch (anchor.type) {
      case "class_declaration":
      case "interface_declaration":
      case "enum_declaration":
      case "record_declaration":
      case "annotation_type_declaration": {
        const body = childByField(anchor, "body");
        if (body) walkContainer(body);
        break;
      }
      case "method_declaration": {
        const body = childByField(anchor, "body");
        if (body) walkContainer(body);
        break;
      }
      case "constructor_declaration":
      case "compact_constructor_declaration": {
        const body = childByField(anchor, "body");
        if (body) walkContainer(body);
        break;
      }
      case "static_initializer": {
        const body = firstChildOfType(anchor, "block");
        if (body) walkContainer(body);
        break;
      }
      case "if_statement": {
        const thenNode = childByField(anchor, "consequence");
        const elseNode = childByField(anchor, "alternative");
        if (thenNode) walkStatementNode(thenNode, walkAnchor, walkContainer);
        if (elseNode) walkStatementNode(elseNode, walkAnchor, walkContainer);
        break;
      }
      case "for_statement":
      case "enhanced_for_statement":
      case "while_statement":
      case "do_statement": {
        const body = childByField(anchor, "body");
        if (body) walkStatementNode(body, walkAnchor, walkContainer);
        break;
      }
      case "switch_expression": {
        const body = childByField(anchor, "body");
        if (body) walkSwitchBlock(body);
        break;
      }
      case "try_statement":
      case "try_with_resources_statement": {
        const body = childByField(anchor, "body");
        if (body) walkContainer(body);
        childrenOfType(anchor, "catch_clause").forEach((c) => walkAnchor(c));
        childrenOfType(anchor, "finally_clause").forEach((f) => walkAnchor(f));
        break;
      }
      case "catch_clause":
      case "finally_clause": {
        const block = firstChildOfType(anchor, "block");
        if (block) walkContainer(block);
        break;
      }
      case "synchronized_statement": {
        const body = childByField(anchor, "body");
        if (body) walkContainer(body);
        break;
      }
      default:
        break;
    }
  };

  if (isContainerNode(node) || node.type === "program") {
    walkContainer(node);
  } else if (isAnchorNode(node)) {
    walkAnchor(node);
  } else {
    walkContainer(node);
  }

  return steps;
};

// ============================================================================
// Masking & Payload Helpers
// ============================================================================

export type MaskRange = { start: number; end: number };

export function maskAndAnswerForStep(
  step: EngineStep,
  _root: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  if ((step.node as any).isVirtual || step.node.type === "import_group") {
    return { masks: [], answerText: textForNode(step.node, code) };
  }
  if (HEADER_NODE_TYPES.has(step.node.type)) {
    const { headerEnd } = getRevealAnchors(step.node);
    const answerText = headerAnswer(step.node, code);
    const masks =
      headerEnd > step.node.startIndex
        ? [{ start: step.node.startIndex, end: headerEnd }]
        : [];
    return { masks, answerText };
  }
  return { masks: [], answerText: textForNode(step.node, code) };
}

export type LessonHistoryItem = EngineStep & { action?: "next" | "dig" };

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
    const preview = textForRange(best.start, best.end, code)?.slice(0, 120);
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
    const fallbackSource = bestSourceRef(q);
    const revealSpan = revealSpanForCard(q, fallbackSource);
    return {
      order,
      type: q.kind || step.node.type,
      text: q.answerLabel || textForNode(step.node, code),
      action,
      question: q.stem,
      semanticRole: step.lesson?.semanticRole,
      generatorRule: q.generatorRule,
      difficulty: q.difficulty,
      questionType: isMulti ? "multi" : "single",
      multiCorrect: isMulti ? q.multiCorrect : undefined,
      multiSelectHint: q.multiSelectHint,
      optionPool: q.optionPool ?? q.options,
      sourceRef: fallbackSource,
      revealStart: revealSpan?.start ?? span.start,
      revealEndBeforeChild: revealSpan?.start ?? span.start,
      revealEndAfterChild: revealSpan?.end ?? span.end,
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
