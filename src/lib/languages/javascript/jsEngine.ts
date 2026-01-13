import type { TreeSitterAstNode } from "../../treeSitter";
import {
  childByField,
  childrenByField,
  collectDescendants,
  firstChildOfType,
  firstChildOfTypes,
  getSectionItems,
  getSectionFirstItem,
  getRevealAnchors,
  collectBindingNames,
  isDocstringNode,
} from "./jsCuration";
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
  /** For grouped imports: request more distractors from LLM (default 10) */
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

export const textForNode = (node: TreeSitterAstNode, code: string): string => {
  return code.substring(node.startIndex, node.endIndex);
};

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

const stripQuotes = (raw: string): string => {
  const trimmed = raw.trim();
  const m = trimmed.match(/^("|'|`)([\s\S]*)\1$/);
  return m ? m[2] : trimmed;
};

const headerSpanByAst = (node: TreeSitterAstNode) => {
  const { headerEnd } = getRevealAnchors(node);
  return { start: node.startIndex, end: headerEnd };
};

const headerAnswer = (node: TreeSitterAstNode, code?: string): string => {
  if (!code) return node.type;
  const span = headerSpanByAst(node);
  const raw = code.substring(span.start, span.end);
  return raw.replace(/\{\s*$/, "").trimEnd();
};

const displaySpanForNode = (node: TreeSitterAstNode) => {
  const span = headerSpanByAst(node);
  if (span.end <= span.start) {
    return { start: node.startIndex, end: node.endIndex };
  }
  return span;
};

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

const MODULE_DISTRACTORS = [
  "react",
  "next",
  "lodash",
  "lodash-es",
  "fs",
  "path",
  "zod",
  "axios",
  "express",
  "clsx",
  "uuid",
  "date-fns",
  "rxjs",
  "chalk",
  "dotenv",
  "@types/node",
];

const IDENTIFIER_DISTRACTORS = [
  "props",
  "state",
  "data",
  "result",
  "err",
  "item",
  "items",
  "count",
  "value",
  "config",
  "options",
  "response",
  "request",
  "params",
  "handler",
  "ctx",
];

const extractOperatorBetween = (
  code: string | undefined,
  leftEnd: number,
  rightStart: number
): string | undefined => {
  if (!code) return undefined;
  const raw = code.slice(leftEnd, rightStart).trim();
  return raw.replace(/\s+/g, " ");
};

const buildDistractors = (correct: string): string[] => {
  if (!correct || !correct.trim()) {
    return shuffle(GENERIC_DISTRACTORS).slice(0, 3);
  }
  const out = new Set<string>();
  let attempts = 0;
  while (out.size < 3 && attempts < 6) {
    attempts += 1;
    const variation =
      correct.length <= 3
        ? correct.toUpperCase() !== correct
          ? correct.toUpperCase()
          : correct.toLowerCase()
        : correct.replace(/[a-zA-Z]/, (c) =>
            c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()
          );
    if (variation !== correct) out.add(variation);
    if (out.size < 3) out.add(correct + "_");
    if (out.size < 3)
      out.add(correct.slice(0, Math.max(1, Math.floor(correct.length * 0.8))));
  }
  if (out.size < 3) {
    const pad = shuffle(GENERIC_DISTRACTORS)
      .filter((d) => d !== correct && !out.has(d))
      .slice(0, 3 - out.size);
    pad.forEach((d) => out.add(d));
  }
  return Array.from(out);
};

const buildMultiSelectOptionPool = (
  correct: string[],
  code: string | undefined,
  spanStart: number,
  spanEnd: number
): string[] => {
  const idPool: string[] = [];
  const strPool: string[] = [];
  try {
    const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
    const reStr = /(["'`])((?:\\.|(?!\1).)*)\1/g;
    const snippet = (code || "").slice(spanStart, spanEnd);
    let m: RegExpExecArray | null;
    while ((m = reId.exec(snippet))) idPool.push(m[0]);
    while ((m = reStr.exec(snippet))) if (m[2].trim()) strPool.push(m[2]);
  } catch {}

  let pool = Array.from(new Set<string>([...correct, ...idPool, ...strPool]));
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

const buildKeyGroupOptionPool = (
  correct: string[],
  allKeys: Set<string>,
  code: string | undefined,
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

const buildImportOptionPool = (
  correct: string[],
  code: string | undefined,
  span: { start: number; end: number }
): string[] => {
  const pool = new Set<string>();
  try {
    const snippetStart = Math.max(0, span.start - 500);
    const snippetEnd = span.end + 500;
    const snippet = (code || "").slice(snippetStart, snippetEnd);
    const reStr = /(["'`])((?:\\.|(?!\1).)*)\1/g;
    let m: RegExpExecArray | null;
    while ((m = reStr.exec(snippet))) {
      const candidate = m[2];
      if (!candidate) continue;
      pool.add(candidate);
    }
  } catch {}

  const distractors = Array.from(pool).filter((d) => !correct.includes(d));
  if (distractors.length < 10 - correct.length) {
    const needed = 10 - correct.length - distractors.length;
    const pad = shuffle(MODULE_DISTRACTORS)
      .filter((d) => !correct.includes(d) && !distractors.includes(d))
      .slice(0, needed);
    distractors.push(...pad);
  }

  const shuffledDistractors = shuffle(distractors);
  const neededDistractors = Math.max(0, 10 - correct.length);
  return shuffle([
    ...correct,
    ...shuffledDistractors.slice(0, neededDistractors),
  ]).slice(0, 10);
};

const buildIdentifierOptionPool = (
  correct: string[],
  code: string | undefined,
  span: { start: number; end: number }
): string[] => {
  const base = buildMultiSelectOptionPool(correct, code, span.start, span.end);
  const padded = Array.from(new Set([...base, ...IDENTIFIER_DISTRACTORS]));
  return shuffle(padded).slice(0, 10);
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

const findObjectLiteralNodes = (node: TreeSitterAstNode): TreeSitterAstNode[] => {
  const out: TreeSitterAstNode[] = [];
  const stack: TreeSitterAstNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "object") {
      out.push(cur);
      continue;
    }
    (cur.namedChildren || []).forEach((c) => stack.push(c));
  }
  return out;
};

const prefixText = (node: TreeSitterAstNode, code?: string): string => {
  if (!code) return "";
  const end = Math.min(node.endIndex, node.startIndex + 200);
  return code.slice(node.startIndex, end);
};

const hasKeywordPrefix = (
  node: TreeSitterAstNode,
  code: string | undefined,
  keyword: string
) => {
  if (!code) return false;
  const prefix = prefixText(node, code);
  const re = new RegExp(`(^|\\s)${keyword}\\b`);
  return re.test(prefix);
};

const isAsyncNode = (node: TreeSitterAstNode, code?: string) =>
  hasKeywordPrefix(node, code, "async");

const isGeneratorNode = (node: TreeSitterAstNode, code?: string) => {
  if (node.type === "generator_function_declaration") return true;
  if (!code) return false;
  const prefix = prefixText(node, code);
  return /function\s*\*/.test(prefix) || /\*\s*[A-Za-z0-9_\[]/.test(prefix);
};

const detectMethodModifiers = (node: TreeSitterAstNode, code?: string) => {
  if (!code) return { isStatic: false, isAsync: false, isGetter: false, isSetter: false, isGenerator: false };
  const prefix = prefixText(node, code);
  return {
    isStatic: /\bstatic\b/.test(prefix),
    isAsync: /\basync\b/.test(prefix),
    isGetter: /\bget\b/.test(prefix),
    isSetter: /\bset\b/.test(prefix),
    isGenerator: /\*/.test(prefix),
  };
};

const isTypeOnlyImportExport = (
  node: TreeSitterAstNode,
  code: string | undefined,
  keyword: "import" | "export"
) => {
  if (!code) return false;
  const prefix = prefixText(node, code);
  const re = new RegExp(`^\\s*${keyword}\\s+type\\b`);
  return re.test(prefix);
};

const unwrapExpressionStatement = (node?: TreeSitterAstNode): TreeSitterAstNode | undefined => {
  if (!node) return undefined;
  if (node.type !== "expression_statement") return node;
  return (node.namedChildren || [])[0];
};

type ParamEntry = {
  raw: TreeSitterAstNode;
  pattern: TreeSitterAstNode;
};

const unwrapParamPattern = (param: TreeSitterAstNode): TreeSitterAstNode => {
  if (param.type === "required_parameter" || param.type === "optional_parameter") {
    return childByField(param, "pattern") || childByField(param, "name") || param;
  }
  return param;
};

const collectParamEntries = (paramsNode?: TreeSitterAstNode): ParamEntry[] => {
  if (!paramsNode) return [];
  const rawParams =
    paramsNode.type === "formal_parameters"
      ? paramsNode.namedChildren || []
      : [paramsNode];
  return rawParams.map((raw) => ({ raw, pattern: unwrapParamPattern(raw) }));
};

const paramLabel = (
  entry: ParamEntry,
  code: string | undefined
): string => {
  const patternText = textForRange(entry.pattern.startIndex, entry.pattern.endIndex, code) || entry.pattern.type;
  if (entry.pattern.type === "identifier") return patternText;
  const rawText = textForRange(entry.raw.startIndex, entry.raw.endIndex, code) || entry.raw.type;
  return rawText;
};

const collectTypeParamNames = (
  node: TreeSitterAstNode | undefined,
  code: string | undefined
): string[] => {
  if (!node) return [];
  const names: string[] = [];
  const stack = (node.namedChildren || []).slice();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type.endsWith("identifier")) {
      const text = textForRange(cur.startIndex, cur.endIndex, code) || cur.type;
      names.push(text);
      continue;
    }
    (cur.namedChildren || []).forEach((c) => stack.push(c));
  }
  return names;
};

// ============================================================================
// Import grouping
// ============================================================================

type ImportSpecAlias = { exported: string; local: string };

type ImportRunData = {
  modules: Set<string>;
  bindingsByModule: Map<string, Set<string>>;
  aliases: ImportSpecAlias[];
  span: { start: number; end: number };
};

const importStatementData = (
  stmt: TreeSitterAstNode,
  code: string | undefined
): { module?: string; bindings: string[]; aliases: ImportSpecAlias[] } => {
  const sourceNode = getSectionFirstItem(stmt, "source");
  const rawSource = sourceNode ? textForRange(sourceNode.startIndex, sourceNode.endIndex, code) || "" : "";
  const module = rawSource ? stripQuotes(rawSource) : undefined;
  const bindings: string[] = [];
  const aliases: ImportSpecAlias[] = [];

  const defaultNode = getSectionFirstItem(stmt, "default");
  if (defaultNode) bindings.push("default");

  const namespaceNode = getSectionFirstItem(stmt, "namespace");
  if (namespaceNode) bindings.push("*");

  const named = getSectionItems(stmt, "named");
  for (const spec of named) {
    const nameNode = getSectionFirstItem(spec, "name");
    const aliasNode = getSectionFirstItem(spec, "alias");
    const exported = nameNode
      ? textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
      : undefined;
    const local = aliasNode
      ? textForRange(aliasNode.startIndex, aliasNode.endIndex, code) || aliasNode.type
      : undefined;
    if (exported) bindings.push(exported);
    if (exported && local && local !== exported) {
      aliases.push({ exported, local });
    }
  }

  return { module, bindings, aliases };
};

const extractImportRunData = (
  run: TreeSitterAstNode[],
  code: string | undefined
): ImportRunData => {
  const modules = new Set<string>();
  const bindingsByModule = new Map<string, Set<string>>();
  const aliases: ImportSpecAlias[] = [];
  const first = run[0];
  const last = run[run.length - 1];
  const span = { start: first.startIndex, end: last.endIndex };

  for (const stmt of run) {
    const info = importStatementData(stmt, code);
    if (!info.module) continue;
    modules.add(info.module);
    if (info.bindings.length > 0) {
      const set = bindingsByModule.get(info.module) || new Set<string>();
      info.bindings.forEach((b) => set.add(b));
      bindingsByModule.set(info.module, set);
    }
    aliases.push(...info.aliases.map((a) => ({ ...a })));
  }

  return { modules, bindingsByModule, aliases, span };
};

function generateImportRunQuestions(
  root: TreeSitterAstNode,
  run: TreeSitterAstNode[],
  code: string | undefined,
  profile: DecompositionLevel
): QuizQuestion[] {
  if (!run.length) return [];
  const { modules, bindingsByModule, aliases, span } = extractImportRunData(run, code);
  if (modules.size === 0) return [];

  const baseSourceRef: SourceRef = {
    nodeType: "import_group",
    start: span.start,
    end: span.end,
    path: computeAstPath(root, run[0]),
    preview: (code || "").slice(span.start, Math.min(span.end, span.start + 120)),
  };

  const qs: QuizQuestion[] = [];
  const moduleNames = Array.from(modules);
  const moduleCards = splitCorrectIntoCards(moduleNames);
  for (const card of moduleCards) {
    const optionPool = buildImportOptionPool(card, code, span);
    qs.push({
      kind: "import_run.modules",
      stem: "Which modules are imported here? (use module specifiers, ignore local aliases)",
      answerLabel: "",
      options: optionPool,
      questionType: "multi",
      multiCorrect: card,
      multiSelectHint: card.length,
      sourceRefs: [baseSourceRef],
      generatorRule: "import_run.modules",
      revealEndBeforeChild: span.start,
      revealEndAfterChild: span.end,
      distractorPoolSize: 10,
    });
  }

  for (const [moduleName, bindings] of bindingsByModule.entries()) {
    const bindingList = Array.from(bindings);
    if (bindingList.length === 0) continue;
    const bindingCards = splitCorrectIntoCards(bindingList);
    for (const card of bindingCards) {
      const optionPool = buildIdentifierOptionPool(card, code, span);
      qs.push({
        kind: `import_run.bindings:${moduleName}`,
        stem: `What bindings are imported from '${moduleName}'? (use exported names; ignore local aliases)`,
        answerLabel: "",
        options: optionPool,
        questionType: "multi",
        multiCorrect: card,
        multiSelectHint: card.length,
        sourceRefs: [baseSourceRef],
        generatorRule: "import_run.bindings",
        revealEndBeforeChild: span.start,
        revealEndAfterChild: span.end,
      });
    }
  }

  if (profile === "deep") {
    for (const alias of aliases) {
      const opts = buildDistractors(alias.local);
      qs.push({
        kind: "import_run.alias",
        stem: `What is the local name for imported ${alias.exported}?`,
        answerLabel: alias.local,
        options: shuffle([alias.local, ...opts]),
        sourceRefs: [baseSourceRef],
        generatorRule: "import_run.alias",
      });
    }
  }

  return qs;
}

// ============================================================================
// Quiz Rules
// ============================================================================

type DecompositionLevel = "shallow" | "deep";

type RuleCtx = {
  root: TreeSitterAstNode;
  node: TreeSitterAstNode;
  code?: string;
  sourceRef: SourceRef;
  profile: DecompositionLevel;
};

type Q11 = QuizQuestion;

type Rule = (ctx: RuleCtx) => Q11[] | undefined;

const yesNoOptions = ["Yes", "No"];

const singleQuestion = (
  stem: string,
  answerLabel: string,
  sourceRefs: SourceRef[],
  generatorRule: string,
  opts: Partial<QuizQuestion> = {}
): QuizQuestion => ({
  kind: generatorRule,
  stem,
  answerLabel,
  options: buildDistractors(answerLabel),
  sourceRefs,
  generatorRule,
  ...opts,
});

const yesNoQuestion = (
  stem: string,
  isYes: boolean,
  sourceRefs: SourceRef[],
  generatorRule: string
): QuizQuestion => ({
  kind: generatorRule,
  stem,
  answerLabel: isYes ? "Yes" : "No",
  options: yesNoOptions,
  sourceRefs,
  generatorRule,
});

const multiQuestion = (
  stem: string,
  answers: string[],
  sourceRef: SourceRef,
  generatorRule: string,
  code: string | undefined,
  spanStart: number,
  spanEnd: number
): QuizQuestion => ({
  kind: generatorRule,
  stem,
  answerLabel: "",
  options: buildMultiSelectOptionPool(answers, code, spanStart, spanEnd),
  questionType: "multi",
  multiCorrect: answers,
  multiSelectHint: answers.length,
  sourceRefs: [sourceRef],
  generatorRule,
});

const headerRule: Rule = ({ node, code, sourceRef }) => {
  const answerText = headerAnswer(node, code);
  const span = headerSpanByAst(node);
  return [
    {
      kind: node.type,
      stem: "Write the full header line",
      answerLabel: answerText,
      options: [],
      sourceRefs: [sourceRef],
      generatorRule: "header.line",
      revealEndBeforeChild: span.start,
      revealEndAfterChild: span.end,
    },
  ];
};

const ruleExportStatement: Rule = ({ root, node, code, sourceRef, profile }) => {
  const questions: Q11[] = [];
  const declaration = getSectionFirstItem(node, "declaration");
  const value = getSectionFirstItem(node, "value");
  const sourceNode = getSectionFirstItem(node, "source");
  const namedSpecs = getSectionItems(node, "named");
  const namespaceExport = getSectionFirstItem(node, "namespace");

  const sourceText = sourceNode
    ? stripQuotes(textForRange(sourceNode.startIndex, sourceNode.endIndex, code) || "")
    : undefined;

  if (value) {
    const valueText = textForRange(value.startIndex, value.endIndex, code) || value.type;
    questions.push(
      singleQuestion(
        "What is exported as default?",
        valueText,
        [sourceRef],
        "export.default"
      )
    );
  }

  if (declaration) {
    const declText = headerAnswer(declaration, code);
    questions.push(
      singleQuestion(
        "What is exported as default?",
        declText,
        [sourceRef],
        "export.default.declaration"
      )
    );
    const extra = generateQuestionsV11(root, declaration, profile, code);
    questions.push(...extra);
  }

  if (namedSpecs.length > 0) {
    const exportedNames: string[] = [];
    const aliasPairs: ImportSpecAlias[] = [];
    for (const spec of namedSpecs) {
      const nameNode = getSectionFirstItem(spec, "name");
      const aliasNode = getSectionFirstItem(spec, "alias");
      const nameText = nameNode
        ? textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
        : undefined;
      const aliasText = aliasNode
        ? textForRange(aliasNode.startIndex, aliasNode.endIndex, code) || aliasNode.type
        : undefined;
      if (aliasText) exportedNames.push(aliasText);
      else if (nameText) exportedNames.push(nameText);
      if (aliasText && nameText) aliasPairs.push({ exported: aliasText, local: nameText });
    }

    if (exportedNames.length > 0) {
      questions.push(
        multiQuestion(
          "Which names are exported?",
          Array.from(new Set(exportedNames)),
          sourceRef,
          "export.names",
          code,
          node.startIndex,
          node.endIndex
        )
      );
    }

    if (profile === "deep") {
      for (const pair of aliasPairs) {
        questions.push(
          singleQuestion(
            `What local name maps to exported ${pair.exported}?`,
            pair.local,
            [sourceRef],
            "export.alias"
          )
        );
      }
    }
  }

  if (namespaceExport) {
    const nameNode = firstChildOfTypes(namespaceExport, ["identifier", "property_identifier"]);
    if (nameNode) {
      const nameText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
      questions.push(
        singleQuestion(
          "What is the exported namespace name?",
          nameText,
          [sourceRef],
          "export.namespace"
        )
      );
    }
  }

  if (sourceText) {
    questions.push(
      singleQuestion(
        "Which module is re-exported from?",
        sourceText,
        [sourceRef],
        "export.source"
      )
    );
  }

  return questions;
};

const ruleVariableDeclaration: Rule = ({ root, node, code, sourceRef, profile }) => {
  const declarators = getSectionItems(node, "declarators");
  if (declarators.length === 0) return [];

  const bindingNames = new Set<string>();
  for (const decl of declarators) {
    const nameNode = getSectionFirstItem(decl, "name");
    collectBindingNames(nameNode, code).forEach((n) => bindingNames.add(n));
  }

  const bindings = Array.from(bindingNames).filter(Boolean);
  const qs: Q11[] = [];
  if (bindings.length > 0) {
    qs.push(
      multiQuestion(
        "Which bindings are declared here?",
        bindings,
        sourceRef,
        "decl.bindings",
        code,
        node.startIndex,
        node.endIndex
      )
    );
  }

  for (const decl of declarators) {
    const nameNode = getSectionFirstItem(decl, "name");
    const valueNode = getSectionFirstItem(decl, "value");
    if (!valueNode || !nameNode) continue;
    if (profile === "deep") {
      const valueText = textForRange(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
      const bindingList = collectBindingNames(nameNode, code);
      const isSimple = nameNode.type === "identifier" && bindingList.length === 1;
      const stem = isSimple
        ? `What is the initializer for ${bindingList[0]}?`
        : "What value is being destructured to initialize these bindings?";
      qs.push(
        singleQuestion(
          stem,
          valueText,
          [sourceRef],
          "decl.initializer"
        )
      );

      if (valueNode.type === "arrow_function") {
        qs.push(...buildArrowFunctionQuestions(valueNode, code, sourceRef, profile));
      }
    }

    const objects = findObjectLiteralNodes(valueNode);
    for (const obj of objects) {
      qs.push(...generateQuestionsV11(root, obj, profile, code));
    }
  }

  return qs;
};

const ruleAssignmentExpression = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  code: string | undefined,
  sourceRef: SourceRef,
  profile: DecompositionLevel
): Q11[] => {
  const left = childByField(node, "left");
  const right = childByField(node, "right");
  if (!left || !right) return [];

  const bindings = collectBindingNames(left, code);
  const isPattern = left.type === "identifier" || left.type.endsWith("pattern");
  const qs: Q11[] = [];
  if (bindings.length > 0 && isPattern) {
    const stem = bindings.length > 1
      ? "Which bindings are assigned here?"
      : "What is the left-hand target?";
    qs.push(
      multiQuestion(
        stem,
        Array.from(new Set(bindings)),
        sourceRef,
        "assign.bindings",
        code,
        node.startIndex,
        node.endIndex
      )
    );
  } else {
    const leftText = textForRange(left.startIndex, left.endIndex, code) || left.type;
    qs.push(
      singleQuestion(
        "What is the left-hand target?",
        leftText,
        [sourceRef],
        "assign.left"
      )
    );
  }

  const rightText = textForRange(right.startIndex, right.endIndex, code) || right.type;
  qs.push(
    singleQuestion(
      "What is the right-hand value?",
      rightText,
      [sourceRef],
      "assign.value"
    )
  );

  if (profile === "deep" && right.type === "arrow_function") {
    qs.push(...buildArrowFunctionQuestions(right, code, sourceRef, profile));
  }

  const objects = findObjectLiteralNodes(right);
  for (const obj of objects) {
    qs.push(...generateQuestionsV11(root, obj, profile, code));
  }

  return qs;
};

const ruleAugmentedAssignment = (
  node: TreeSitterAstNode,
  code: string | undefined,
  sourceRef: SourceRef
): Q11[] => {
  const left = childByField(node, "left");
  const right = childByField(node, "right");
  if (!left || !right) return [];
  const op = extractOperatorBetween(code, left.endIndex, right.startIndex) || "";
  const leftText = textForRange(left.startIndex, left.endIndex, code) || left.type;
  const rightText = textForRange(right.startIndex, right.endIndex, code) || right.type;
  return [
    singleQuestion(
      "What is the operator?",
      op,
      [sourceRef],
      "assign.operator"
    ),
    singleQuestion(
      "What is the left-hand target?",
      leftText,
      [sourceRef],
      "assign.left"
    ),
    singleQuestion(
      "What is the right-hand value?",
      rightText,
      [sourceRef],
      "assign.right"
    ),
  ];
};

const ruleFunctionDeclaration: Rule = ({ node, code, sourceRef, profile }) => {
  const nameNode = getSectionFirstItem(node, "name");
  const paramsNode = getSectionFirstItem(node, "params");
  const entries = collectParamEntries(paramsNode);
  const nameText = nameNode
    ? textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
    : "";

  const qs: Q11[] = [];
  if (nameText) {
    qs.push(
      singleQuestion(
        "What is the function name?",
        nameText,
        [sourceRef],
        "function.name"
      )
    );
  }

  if (entries.length > 0) {
    const params = entries.map((e) => paramLabel(e, code));
    qs.push(
      multiQuestion(
        "Which are parameters of this function?",
        params,
        sourceRef,
        "function.params",
        code,
        node.startIndex,
        node.endIndex
      )
    );
  }

  qs.push(
    yesNoQuestion(
      "Is this function async?",
      isAsyncNode(node, code),
      [sourceRef],
      "function.async"
    )
  );

  qs.push(
    yesNoQuestion(
      "Is this a generator function?",
      isGeneratorNode(node, code),
      [sourceRef],
      "function.generator"
    )
  );

  const typeParams = getSectionFirstItem(node, "type_params");
  if (typeParams) {
    const names = collectTypeParamNames(typeParams, code);
    if (names.length > 0) {
      qs.push(
        multiQuestion(
          "Which type parameters are declared?",
          names,
          sourceRef,
          "function.type_params",
          code,
          typeParams.startIndex,
          typeParams.endIndex
        )
      );
    }
  }

  const returnType = getSectionFirstItem(node, "return_type");
  if (returnType) {
    const typeText = textForRange(returnType.startIndex, returnType.endIndex, code) || returnType.type;
    qs.push(
      singleQuestion(
        "What is the return type?",
        typeText,
        [sourceRef],
        "function.return_type"
      )
    );
  }

  if (profile === "deep") {
    let paramIndex = 0;
    for (const entry of entries) {
      const defaults = collectDescendants(entry.raw, (n) => n.type === "assignment_pattern");
      for (const def of defaults) {
        const left = childByField(def, "left");
        const right = childByField(def, "right");
        if (!left || !right) continue;
        const leftText = textForRange(left.startIndex, left.endIndex, code) || left.type;
        const rightText = textForRange(right.startIndex, right.endIndex, code) || right.type;
        qs.push(
          singleQuestion(
            `What is the default value of ${leftText}?`,
            rightText,
            [sourceRef],
            "function.param_default"
          )
        );
      }

      const rest = collectDescendants(entry.raw, (n) => n.type === "rest_pattern")[0];
      if (rest) {
        const restName = rest.namedChildren?.[0];
        if (restName) {
          const restText = textForRange(restName.startIndex, restName.endIndex, code) || restName.type;
          qs.push(
            singleQuestion(
              "What is the rest parameter name?",
              restText,
              [sourceRef],
              "function.rest"
            )
          );
        }
      }

      const bindingNames = collectBindingNames(entry.pattern, code);
      if (
        bindingNames.length > 0 &&
        (bindingNames.length > 1 || entry.pattern.type.endsWith("pattern"))
      ) {
        qs.push(
          multiQuestion(
            `Which bindings are introduced by parameter #${paramIndex + 1}?`,
            bindingNames,
            sourceRef,
            "function.param_bindings",
            code,
            entry.raw.startIndex,
            entry.raw.endIndex
          )
        );
      }
      paramIndex += 1;
    }
  }

  return qs;
};

const buildArrowFunctionQuestions = (
  node: TreeSitterAstNode,
  code: string | undefined,
  sourceRef: SourceRef,
  profile: DecompositionLevel
): Q11[] => {
  const paramsNode = getSectionFirstItem(node, "params");
  const entries = collectParamEntries(paramsNode);
  const qs: Q11[] = [];

  if (entries.length > 0) {
    const params = entries.map((e) => paramLabel(e, code));
    qs.push(
      multiQuestion(
        "Which are parameters of this arrow function?",
        params,
        sourceRef,
        "arrow.params",
        code,
        node.startIndex,
        node.endIndex
      )
    );
  }

  qs.push(
    yesNoQuestion(
      "Is this arrow function async?",
      isAsyncNode(node, code),
      [sourceRef],
      "arrow.async"
    )
  );

  const body = getSectionFirstItem(node, "body");
  if (body) {
    const isBlock = body.type === "statement_block";
    qs.push(
      yesNoQuestion(
        "Is the body a block?",
        isBlock,
        [sourceRef],
        "arrow.body_block"
      )
    );
  }

  if (profile === "deep") {
    let paramIndex = 0;
    for (const entry of entries) {
      const bindingNames = collectBindingNames(entry.pattern, code);
      if (
        bindingNames.length > 0 &&
        (bindingNames.length > 1 || entry.pattern.type.endsWith("pattern"))
      ) {
        qs.push(
          multiQuestion(
            `Which bindings are introduced by parameter #${paramIndex + 1}?`,
            bindingNames,
            sourceRef,
            "arrow.param_bindings",
            code,
            entry.raw.startIndex,
            entry.raw.endIndex
          )
        );
      }
      paramIndex += 1;
    }
  }

  return qs;
};

const ruleClassDeclaration: Rule = ({ node, code, sourceRef, profile }) => {
  const qs: Q11[] = [];
  const nameNode = getSectionFirstItem(node, "name");
  if (nameNode) {
    const nameText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
    qs.push(
      singleQuestion(
        "What is the class name?",
        nameText,
        [sourceRef],
        "class.name"
      )
    );
  }

  const heritage = getSectionFirstItem(node, "heritage") || firstChildOfType(node, "class_heritage");
  if (heritage) {
    const extendsClause = firstChildOfType(heritage, "extends_clause");
    const target = extendsClause
      ? childByField(extendsClause, "value") || extendsClause.namedChildren?.[0]
      : heritage.namedChildren?.find((c) => c.type !== "implements_clause");
    if (target) {
      const text = textForRange(target.startIndex, target.endIndex, code) || target.type;
      qs.push(
        singleQuestion(
          "What does this class extend?",
          text,
          [sourceRef],
          "class.extends"
        )
      );
    }

    const implementsClause = firstChildOfType(heritage, "implements_clause");
    if (implementsClause) {
      const impls = (implementsClause.namedChildren || [])
        .filter((c) => c.type.endsWith("identifier"))
        .map((c) => textForRange(c.startIndex, c.endIndex, code) || c.type);
      if (impls.length > 0) {
        qs.push(
          multiQuestion(
            "Which interfaces are implemented?",
            impls,
            sourceRef,
            "class.implements",
            code,
            implementsClause.startIndex,
            implementsClause.endIndex
          )
        );
      }
    }
  }

  const typeParams = getSectionFirstItem(node, "type_params");
  if (typeParams) {
    const names = collectTypeParamNames(typeParams, code);
    if (names.length > 0) {
      qs.push(
        multiQuestion(
          "Which type parameters are declared?",
          names,
          sourceRef,
          "class.type_params",
          code,
          typeParams.startIndex,
          typeParams.endIndex
        )
      );
    }
  }

  if (profile === "deep") {
    const decorators = getSectionItems(node, "decorators");
    if (decorators.length > 0) {
      qs.push(...decoratorQuestions(decorators, code, sourceRef));
    }
  }

  return qs;
};

const ruleMethodDefinition: Rule = ({ node, code, sourceRef, profile }) => {
  const qs: Q11[] = [];
  const nameNode = getSectionFirstItem(node, "name");
  if (nameNode) {
    const nameText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
    qs.push(
      singleQuestion(
        "What is the method name?",
        nameText,
        [sourceRef],
        "method.name"
      )
    );
  }

  const paramsNode = getSectionFirstItem(node, "params");
  const entries = collectParamEntries(paramsNode);
  if (entries.length > 0) {
    const params = entries.map((e) => paramLabel(e, code));
    qs.push(
      multiQuestion(
        "Which are parameters of this method?",
        params,
        sourceRef,
        "method.params",
        code,
        node.startIndex,
        node.endIndex
      )
    );
  }

  const mods = detectMethodModifiers(node, code);
  if (mods.isStatic) {
    qs.push(yesNoQuestion("Is this method static?", true, [sourceRef], "method.static"));
  }
  if (mods.isAsync) {
    qs.push(yesNoQuestion("Is this method async?", true, [sourceRef], "method.async"));
  }
  if (mods.isGetter || mods.isSetter) {
    qs.push(yesNoQuestion("Is this a getter/setter?", true, [sourceRef], "method.getset"));
  }
  if (mods.isGenerator) {
    qs.push(yesNoQuestion("Is this a generator method?", true, [sourceRef], "method.generator"));
  }

  const typeParams = getSectionFirstItem(node, "type_params");
  if (typeParams) {
    const names = collectTypeParamNames(typeParams, code);
    if (names.length > 0) {
      qs.push(
        multiQuestion(
          "Which type parameters are declared?",
          names,
          sourceRef,
          "method.type_params",
          code,
          typeParams.startIndex,
          typeParams.endIndex
        )
      );
    }
  }

  const returnType = getSectionFirstItem(node, "return_type");
  if (returnType) {
    const typeText = textForRange(returnType.startIndex, returnType.endIndex, code) || returnType.type;
    qs.push(
      singleQuestion(
        "What is the return type?",
        typeText,
        [sourceRef],
        "method.return_type"
      )
    );
  }

  if (profile === "deep") {
    let paramIndex = 0;
    for (const entry of entries) {
      const bindingNames = collectBindingNames(entry.pattern, code);
      if (
        bindingNames.length > 0 &&
        (bindingNames.length > 1 || entry.pattern.type.endsWith("pattern"))
      ) {
        qs.push(
          multiQuestion(
            `Which bindings are introduced by parameter #${paramIndex + 1}?`,
            bindingNames,
            sourceRef,
            "method.param_bindings",
            code,
            entry.raw.startIndex,
            entry.raw.endIndex
          )
        );
      }
      paramIndex += 1;
    }

    const decorators = getSectionItems(node, "decorators");
    if (decorators.length > 0) {
      qs.push(...decoratorQuestions(decorators, code, sourceRef));
    }
  }

  return qs;
};

const ruleFieldDefinition: Rule = ({ node, code, sourceRef, profile }) => {
  const qs: Q11[] = [];
  const nameNode = getSectionFirstItem(node, "name");
  if (nameNode) {
    const nameText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
    qs.push(
      singleQuestion(
        "What is the field name?",
        nameText,
        [sourceRef],
        "field.name"
      )
    );
  }

  const valueNode = getSectionFirstItem(node, "value");
  if (valueNode) {
    const valueText = textForRange(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
    qs.push(
      singleQuestion(
        "What is the initializer value?",
        valueText,
        [sourceRef],
        "field.value"
      )
    );
  }

  const typeAnn = getSectionFirstItem(node, "type");
  if (typeAnn) {
    const typeText = textForRange(typeAnn.startIndex, typeAnn.endIndex, code) || typeAnn.type;
    qs.push(
      singleQuestion(
        "What is the type annotation of this field?",
        typeText,
        [sourceRef],
        "field.type"
      )
    );
  }

  if (profile === "deep") {
    const decorators = getSectionItems(node, "decorators");
    if (decorators.length > 0) {
      qs.push(...decoratorQuestions(decorators, code, sourceRef));
    }
  }

  return qs;
};

const ruleIfStatement: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const condition = getSectionFirstItem(node, "condition");
  if (!condition) return [];
  const text = textForRange(condition.startIndex, condition.endIndex, code) || condition.type;
  return [
    singleQuestion(
      "What is the if condition?",
      text,
      [sourceRef],
      "if.condition"
    ),
  ];
};

const ruleForStatement: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const init = unwrapExpressionStatement(getSectionFirstItem(node, "init"));
  const condition = unwrapExpressionStatement(getSectionFirstItem(node, "condition"));
  const update = getSectionFirstItem(node, "update");
  const qs: Q11[] = [];
  if (init) {
    const text = textForRange(init.startIndex, init.endIndex, code) || init.type;
    qs.push(singleQuestion("What is the initializer?", text, [sourceRef], "for.init"));
  }
  if (condition) {
    const text = textForRange(condition.startIndex, condition.endIndex, code) || condition.type;
    qs.push(singleQuestion("What is the loop condition?", text, [sourceRef], "for.condition"));
  }
  if (update) {
    const text = textForRange(update.startIndex, update.endIndex, code) || update.type;
    qs.push(singleQuestion("What is the increment/update expression?", text, [sourceRef], "for.update"));
  }
  return qs;
};

const detectForInOperator = (
  node: TreeSitterAstNode,
  code: string | undefined
): string | undefined => {
  const left = getSectionFirstItem(node, "left");
  const right = getSectionFirstItem(node, "right");
  if (!left || !right || !code) return undefined;
  const between = code.slice(left.endIndex, right.startIndex);
  if (/\bof\b/.test(between)) return "of";
  if (/\bin\b/.test(between)) return "in";
  return undefined;
};

const ruleForInStatement: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const left = getSectionFirstItem(node, "left");
  const right = getSectionFirstItem(node, "right");
  const qs: Q11[] = [];
  const op = detectForInOperator(node, code);
  if (op) {
    qs.push(
      singleQuestion(
        "Is this a for..in or for..of loop?",
        op,
        [sourceRef],
        "for_in.operator"
      )
    );
  }
  if (left) {
    const text = textForRange(left.startIndex, left.endIndex, code) || left.type;
    qs.push(singleQuestion("What is the loop binding/target?", text, [sourceRef], "for_in.left"));
  }
  if (right) {
    const text = textForRange(right.startIndex, right.endIndex, code) || right.type;
    qs.push(singleQuestion("What is being iterated?", text, [sourceRef], "for_in.right"));
  }
  return qs;
};

const ruleWhileStatement: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const condition = getSectionFirstItem(node, "condition");
  if (!condition) return [];
  const text = textForRange(condition.startIndex, condition.endIndex, code) || condition.type;
  return [
    singleQuestion("What is the loop condition?", text, [sourceRef], "while.condition"),
  ];
};

const ruleSwitchStatement: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const value = getSectionFirstItem(node, "value");
  if (!value) return [];
  const text = textForRange(value.startIndex, value.endIndex, code) || value.type;
  return [
    singleQuestion(
      "What value is being switched on?",
      text,
      [sourceRef],
      "switch.value"
    ),
  ];
};

const ruleSwitchCase: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const value = getSectionFirstItem(node, "value");
  if (!value) return [];
  const text = textForRange(value.startIndex, value.endIndex, code) || value.type;
  return [
    singleQuestion("What is the case value?", text, [sourceRef], "switch.case"),
  ];
};

const ruleCatchClause: Rule = ({ node, code, sourceRef, profile }) => {
  if (profile !== "deep") return [];
  const param = getSectionFirstItem(node, "param");
  if (!param) return [];
  const text = textForRange(param.startIndex, param.endIndex, code) || param.type;
  return [
    singleQuestion(
      "What is the caught error binding name/pattern?",
      text,
      [sourceRef],
      "catch.param"
    ),
  ];
};

const ruleReturnStatement: Rule = ({ root, node, code, sourceRef, profile }) => {
  const value = (node.namedChildren || [])[0];
  if (!value) return [];
  const text = textForRange(value.startIndex, value.endIndex, code) || value.type;
  const qs = [
    singleQuestion("What value is returned?", text, [sourceRef], "return.value"),
  ];
  if (value.type === "jsx_element" || value.type === "jsx_self_closing_element") {
    qs.push(...buildJsxQuestions(value, code, sourceRef));
  }
  const objects = findObjectLiteralNodes(value);
  for (const obj of objects) {
    qs.push(...generateQuestionsV11(root, obj, profile, code));
  }
  return qs;
};

const ruleThrowStatement: Rule = ({ node, code, sourceRef }) => {
  const value = (node.namedChildren || [])[0];
  if (!value) return [];
  const text = textForRange(value.startIndex, value.endIndex, code) || value.type;
  return [
    singleQuestion("What value is thrown?", text, [sourceRef], "throw.value"),
  ];
};

const ruleBreakContinue: Rule = ({ node, code, sourceRef }) => {
  const label = childByField(node, "label");
  if (!label) return [];
  const text = textForRange(label.startIndex, label.endIndex, code) || label.type;
  return [
    singleQuestion("What label is targeted?", text, [sourceRef], "branch.label"),
  ];
};

type CallChainSegment = {
  segmentType: "base" | "field" | "args";
  text: string;
  node: TreeSitterAstNode;
};

const decomposeCallChain = (
  node: TreeSitterAstNode,
  code: string | undefined
): CallChainSegment[] => {
  const segments: CallChainSegment[] = [];
  const walk = (n: TreeSitterAstNode | undefined) => {
    if (!n) return;
    if (n.type === "call_expression") {
      const funcNode = childByField(n, "function") || (n.namedChildren || [])[0];
      if (funcNode) walk(funcNode);
      const argsNode = childByField(n, "arguments");
      if (argsNode) {
        const argsText = textForRange(argsNode.startIndex, argsNode.endIndex, code) || "()";
        segments.push({ text: argsText, segmentType: "args", node: argsNode });
      }
      return;
    }
    if (n.type === "member_expression") {
      const object = childByField(n, "object") || (n.namedChildren || [])[0];
      if (object) walk(object);
      const property = childByField(n, "property") || (n.namedChildren || [])[1];
      if (property) {
        const fieldText = textForRange(property.startIndex, property.endIndex, code) || property.type;
        segments.push({ text: fieldText, segmentType: "field", node: property });
      }
      return;
    }
    const text = textForRange(n.startIndex, n.endIndex, code) || n.type;
    segments.push({ text, segmentType: "base", node: n });
  };

  walk(node);
  return segments;
};

const buildCallQuestions = (
  callNode: TreeSitterAstNode,
  code: string | undefined,
  sourceRef: SourceRef,
  profile: DecompositionLevel
): Q11[] => {
  const qs: Q11[] = [];
  const callee = childByField(callNode, "function") || (callNode.namedChildren || [])[0];
  const argsNode = childByField(callNode, "arguments");
  const args = argsNode ? argsNode.namedChildren || [] : [];

  if (profile === "shallow") {
    const fullCallText =
      textForRange(callNode.startIndex, callNode.endIndex, code) || callNode.type;
    qs.push({
      kind: "call.full",
      stem: "What function is called?",
      answerLabel: fullCallText,
      options: shuffle([fullCallText, ...buildDistractors(fullCallText)]),
      sourceRefs: [sourceRef],
      generatorRule: "call.full",
    });
  } else {
    const segments = decomposeCallChain(callNode, code);
    const fieldCount = segments.filter((s) => s.segmentType === "field").length;
    const argsCount = segments.filter((s) => s.segmentType === "args").length;
    const hasChain = fieldCount > 1 || argsCount > 1;

    if (hasChain) {
      let stepNum = 1;
      for (const seg of segments) {
        if (seg.segmentType === "base") {
          qs.push({
            kind: "call.chain.base",
            stem: `Step ${stepNum}: What is the base/starting expression?`,
            answerLabel: seg.text,
            options: shuffle([seg.text, ...buildDistractors(seg.text)]),
            sourceRefs: [sourceRef],
            generatorRule: "call.chain.base",
          });
          stepNum += 1;
        } else if (seg.segmentType === "field") {
          qs.push({
            kind: "call.chain.field",
            stem: `Step ${stepNum}: What field/method is accessed next?`,
            answerLabel: seg.text,
            options: shuffle([seg.text, ...buildDistractors(seg.text)]),
            sourceRefs: [sourceRef],
            generatorRule: "call.chain.field",
          });
          stepNum += 1;
        } else if (seg.segmentType === "args") {
          const argsChildren = seg.node.namedChildren || [];
          if (argsChildren.length > 0) {
            const argTexts = argsChildren.map(
              (a) => textForRange(a.startIndex, a.endIndex, code) || a.type
            );
            const optionPool = buildMultiSelectOptionPool(
              argTexts,
              code,
              callNode.startIndex,
              callNode.endIndex
            );
            qs.push({
              kind: "call.chain.args",
              stem: `Step ${stepNum}: Select the arguments in order`,
              answerLabel: "",
              options: optionPool,
              optionPool,
              questionType: "orderedMulti",
              multiCorrect: argTexts,
              multiSelectHint: argTexts.length,
              sourceRefs: [sourceRef],
              generatorRule: "call.chain.args",
            });
            stepNum += 1;
          }
        }
      }
    } else {
      if (callee) {
        const calleeText =
          textForRange(callee.startIndex, callee.endIndex, code) || callee.type;
        qs.push({
          kind: "call.callee",
          stem: "What function is called?",
          answerLabel: calleeText,
          options: shuffle([calleeText, ...buildDistractors(calleeText)]),
          sourceRefs: [sourceRef],
          generatorRule: "call.callee",
        });
      }
      if (args.length > 0) {
        const argTexts = args.map(
          (a) => textForRange(a.startIndex, a.endIndex, code) || a.type
        );
        const optionPool = buildMultiSelectOptionPool(
          argTexts,
          code,
          callNode.startIndex,
          callNode.endIndex
        );
        qs.push({
          kind: "call.args",
          stem: "Select the arguments in order",
          answerLabel: "",
          options: optionPool,
          optionPool,
          questionType: "orderedMulti",
          multiCorrect: argTexts,
          multiSelectHint: argTexts.length,
          sourceRefs: [sourceRef],
          generatorRule: "call.args",
        });
      }
    }

    const optional = firstChildOfType(callNode, "optional_chain");
    if (optional) {
      qs.push(
        yesNoQuestion("Is this an optional call?", true, [sourceRef], "call.optional")
      );
    }

    if (callee && callee.type === "import" && args[0]) {
      const mod = args[0];
      const modText = textForRange(mod.startIndex, mod.endIndex, code) || mod.type;
      qs.push(
        singleQuestion(
          "What module is dynamically imported?",
          stripQuotes(modText),
          [sourceRef],
          "call.dynamic_import"
        )
      );
    }
  }

  return qs;
};

const buildJsxQuestions = (
  node: TreeSitterAstNode,
  code: string | undefined,
  sourceRef: SourceRef
): Q11[] => {
  const qs: Q11[] = [];
  const nameNode = getSectionFirstItem(node, "name");
  if (nameNode) {
    const nameText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
    qs.push(
      singleQuestion(
        "What is the component/tag name?",
        nameText,
        [sourceRef],
        "jsx.name"
      )
    );
  }

  const attrs = getSectionItems(node, "attributes");
  const propNames = attrs
    .filter((a) => a.type === "jsx_attribute")
    .map((a) => (a.namedChildren || [])[0])
    .filter(Boolean)
    .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type);

  if (propNames.length > 0) {
    qs.push(
      multiQuestion(
        "Which prop names are set on this JSX element?",
        Array.from(new Set(propNames)),
        sourceRef,
        "jsx.props",
        code,
        node.startIndex,
        node.endIndex
      )
    );
  }

  return qs;
};

const ruleExpressionStatement: Rule = ({ root, node, code, sourceRef, profile }) => {
  const expr = getSectionFirstItem(node, "expr") || (node.namedChildren || [])[0];
  if (!expr) return [];
  if (expr.type === "assignment_expression") {
    return ruleAssignmentExpression(root, expr, code, sourceRef, profile);
  }
  if (expr.type === "augmented_assignment_expression") {
    return ruleAugmentedAssignment(expr, code, sourceRef);
  }
  if (expr.type === "call_expression") {
    const qs = buildCallQuestions(expr, code, sourceRef, profile);
    const objects = findObjectLiteralNodes(expr);
    for (const obj of objects) {
      qs.push(...generateQuestionsV11(root, obj, profile, code));
    }
    return qs;
  }
  if (expr.type === "jsx_element" || expr.type === "jsx_self_closing_element") {
    return buildJsxQuestions(expr, code, sourceRef);
  }
  return [];
};

const ruleObjectLiteral: Rule = ({ root, node, code, sourceRef, profile }) => {
  const entries: Array<{
    keyNode: TreeSitterAstNode;
    valueNode: TreeSitterAstNode;
    keyText: string;
  }> = [];
  const keys: string[] = [];
  for (const child of node.namedChildren || []) {
    if (child.type === "pair") {
      const keyNode = childByField(child, "key") || child.namedChildren?.[0];
      const valueNode = childByField(child, "value") || child.namedChildren?.[1];
      if (!keyNode || !valueNode) continue;
      const keyText = textForRange(keyNode.startIndex, keyNode.endIndex, code) || keyNode.type;
      if (!keyText) continue;
      keys.push(keyText);
      entries.push({ keyNode, valueNode, keyText });
      continue;
    }
    if (child.type === "shorthand_property_identifier") {
      const keyText = textForRange(child.startIndex, child.endIndex, code) || child.type;
      if (!keyText) continue;
      keys.push(keyText);
      entries.push({ keyNode: child, valueNode: child, keyText });
      continue;
    }
    if (child.type === "method_definition") {
      const nameNode = childByField(child, "name") || child.namedChildren?.[0];
      if (!nameNode) continue;
      const keyText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
      if (!keyText) continue;
      keys.push(keyText);
      entries.push({ keyNode: nameNode, valueNode: child, keyText });
    }
  }

  if (entries.length === 0) return [];

  const qs: Q11[] = [];
  const allKeysSet = new Set(keys);
  const keyCards = splitCorrectIntoCards(keys);
  for (const card of keyCards) {
    const optionPool = buildKeyGroupOptionPool(
      card,
      allKeysSet,
      code,
      node.startIndex,
      node.endIndex
    );
    qs.push({
      kind: "object.keys",
      stem: "Which keys are present in this object literal?",
      answerLabel: "",
      options: optionPool,
      optionPool,
      questionType: "multi",
      multiCorrect: card,
      multiSelectHint: card.length,
      sourceRefs: [sourceRef],
      generatorRule: "object.keys",
    });
  }

  for (const entry of entries) {
    const keyRef: SourceRef = {
      nodeType: entry.keyNode.type,
      start: entry.keyNode.startIndex,
      end: entry.keyNode.endIndex,
      path: computeAstPath(root, entry.keyNode),
    };
    const valueRef: SourceRef = {
      nodeType: entry.valueNode.type,
      start: entry.valueNode.startIndex,
      end: entry.valueNode.endIndex,
      path: computeAstPath(root, entry.valueNode),
    };
    const valueText =
      textForRange(entry.valueNode.startIndex, entry.valueNode.endIndex, code) ||
      entry.valueNode.type;
    qs.push({
      kind: "object.value",
      stem: `What is the value for key ${entry.keyText}?`,
      answerLabel: valueText,
      options: [],
      sourceRefs: [keyRef, valueRef, sourceRef],
      generatorRule: "object.value",
    });

    const valueQuestions = generateQuestionsV11(root, entry.valueNode, profile, code);
    if (valueQuestions.length > 0) {
      qs.push(
        ...valueQuestions.map((q) => ({
          ...q,
          stem: `For key ${entry.keyText}: ${q.stem}`,
          sourceRefs: [keyRef, ...(q.sourceRefs || [])],
          generatorRule: `object.value.${q.generatorRule}`,
        }))
      );
    }
  }

  return qs;
};

const ruleCallExpression: Rule = ({ root, node, code, sourceRef, profile }) => {
  const qs = buildCallQuestions(node, code, sourceRef, profile);
  const objects = findObjectLiteralNodes(node);
  for (const obj of objects) {
    qs.push(...generateQuestionsV11(root, obj, profile, code));
  }
  return qs;
};

const ruleArrowFunction: Rule = ({ node, code, sourceRef, profile }) =>
  buildArrowFunctionQuestions(node, code, sourceRef, profile);

const decoratorQuestions = (
  decorators: TreeSitterAstNode[],
  code: string | undefined,
  sourceRef: SourceRef
): Q11[] => {
  if (decorators.length === 0) return [];
  const names: string[] = [];
  for (const dec of decorators) {
    const child = (dec.namedChildren || [])[0];
    if (!child) continue;
    if (child.type === "call_expression") {
      const callee = childByField(child, "function") || (child.namedChildren || [])[0];
      if (callee) {
        const text = textForRange(callee.startIndex, callee.endIndex, code) || callee.type;
        names.push(text);
      }
    } else {
      const text = textForRange(child.startIndex, child.endIndex, code) || child.type;
      names.push(text);
    }
  }

  if (names.length === 0) return [];
  return [
    multiQuestion(
      "Which decorators are applied?",
      Array.from(new Set(names)),
      sourceRef,
      "decorators.list",
      code,
      decorators[0].startIndex,
      decorators[decorators.length - 1].endIndex
    ),
  ];
};

const rules: Record<string, Rule[]> = {
  export_statement: [ruleExportStatement],
  lexical_declaration: [ruleVariableDeclaration],
  variable_declaration: [ruleVariableDeclaration],
  function_declaration: [headerRule, ruleFunctionDeclaration],
  generator_function_declaration: [headerRule, ruleFunctionDeclaration],
  function: [ruleFunctionDeclaration],
  generator_function: [ruleFunctionDeclaration],
  arrow_function: [ruleArrowFunction],
  class_declaration: [headerRule, ruleClassDeclaration],
  method_definition: [headerRule, ruleMethodDefinition],
  field_definition: [ruleFieldDefinition],
  public_field_definition: [ruleFieldDefinition],
  class_static_block: [headerRule],
  if_statement: [headerRule, ruleIfStatement],
  else_clause: [headerRule],
  for_statement: [headerRule, ruleForStatement],
  for_in_statement: [headerRule, ruleForInStatement],
  while_statement: [headerRule, ruleWhileStatement],
  do_statement: [headerRule, ruleWhileStatement],
  switch_statement: [headerRule, ruleSwitchStatement],
  switch_case: [headerRule, ruleSwitchCase],
  switch_default: [headerRule],
  try_statement: [headerRule],
  catch_clause: [headerRule, ruleCatchClause],
  finally_clause: [headerRule],
  return_statement: [ruleReturnStatement],
  throw_statement: [ruleThrowStatement],
  break_statement: [ruleBreakContinue],
  continue_statement: [ruleBreakContinue],
  expression_statement: [ruleExpressionStatement],
  object: [ruleObjectLiteral],
  call_expression: [ruleCallExpression],
};

export function generateQuestionsV11(
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  profile: DecompositionLevel,
  code?: string
): Q11[] {
  const src: SourceRef = {
    nodeType: node.type,
    start: node.startIndex,
    end: node.endIndex,
    path: computeAstPath(root, node),
    preview: textForRange(node.startIndex, node.endIndex, code)?.slice(0, 120),
  };
  const applyRules = rules[node.type] || [];
  const all: Q11[] = [];
  for (const rule of applyRules) {
    const qs = rule({ root, node, code, sourceRef: src, profile });
    if (qs && qs.length) all.push(...qs);
  }
  return all;
}

// ============================================================================
// Statement Anchors
// ============================================================================

const ANCHOR_NODE_TYPES = new Set<string>([
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
]);

export const isAnchorNode = (node: TreeSitterAstNode): boolean => {
  if (node.type === "empty_statement") return false;
  return ANCHOR_NODE_TYPES.has(node.type);
};

const CONTAINER_NODE_TYPES = new Set(["program", "statement_block", "class_body", "switch_body"]);

const getStatementChildren = (node: TreeSitterAstNode): TreeSitterAstNode[] => {
  const base = (node.namedChildren || []).filter(
    (c) => c.type !== "comment" && c.type !== "html_comment"
  );

  if (node.type === "switch_case" || node.type === "switch_default") {
    return childrenByField(node, "body");
  }

  if (!CONTAINER_NODE_TYPES.has(node.type)) return base;

  if (node.type === "program" || node.type === "statement_block") {
    const trimmed = base.filter((c) => !isDocstringNode(c, node));
    return trimmed;
  }

  return base;
};

const BODY_NODE_TYPES = new Set(["statement_block", "class_body", "switch_body"]);

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

const isHeaderQuestion = (q: QuizQuestion): boolean =>
  q.stem === "Write the full header line" || q.generatorRule === "header.line";

const spanForQuestion = (
  q: QuizQuestion
): { start: number; end: number } | undefined => {
  if (
    typeof q.revealEndBeforeChild === "number" &&
    typeof q.revealEndAfterChild === "number" &&
    Number.isFinite(q.revealEndBeforeChild) &&
    Number.isFinite(q.revealEndAfterChild)
  ) {
    return { start: q.revealEndBeforeChild, end: q.revealEndAfterChild };
  }
  if (Array.isArray(q.sourceRefs) && q.sourceRefs.length > 0) {
    const ref = q.sourceRefs[0];
    if (Number.isFinite(ref.start) && Number.isFinite(ref.end)) {
      return { start: ref.start, end: ref.end };
    }
  }
  return undefined;
};

const applyQuestionOverlapGuard = (steps: EngineStep[]): void => {
  type Entry = {
    question: QuizQuestion;
    span: { start: number; end: number };
    isHeader: boolean;
  };

  const entries: Entry[] = [];
  const collect = (step: EngineStep) => {
    const qs = step.quiz?.questions || [];
    for (const q of qs) {
      const span = spanForQuestion(q);
      if (!span) continue;
      entries.push({
        question: q,
        span,
        isHeader: isHeaderQuestion(q),
      });
    }
    (step.lesson?.childSteps || []).forEach(collect);
  };
  steps.forEach(collect);

  const sorted = entries.slice().sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    if (lenA !== lenB) return lenA - lenB;
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    return a.span.end - b.span.end;
  });

  const seenKeys = new Set<string>();
  const kept: typeof entries = [];
  const drop = new Set<QuizQuestion>();

  const makeDuplicateKey = (q: QuizQuestion) => {
    const span = spanForQuestion(q);
    return `${q.stem}::${q.answerLabel}::${span?.start}-${span?.end}`;
  };

  for (const entry of sorted) {
    const dupKey = makeDuplicateKey(entry.question);
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

const NO_FALLBACK_QUIZ_NODE_TYPES = new Set<string>([
  "import_statement",
  "export_statement",
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "method_definition",
  "field_definition",
  "public_field_definition",
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
]);

// ============================================================================
// Main Walker
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
    if (anchor.type === "import_statement" && isTypeOnlyImportExport(anchor, code, "import")) {
      return [];
    }
    const ruleQuestions = generateQuestionsV11(root, anchor, mappedProfile, code);
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
        sourceRefs: [
          {
            nodeType: anchor.type,
            start: anchor.startIndex,
            end: anchor.endIndex,
            path: computeAstPath(root, anchor),
            preview: txt.slice(0, 120),
          },
        ],
        generatorRule: "shallow_statement",
      },
    ];
  };

  const buildLessonDataForAnchor = (
    anchor: TreeSitterAstNode,
    hasChildStatements: boolean,
    hasQuestions: boolean
  ): EngineStep["lesson"] | undefined => {
    switch (anchor.type) {
      case "import_statement": {
        return {
          prompt: "We import dependencies for this file.",
          semanticRole: "import_statement",
          isDigable: false,
        };
      }
      case "export_statement": {
        return {
          prompt: "We export a binding from this module.",
          semanticRole: "export_statement",
          isDigable: false,
        };
      }
      case "lexical_declaration":
      case "variable_declaration": {
        const declarators = getSectionItems(anchor, "declarators");
        const bindings = declarators.flatMap((decl) => {
          const nameNode = getSectionFirstItem(decl, "name");
          return collectBindingNames(nameNode, code);
        });
        const label = bindings.length ? bindings.join(", ") : "variables";
        return {
          prompt: `We declare: ${label}`,
          semanticRole: anchor.type,
          isDigable: false,
        };
      }
      case "function_declaration":
      case "generator_function_declaration": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : "function";
        return {
          prompt: `We define a function named: ${options.includeNames === false ? "(hidden)" : nameText}`,
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      }
      case "class_declaration": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : "class";
        return {
          prompt: `We define a class named: ${options.includeNames === false ? "(hidden)" : nameText}`,
          semanticRole: "class_declaration",
          isDigable: hasChildStatements,
        };
      }
      case "method_definition": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : "method";
        return {
          prompt: `We define a method named: ${options.includeNames === false ? "(hidden)" : nameText}`,
          semanticRole: "method_definition",
          isDigable: hasChildStatements,
        };
      }
      case "field_definition":
      case "public_field_definition": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : "field";
        return {
          prompt: `We define a field named: ${options.includeNames === false ? "(hidden)" : nameText}`,
          semanticRole: anchor.type,
          isDigable: false,
        };
      }
      case "if_statement":
        return {
          prompt: "We branch on a condition.",
          semanticRole: "if_statement",
          isDigable: hasChildStatements,
        };
      case "else_clause":
        return {
          prompt: "We handle the else branch.",
          semanticRole: "else_clause",
          isDigable: hasChildStatements,
        };
      case "for_statement":
      case "for_in_statement":
      case "while_statement":
      case "do_statement":
        return {
          prompt: "We run a loop.",
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      case "switch_statement":
        return {
          prompt: "We branch using a switch.",
          semanticRole: "switch_statement",
          isDigable: hasChildStatements,
        };
      case "switch_case":
      case "switch_default":
        return {
          prompt: "We handle a switch case.",
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      case "try_statement":
      case "catch_clause":
      case "finally_clause":
        return {
          prompt: "We handle a try/catch/finally section.",
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      case "return_statement":
        return {
          prompt: "We return from the current function.",
          semanticRole: "return_statement",
          isDigable: false,
        };
      case "throw_statement":
        return {
          prompt: "We throw an error/value.",
          semanticRole: "throw_statement",
          isDigable: false,
        };
      case "expression_statement":
        return {
          prompt: hasQuestions ? "We evaluate an expression." : "We run an expression statement.",
          semanticRole: "expression_statement",
          isDigable: false,
        };
      default:
        return {
          prompt: `We encounter a ${anchor.type}.`,
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
    const lessonData = buildLessonDataForAnchor(
      anchor,
      hasChildStatements,
      questions.length > 0
    );
    const displaySpan = displaySpanForNode(anchor);

    steps.push({
      id: randomString(8),
      node: anchor,
      displaySpan,
      lesson: lessonData,
      quiz: questions.length > 0 ? { questions } : undefined,
    });
  };

  const collectImportRun = (
    stmts: TreeSitterAstNode[],
    startIdx: number
  ): { run: TreeSitterAstNode[]; nextIndex: number } => {
    const run: TreeSitterAstNode[] = [];
    let i = startIdx;
    while (i < stmts.length && stmts[i].type === "import_statement") {
      run.push(stmts[i]);
      i++;
    }
    return { run, nextIndex: i };
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

    const questions = options.generateQuiz !== false
      ? generateImportRunQuestions(root, run, code, mappedProfile)
      : [];

    const childSteps: EngineStep[] = run.map((importNode) => ({
      id: randomString(8),
      node: importNode,
      displaySpan: { start: importNode.startIndex, end: importNode.endIndex },
      lesson: {
        semanticRole: importNode.type,
        prompt: "Import statement.",
        isDigable: false,
      },
    }));

    const declCount = run.length;
    const lessonPrompt =
      declCount === 1
        ? "We import dependencies for this file."
        : `This block imports dependencies from ${declCount} import statements.`;

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

  const blockHasStatements = (block?: TreeSitterAstNode) => {
    if (!block) return false;
    const statements = getStatementChildren(block);
    return statements.some((stmt) => isAnchorNode(stmt) || statementHasAnchor(stmt));
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    const children = getStatementChildren(block);
    let i = 0;
    while (i < children.length) {
      const stmt = children[i];
      if (block.type === "program" && stmt.type === "import_statement") {
        const { run, nextIndex } = collectImportRun(children, i);
        emitImportRunStep(run);
        i = nextIndex;
        continue;
      }
      if (isAnchorNode(stmt)) {
        walkStmt(stmt);
      }
      i++;
    }
  };

  const walkStmt = (stmt: TreeSitterAstNode) => {
    if (!isAnchorNode(stmt)) return;
    switch (stmt.type) {
      case "function_declaration":
      case "generator_function_declaration": {
        const block = childByField(stmt, "body") || firstChildOfType(stmt, "statement_block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "class_declaration": {
        const body = childByField(stmt, "body") || firstChildOfType(stmt, "class_body");
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        if (body) walkBlock(body);
        break;
      }
      case "method_definition": {
        const body = childByField(stmt, "body") || firstChildOfType(stmt, "statement_block");
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        if (body) walkBlock(body);
        break;
      }
      case "class_static_block": {
        const body = firstChildOfType(stmt, "statement_block");
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        if (body) walkBlock(body);
        break;
      }
      case "if_statement": {
        const consequence = childByField(stmt, "consequence");
        const alternative = childByField(stmt, "alternative");
        const hasChildStatements =
          (consequence && (statementHasAnchor(consequence) || blockHasStatements(consequence))) ||
          (alternative && (statementHasAnchor(alternative) || blockHasStatements(alternative)));
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        if (consequence) {
          if (consequence.type === "statement_block") walkBlock(consequence);
          else walkStmt(consequence);
        }
        if (alternative) {
          if (alternative.type === "statement_block") walkBlock(alternative);
          else walkStmt(alternative);
        }
        break;
      }
      case "else_clause": {
        const body = (stmt.namedChildren || [])[0];
        const hasChildStatements = body ? statementHasAnchor(body) || blockHasStatements(body) : false;
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        if (body) {
          if (body.type === "statement_block") walkBlock(body);
          else walkStmt(body);
        }
        break;
      }
      case "for_statement":
      case "for_in_statement":
      case "while_statement":
      case "do_statement": {
        const body = childByField(stmt, "body") || firstChildOfType(stmt, "statement_block");
        const hasChildStatements = blockHasStatements(body) || (body ? statementHasAnchor(body) : false);
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        if (body) {
          if (body.type === "statement_block") walkBlock(body);
          else walkStmt(body);
        }
        break;
      }
      case "switch_statement": {
        const body = childByField(stmt, "body") || firstChildOfType(stmt, "switch_body");
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        if (body) walkBlock(body);
        break;
      }
      case "switch_case":
      case "switch_default": {
        const caseBody = childrenByField(stmt, "body");
        const hasChildStatements = caseBody.some((c) => isAnchorNode(c) || statementHasAnchor(c));
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        caseBody.forEach((c) => {
          if (c.type === "statement_block") walkBlock(c);
          else walkStmt(c);
        });
        break;
      }
      case "try_statement": {
        const body = childByField(stmt, "body");
        const handler = childByField(stmt, "handler");
        const finalizer = childByField(stmt, "finalizer");
        const hasChildStatements =
          blockHasStatements(body) ||
          (handler ? statementHasAnchor(handler) || blockHasStatements(handler) : false) ||
          (finalizer ? statementHasAnchor(finalizer) || blockHasStatements(finalizer) : false);
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        if (body) walkBlock(body);
        if (handler) walkStmt(handler);
        if (finalizer) walkStmt(finalizer);
        break;
      }
      case "catch_clause":
      case "finally_clause": {
        const body = childByField(stmt, "body") || firstChildOfType(stmt, "statement_block");
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, Boolean(hasChildStatements));
        if (body) walkBlock(body);
        break;
      }
      default: {
        emitAnchorStep(stmt, false);
        break;
      }
    }
  };

  const finalize = (out: EngineStep[]) => {
    if (options.generateQuiz !== false) applyQuestionOverlapGuard(out);
    return out;
  };

  if (
    node.type === "program" ||
    node.type === "statement_block" ||
    node.type === "class_body" ||
    node.type === "switch_body"
  ) {
    walkBlock(node);
    return finalize(steps);
  }

  walkStmt(node);
  return finalize(steps);
};

// ============================================================================
// Masking + Custom Quiz Payload
// ============================================================================

type MaskRange = { start: number; end: number };

const headerMaskAndAnswer = (
  stmt: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } => {
  const { headerEnd } = getRevealAnchors(stmt);
  const answerText = headerAnswer(stmt, code);
  const masks = headerEnd > stmt.startIndex
    ? [{ start: stmt.startIndex, end: headerEnd }]
    : [];
  return { masks, answerText };
};

export function maskAndAnswerForStep(
  step: EngineStep,
  root: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  if ((step.node as any).isVirtual || step.node.type === "import_group") {
    return { masks: [], answerText: textForRange(step.node.startIndex, step.node.endIndex, code) || "" };
  }
  const headerTypes = [
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
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "method_definition",
    "class_static_block",
  ];
  const isHeaderNode = headerTypes.includes(step.node.type);

  if (isHeaderNode) {
    return headerMaskAndAnswer(step.node, code);
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
      q.questionType === "orderedMulti" ||
      (Array.isArray(q.multiCorrect) && q.multiCorrect.length > 0);
    const isOrderedMulti = q.questionType === "orderedMulti";
    const resolvedQuestionType = isOrderedMulti ? "orderedMulti" : "multi";
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
            preview: textForRange(revealSpan.start, revealSpan.end, code)?.slice(0, 120),
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
      questionType: isMulti ? resolvedQuestionType : undefined,
      multiCorrect: q.multiCorrect,
      multiSelectHint: q.multiSelectHint,
      optionPool: q.optionPool ?? q.options,
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
