import type { TreeSitterAstNode } from "./treeSitter";
import {
  isDocstringNode,
  childrenOfType,
  firstChildOfType,
  childByField,
  buildCuratedSections,
  getSectionItems,
  getSectionFirstItem,
} from "./pyCuration";
import { randomString } from "./utils";

// ============================================================================
// Types
// ============================================================================

export type EngineOptions = {
  profile: "shallow" | "deep";
  grouping: "auto" | boolean;
  includeNames?: boolean;
  // Skip quiz generation when only lesson/grouping is needed (e.g., Teach Me flow)
  generateQuiz?: boolean;
  // Internal recursion guard
  __noGroup?: boolean;
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
  questionType?: "single" | "multi";
  multiCorrect?: string[];
  optionPool?: string[];
  multiSelectHint?: number;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};

export type EngineStep = {
  id: string;
  node: TreeSitterAstNode & { isVirtual?: boolean };
  displaySpan?: { start: number; end: number };

  // Lesson Data
  lesson?: {
    prompt: string;
    semanticRole: string;
    isDigable: boolean;
    childSteps?: EngineStep[];
  };

  // Quiz Data
  quiz?: {
    questions: QuizQuestion[];
  };
};

// ============================================================================
// Helpers (Consolidated)
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
  )
    return code.slice(start, end);
  return undefined;
};

const headerAnswer = (stmt: TreeSitterAstNode, code?: string): string => {
  if (!code) return stmt.type;
  const full = code.substring(stmt.startIndex, stmt.endIndex);
  const colonIdx = full.indexOf(":");
  return (colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]).trimEnd();
};

const headerSpanByAst = (
  node: TreeSitterAstNode
): { start: number; end: number } => {
  const body =
    firstChildOfType(node, "block") || firstChildOfType(node, "suite");
  if (body && body.startIndex > node.startIndex) {
    return { start: node.startIndex, end: body.startIndex };
  }
  if (node.type === "decorated_definition") {
    const inner =
      firstChildOfType(node, "function_definition") ||
      firstChildOfType(node, "class_definition");
    const innerBody =
      inner &&
      (firstChildOfType(inner, "block") || firstChildOfType(inner, "suite"));
    if (innerBody && innerBody.startIndex > node.startIndex) {
      return { start: node.startIndex, end: innerBody.startIndex };
    }
  }
  if (node.type === "match_statement" || node.type === "match_stmt") {
    const firstCase = (node.namedChildren || []).find(
      (c) => c.type === "case_clause" || c.type === "case_block"
    );
    if (firstCase && firstCase.startIndex > node.startIndex) {
      return { start: node.startIndex, end: firstCase.startIndex };
    }
  }
  return { start: node.startIndex, end: node.endIndex };
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

export const computeAstPath = (
  root: TreeSitterAstNode,
  target: TreeSitterAstNode
): number[] => {
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

// Global lightweight distractor pool for padding option lists
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

const extractOperatorBetween = (
  code: string | undefined,
  leftEnd: number,
  rightStart: number
): string | undefined => {
  if (!code) return undefined;
  const raw = code.slice(leftEnd, rightStart).trim();
  return raw.replace(/\s+/g, " ");
};

type ChainLink = {
  kind: "attr" | "call";
  name?: string;
  args?: TreeSitterAstNode[];
};
const extractCallChain = (
  node: TreeSitterAstNode,
  code?: string
): ChainLink[] => {
  const links: ChainLink[] = [];
  let cur: TreeSitterAstNode | undefined = node;

  const getFuncNode = (n: TreeSitterAstNode) =>
    childByField(n, "function") || (n.namedChildren || [])[0];

  const pushAttr = (n: TreeSitterAstNode) => {
    const kids = n.namedChildren || [];
    const nameNode = kids[kids.length - 1];
    const name = nameNode
      ? textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
      nameNode.type
      : undefined;
    links.push({ kind: "attr", name });
  };

  const pushCall = (n: TreeSitterAstNode) => {
    const fn = getFuncNode(n);
    let name: string | undefined;
    if (fn?.type === "identifier") {
      name = textForRange(fn.startIndex, fn.endIndex, code) || fn.type;
    } else if (fn?.type === "attribute") {
      const kids = fn.namedChildren || [];
      const leaf = kids[kids.length - 1];
      if (leaf?.type === "identifier") {
        name = textForRange(leaf.startIndex, leaf.endIndex, code) || leaf.type;
      }
    }
    const argsList =
      childByField(n, "arguments") ||
      (n.namedChildren || []).find((c) => c.type === "argument_list");
    const args = argsList?.namedChildren || [];
    links.push({ kind: "call", name, args });
  };

  while (cur) {
    if (cur.type === "call") {
      pushCall(cur);
      const fn = getFuncNode(cur);
      cur = fn;
    } else if (cur.type === "attribute") {
      pushAttr(cur);
      cur = (cur.namedChildren || [])[0];
    } else {
      break;
    }
  }
  return links.reverse();
};

function buildDistractors(correct: string, _ctx?: { code?: string }): string[] {
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
}

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
    const reStr = /(['"])((?:\\.|(?!\1).)*)\1/g;
    const snippet = (code || "").slice(spanStart, spanEnd);
    let m: RegExpExecArray | null;
    while ((m = reId.exec(snippet))) idPool.push(m[0]);
    while ((m = reStr.exec(snippet))) if (m[2].trim()) strPool.push(m[2]);
  } catch { }
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

const buildModuleOptionPool = (
  correct: string,
  code: string | undefined,
  spanStart: number,
  spanEnd: number
): string[] => {
  const pool = new Set<string>();
  try {
    const reModule = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
    const snippet = (code || "").slice(spanStart, spanEnd);
    let m: RegExpExecArray | null;
    while ((m = reModule.exec(snippet))) {
      if (m[0] !== correct) pool.add(m[0]);
    }
  } catch { }
  let options = Array.from(pool);
  if (options.length + 1 < 10) {
    const needed = 10 - (options.length + 1);
    const pad = shuffle(GENERIC_DISTRACTORS)
      .filter((d) => d !== correct && !options.includes(d))
      .slice(0, needed);
    options.push(...pad);
  }
  const MAX = 10;
  const extras = shuffle(options);
  return shuffle([correct, ...extras.slice(0, Math.max(0, MAX - 1))]).slice(
    0,
    MAX
  );
};

// ============================================================================
// Quiz rules (copied from pyQuiz)
// ============================================================================

type DecompositionLevel = "shallow" | "normal" | "deep";

type RuleCtx = {
  root: TreeSitterAstNode;
  node: TreeSitterAstNode;
  code?: string;
  sourceRef: SourceRef;
  profile: DecompositionLevel;
};

type Q11 = QuizQuestion;

type Rule = (ctx: RuleCtx) => Q11[] | undefined;

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

const rules: Record<string, Rule[]> = {
  assignment: [
    ({ root, node, code, sourceRef }) => {
      const left = getSectionFirstItem(node, "target");
      const right = getSectionFirstItem(node, "value");
      if (!left || !right) return;
      const leftText =
        textForRange(left.startIndex, left.endIndex, code) || left.type;
      const rightText =
        textForRange(right.startIndex, right.endIndex, code) || right.type;
      return [
        {
          kind: "identify-field",
          stem: "What is the left-hand side (target) of this assignment?",
          answerLabel: leftText,
          options: buildDistractors(leftText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: left.type,
              start: left.startIndex,
              end: left.endIndex,
              path: computeAstPath(root, left),
            },
          ],
          generatorRule: "assignment.lhs",
        },
        {
          kind: "identify-field",
          stem: "What is the right-hand side (value) of this assignment?",
          answerLabel: rightText,
          options: buildDistractors(rightText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: right.type,
              start: right.startIndex,
              end: right.endIndex,
              path: computeAstPath(root, right),
            },
          ],
          generatorRule: "assignment.rhs",
        },
      ];
    },
  ],
  comparison_operator: [
    ({ root, node, code, sourceRef }) => {
      const left = getSectionFirstItem(node, "left");
      const comparators = getSectionItems(node, "comparators");
      if (!left || comparators.length === 0) return;
      const qs: Q11[] = [];
      const leftText =
        textForRange(left.startIndex, left.endIndex, code) || left.type;
      qs.push({
        kind: "identify-field",
        stem: "What is the left operand?",
        answerLabel: leftText,
        options: buildDistractors(leftText, { code }),
        sourceRefs: [
          sourceRef,
          {
            nodeType: left.type,
            start: left.startIndex,
            end: left.endIndex,
            path: computeAstPath(root, left),
          },
        ],
        generatorRule: "comparison.left",
      });
      // Track previous node for operator extraction
      let prev = left;
      for (let i = 0; i < comparators.length; i++) {
        const comp = comparators[i];
        const compText =
          textForRange(comp.startIndex, comp.endIndex, code) || comp.type;
        const op = extractOperatorBetween(code, prev.endIndex, comp.startIndex);
        if (op && op.length <= 6) {
          qs.push({
            kind: "operator",
            stem: `What is the operator #${i + 1}?`,
            answerLabel: op,
            options: buildDistractors(op, { code }),
            sourceRefs: [sourceRef],
            generatorRule: "comparison.op",
          });
        }
        qs.push({
          kind: "identify-field",
          stem: `What is comparator #${i + 1}?`,
          answerLabel: compText,
          options: buildDistractors(compText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: comp.type,
              start: comp.startIndex,
              end: comp.endIndex,
              path: computeAstPath(root, comp),
            },
          ],
          generatorRule: "comparison.comparator",
        });
        prev = comp;
      }
      return qs;
    },
  ],
  import_from_statement: [
    ({ root, node, code, sourceRef }) => {
      const sections = buildCuratedSections(node);
      const moduleGroup = sections.find((g) => g.key === "module");
      const moduleNode = moduleGroup?.items?.[0];
      const moduleText =
        moduleNode &&
        (textForRange(moduleNode.startIndex, moduleNode.endIndex, code) ||
          moduleNode.type);
      const namesGroup = sections.find((g) => g.key === "names");
      const items = namesGroup?.items || [];
      const correct = items
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const qs: Q11[] = [];
      if (moduleText && moduleNode) {
        const moduleRef: SourceRef = {
          nodeType: moduleNode.type,
          start: moduleNode.startIndex,
          end: moduleNode.endIndex,
          path: computeAstPath(root, moduleNode),
        };
        qs.push({
          kind: "import_from_module",
          stem: "What module is this import from?",
          answerLabel: moduleText,
          options: buildModuleOptionPool(moduleText, code, spanStart, spanEnd),
          sourceRefs: [sourceRef, moduleRef],
          generatorRule: "import_from.module",
        });
      }

      // Option pool mirrors the old pyQuiz multi-select behavior for imports.
      const optionPool = buildMultiSelectOptionPool(
        correct,
        code,
        spanStart,
        spanEnd
      );
      const firstStart = items.length
        ? items.reduce(
          (m, it) => Math.min(m, it.startIndex),
          items[0].startIndex
        )
        : undefined;
      const lastEnd = items.length
        ? items.reduce((m, it) => Math.max(m, it.endIndex), items[0].endIndex)
        : undefined;
      qs.push({
        kind: "imported_names_multi",
        stem: "Which names are imported?",
        answerLabel: correct[0] ?? "import",
        options: optionPool,
        sourceRefs: [sourceRef],
        generatorRule: "import_from.names",
        questionType: "multi",
        multiCorrect: correct,
        optionPool,
        revealStart: node.startIndex,
        // Match pyQuiz import reveal anchors (first name to last name).
        revealEndBeforeChild: firstStart,
        revealEndAfterChild: lastEnd,
      });
      return qs;
    },
  ],
  import_statement: [
    ({ node, code, sourceRef }) => {
      const sections = buildCuratedSections(node);
      const namesGroup = sections.find((g) => g.key === "names");
      const items = namesGroup?.items || [];
      const correct = items
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      // Option pool mirrors the old pyQuiz multi-select behavior for imports.
      const optionPool = buildMultiSelectOptionPool(
        correct,
        code,
        spanStart,
        spanEnd
      );
      const firstStart = items.length
        ? items.reduce(
          (m, it) => Math.min(m, it.startIndex),
          items[0].startIndex
        )
        : undefined;
      const lastEnd = items.length
        ? items.reduce((m, it) => Math.max(m, it.endIndex), items[0].endIndex)
        : undefined;
      return [
        {
          kind: "imported_names_multi",
          stem: "Which names are imported?",
          answerLabel: correct[0] ?? "import",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "import.names",
          questionType: "multi",
          multiCorrect: correct,
          optionPool,
          revealStart: node.startIndex,
          // Match pyQuiz import reveal anchors (first name to last name).
          revealEndBeforeChild: firstStart,
          revealEndAfterChild: lastEnd,
        },
      ];
    },
  ],
  dictionary: [
    ({ node, code, sourceRef }) => {
      const keyItems = getSectionItems(node, "keys");
      const keys: string[] = [];
      const keyNodes: { start: number; end: number }[] = [];
      for (const k of keyItems) {
        keys.push(textForRange(k.startIndex, k.endIndex, code) || k.type);
        keyNodes.push({ start: k.startIndex, end: k.endIndex });
      }
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const idPool: string[] = [];
      const strPool: string[] = [];
      try {
        const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
        const reStr = /(['"])((?:\\.|(?!\1).)*)\\1/g;
        const snippet = (code || "").slice(spanStart, spanEnd);
        let m: RegExpExecArray | null;
        while ((m = reId.exec(snippet))) idPool.push(m[0]);
        while ((m = reStr.exec(snippet))) if (m[2].trim()) strPool.push(m[2]);
      } catch { }
      let pool = Array.from(new Set<string>([...keys, ...idPool, ...strPool]));
      if (pool.length < 10) {
        const needed = 10 - pool.length;
        const pad = shuffle(GENERIC_DISTRACTORS)
          .filter((d) => !pool.includes(d))
          .slice(0, needed);
        pool.push(...pad);
      }
      const MAX = 10;
      const extras = shuffle(pool.filter((p) => !keys.includes(p)));
      const optionPool = shuffle([
        ...keys,
        ...extras.slice(0, Math.max(0, MAX - keys.length)),
      ]).slice(0, MAX);
      let revealStart: number | undefined = node.startIndex;
      let revealEndBeforeChild: number | undefined = undefined;
      let revealEndAfterChild: number | undefined = undefined;
      if (keyNodes.length > 0) {
        revealEndBeforeChild = keyNodes.reduce(
          (min, n) => Math.min(min, n.start),
          keyNodes[0].start
        );
        revealEndAfterChild = keyNodes.reduce(
          (max, n) => Math.max(max, n.end),
          keyNodes[0].end
        );
      }

      return [
        {
          kind: "dict-keys",
          stem: `Which keys are present in this dict?`,
          answerLabel: keys[0] ?? "dict",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "dict.keys",
          questionType: "multi",
          multiCorrect: keys,
          optionPool,
          revealStart,
          revealEndBeforeChild,
          revealEndAfterChild,
        },
      ];
    },
  ],
  call: [
    ({ root, node, code, sourceRef, profile }) => {
      const fnNode = getSectionFirstItem(node, "func");
      const args = getSectionItems(node, "args");
      const keywords = getSectionItems(node, "keywords");
      const fnText = fnNode
        ? textForRange(fnNode.startIndex, fnNode.endIndex, code) || fnNode.type
        : "call";
      const qs: Q11[] = [
        {
          kind: "call-func",
          stem: "Which function or method is being called here?",
          answerLabel: fnText,
          options: buildDistractors(fnText, { code }),
          sourceRefs: [sourceRef],
          generatorRule: "call.func",
        },
      ];
      if (profile !== "shallow") {
        // Positional arguments
        args.forEach((a, idx) => {
          const argText =
            textForRange(a.startIndex, a.endIndex, code) || a.type;
          qs.push({
            kind: "call-arg-positional",
            stem: `What is positional argument #${idx + 1}?`,
            answerLabel: argText,
            options: buildDistractors(argText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: a.type,
                start: a.startIndex,
                end: a.endIndex,
                path: computeAstPath(root, a),
              },
            ],
            generatorRule: "call.pos-arg",
          });
        });
        // Keyword arguments
        for (const kw of keywords) {
          const nameNode = (kw.namedChildren || [])[0];
          const nameText =
            nameNode &&
            textForRange(nameNode.startIndex, nameNode.endIndex, code);
          if (nameText) {
            qs.push({
              kind: "call-arg-keyword",
              stem: `What is this keyword argument name?`,
              answerLabel: nameText,
              options: buildDistractors(nameText, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: kw.type,
                  start: kw.startIndex,
                  end: kw.endIndex,
                  path: computeAstPath(root, kw),
                },
              ],
              generatorRule: "call.kwarg-name",
            });
          }
        }
      }
      return qs;
    },
  ],
  attribute: [
    ({ node, code, sourceRef, profile }) => {
      if (profile === "shallow") return;
      const chain = extractCallChain(node, code);
      if (chain.length <= 1) return;
      const qs: Q11[] = [];
      chain.forEach((link, i) => {
        if (link.kind === "call" && link.name) {
          qs.push({
            kind: "chain-method-name",
            stem: `What is the name of method #${i + 1} in this chain?`,
            answerLabel: link.name,
            options: buildDistractors(link.name, { code }),
            sourceRefs: [sourceRef],
            generatorRule: "chain.method-name",
          });
        }
      });
      return qs;
    },
  ],
  binary_operator: [
    ({ root, node, code, sourceRef }) => {
      const left = getSectionFirstItem(node, "left");
      const right = getSectionFirstItem(node, "right");
      if (!left || !right) return;
      const leftText =
        textForRange(left.startIndex, left.endIndex, code) || left.type;
      const rightText =
        textForRange(right.startIndex, right.endIndex, code) || right.type;
      const op = extractOperatorBetween(code, left.endIndex, right.startIndex);
      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the left operand?",
          answerLabel: leftText,
          options: buildDistractors(leftText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: left.type,
              start: left.startIndex,
              end: left.endIndex,
              path: computeAstPath(root, left),
            },
          ],
          generatorRule: "binary.left",
        },
        {
          kind: "identify-field",
          stem: "What is the right operand?",
          answerLabel: rightText,
          options: buildDistractors(rightText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: right.type,
              start: right.startIndex,
              end: right.endIndex,
              path: computeAstPath(root, right),
            },
          ],
          generatorRule: "binary.right",
        },
      ];
      if (op && op.length <= 6) {
        qs.unshift({
          kind: "operator",
          stem: "What operator is used here?",
          answerLabel: op,
          options: buildDistractors(op, { code }),
          sourceRefs: [sourceRef],
          generatorRule: "binary.op",
        });
      }
      return qs;
    },
  ],
  subscript: [
    ({ root, node, code, sourceRef }) => {
      const valueNode = getSectionFirstItem(node, "value");
      // pyCuration exposes slice OR index depending on content
      const sliceNode = getSectionFirstItem(node, "slice");
      const indexNode = getSectionFirstItem(node, "index");
      const second = sliceNode || indexNode;
      if (!valueNode) return;
      const valueText =
        textForRange(valueNode.startIndex, valueNode.endIndex, code) ||
        valueNode.type;
      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the base being indexed?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: valueNode.type,
              start: valueNode.startIndex,
              end: valueNode.endIndex,
              path: computeAstPath(root, valueNode),
            },
          ],
          generatorRule: "subscript.base",
        },
      ];
      if (second) {
        if (sliceNode && sliceNode.type === "slice") {
          // Use slice sections for start/stop/step
          const startItem = getSectionFirstItem(sliceNode, "start");
          const stopItem = getSectionFirstItem(sliceNode, "stop");
          const stepItem = getSectionFirstItem(sliceNode, "step");
          const parts = [startItem, stopItem, stepItem].filter(Boolean) as TreeSitterAstNode[];
          const labels = ["start", "stop", "step"] as const;
          parts.forEach((p, idx) => {
            const txt = textForRange(p.startIndex, p.endIndex, code) || p.type;
            qs.push({
              kind: "identify-field",
              stem: `What is the ${labels[idx]} of this slice?`,
              answerLabel: txt,
              options: buildDistractors(txt, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: p.type,
                  start: p.startIndex,
                  end: p.endIndex,
                  path: computeAstPath(root, p),
                },
              ],
              generatorRule: `slice.${labels[idx]}`,
            });
          });
        } else {
          const idxText =
            textForRange(second.startIndex, second.endIndex, code) ||
            second.type;
          qs.push({
            kind: "identify-field",
            stem: "What is the index?",
            answerLabel: idxText,
            options: buildDistractors(idxText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: second.type,
                start: second.startIndex,
                end: second.endIndex,
                path: computeAstPath(root, second),
              },
            ],
            generatorRule: "subscript.index",
          });
        }
      }
      return qs;
    },
  ],
  slice: [
    ({ root, node, code, sourceRef }) => {
      const startItem = getSectionFirstItem(node, "start");
      const stopItem = getSectionFirstItem(node, "stop");
      const stepItem = getSectionFirstItem(node, "step");
      const parts = [startItem, stopItem, stepItem].filter(Boolean) as TreeSitterAstNode[];
      if (parts.length === 0) return;
      const qs: Q11[] = [];
      const labels = ["start", "stop", "step"] as const;
      parts.forEach((p, idx) => {
        const txt = textForRange(p.startIndex, p.endIndex, code) || p.type;
        qs.push({
          kind: "identify-field",
          stem: `What is the ${labels[idx]} of this slice?`,
          answerLabel: txt,
          options: buildDistractors(txt, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: p.type,
              start: p.startIndex,
              end: p.endIndex,
              path: computeAstPath(root, p),
            },
          ],
          generatorRule: `slice.${labels[idx]}`,
        });
      });
      return qs;
    },
  ],
  function_definition: [
    ({ root, node, code, sourceRef, profile }) => {
      const params = getSectionItems(node, "args");
      const qs: Q11[] = [];
      const names: string[] = [];
      for (const p of params) {
        const nameNode = (p.namedChildren || []).find(
          (c) => c.type === "identifier"
        );
        if (nameNode) {
          const nameText =
            textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
            "param";
          names.push(nameText);
        } else {
          const raw =
            textForRange(p.startIndex, p.endIndex, code) || p.type || "param";
          names.push(raw);
        }
      }
      if (names.length > 0) {
        const block = getSectionFirstItem(node, "body");
        const spanStart = block ? block.startIndex : node.startIndex;
        const spanEnd = block ? block.endIndex : node.endIndex;
        const optionPool = buildMultiSelectOptionPool(
          names,
          code,
          spanStart,
          spanEnd
        );
        const firstParamStart = params.length
          ? params.reduce(
            (m, it) => Math.min(m, it.startIndex),
            params[0].startIndex
          )
          : undefined;
        const lastParamEnd = params.length
          ? params.reduce(
            (m, it) => Math.max(m, it.endIndex),
            params[0].endIndex
          )
          : undefined;
        qs.push({
          kind: "function_params_multi",
          stem: "Which of the following are parameters of this function?",
          answerLabel: names[0] ?? "param",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "func.params-multi",
          questionType: "multi",
          multiCorrect: names,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: firstParamStart,
          revealEndAfterChild: lastParamEnd,
        });
      }
      if (profile !== "shallow") {
        const ret = getSectionFirstItem(node, "returns");
        if (ret) {
          const retText =
            textForRange(ret.startIndex, ret.endIndex, code) || ret.type;
          qs.push({
            kind: "return-type",
            stem: "What is the return type of this function?",
            answerLabel: retText,
            options: buildDistractors(retText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: ret.type,
                start: ret.startIndex,
                end: ret.endIndex,
                path: computeAstPath(root, ret),
              },
            ],
            generatorRule: "func.return-type",
          });
        }
      }
      return qs;
    },
  ],
  if_statement: [headerRule],
  elif_clause: [headerRule],
  else_clause: [headerRule],
  while_statement: [headerRule],
  for_statement: [headerRule],
  with_statement: [headerRule],
  try_statement: [headerRule],
  except_clause: [headerRule],
  finally_clause: [headerRule],
  match_statement: [headerRule],
  match_stmt: [headerRule],
  case_clause: [headerRule],
  case_block: [headerRule],
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
  for (const rule of applyRules) {
    const qs = rule({ root, node, code, sourceRef: src, profile });
    if (qs && qs.length) return qs;
  }
  return [];
}

// ============================================================================
// Grouping Logic (Ported from pyLesson.ts)
// ============================================================================

type PyCategory =
  | "import"
  | "definition"
  | "type"
  | "constants"
  | "configuration"
  | "main"
  | "logic";

function getSemanticCategory(node: TreeSitterAstNode): PyCategory {
  switch (node.type) {
    case "import_statement":
    case "import_from_statement":
      return "import";
    case "type_alias_statement":
    case "type_alias":
      return "type";
    case "class_definition":
    case "function_definition":
    case "decorated_definition":
      return "definition";
    case "if_statement":
      return "logic";
    default:
      return "logic";
  }
}

function generateGroupPrompt(category: PyCategory, count: number): string {
  switch (category) {
    case "import":
      return `This file starts with ${count} import statement(s).`;
    case "definition":
      return `Next, we have a block of ${count} definition(s).`;
    case "type":
      return `There are ${count} type definition(s).`;
    case "constants":
      return `A block of ${count} constant definition(s).`;
    case "configuration":
      return `A configuration block with ${count} statement(s).`;
    case "main":
      return `This is the main execution block.`;
    case "logic":
    default:
      return `Here is a block of application logic consisting of ${count} statement(s).`;
  }
}

function createGroupStep(
  root: TreeSitterAstNode,
  nodes: TreeSitterAstNode[],
  category: PyCategory,
  code: string,
  options: EngineOptions
): EngineStep {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const virtualNode = {
    ...first,
    type: "group",
    startIndex: first.startIndex,
    endIndex: last.endIndex,
    isVirtual: true,
  };

  // Recursively generate steps for children, but disable further grouping
  const childSteps = nodes.flatMap((n) =>
    generateEngineSteps(root, n, code, { ...options, __noGroup: true })
  );

  return {
    id: randomString(8),
    node: virtualNode,
    displaySpan: { start: virtualNode.startIndex, end: virtualNode.endIndex },
    lesson: {
      semanticRole: `group:${category}`,
      prompt: generateGroupPrompt(category, nodes.length),
      isDigable: childSteps.length > 0,
      childSteps,
    },
  };
}

function groupTopLevelNodes(
  root: TreeSitterAstNode,
  topLevelNodes: TreeSitterAstNode[],
  code: string,
  options: EngineOptions
): EngineStep[] {
  const nodes = topLevelNodes.filter(isAnchorNode);
  if (!nodes.length) return [];
  const out: EngineStep[] = [];
  let currentCategory: PyCategory | null = null;
  let currentGroup: TreeSitterAstNode[] = [];

  for (const n of nodes) {
    const cat = getSemanticCategory(n);
    if (currentCategory && cat === currentCategory) {
      currentGroup.push(n);
    } else {
      if (currentGroup.length) {
        out.push(createGroupStep(root, currentGroup, currentCategory!, code, options));
      }
      currentCategory = cat;
      currentGroup = [n];
    }
  }
  if (currentGroup.length) {
    out.push(createGroupStep(root, currentGroup, currentCategory!, code, options));
  }
  return out;
}

// ============================================================================
// Statement Anchors
// ============================================================================

const ANCHOR_NODE_TYPES = new Set<string>([
  "assignment",
  "augmented_assignment",
  "class_definition",
  "function_definition",
  "decorated_definition",
  "elif_clause",
  "else_clause",
  "except_clause",
  "finally_clause",
  "match_statement",
  "match_stmt",
  "case_clause",
  "case_block",
  "type_alias",
  "type_alias_statement",
]);

export const isAnchorNode = (node: TreeSitterAstNode): boolean => {
  if (ANCHOR_NODE_TYPES.has(node.type)) return true;
  if (node.type.endsWith("_statement")) return true;
  return false;
};

const getStatementChildren = (node: TreeSitterAstNode): TreeSitterAstNode[] =>
  (node.namedChildren || []).filter(
    (c) => c.type !== "comment" && !isDocstringNode(c, node)
  );

const BODY_NODE_TYPES = new Set(["block", "suite"]);

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
    Number.isFinite(q.revealEndAfterChild) &&
    q.revealEndAfterChild >= q.revealEndBeforeChild
  ) {
    return {
      start: q.revealEndBeforeChild,
      end: q.revealEndAfterChild,
    };
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

const applyQuestionOverlapGuard = (steps: EngineStep[]): void => {
  const entries: Array<{
    question: QuizQuestion;
    span: { start: number; end: number };
    isHeader: boolean;
  }> = [];

  const collect = (step: EngineStep) => {
    if (step.quiz?.questions?.length) {
      for (const q of step.quiz.questions) {
        const span = spanForQuestion(q);
        if (!span) continue;
        entries.push({
          question: q,
          span,
          isHeader: isHeaderQuestion(q),
        });
      }
    }
    const children = step.lesson?.childSteps || [];
    if (children.length) children.forEach(collect);
  };

  steps.forEach(collect);
  if (!entries.length) return;

  const sorted = entries.slice().sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    if (lenA !== lenB) return lenA - lenB;
    return a.span.start - b.span.start;
  });

  const kept: typeof entries = [];
  const drop = new Set<QuizQuestion>();

  for (const entry of sorted) {
    const isDuplicate = kept.some(
      (k) =>
        k.span.start === entry.span.start &&
        k.span.end === entry.span.end &&
        k.question.stem === entry.question.stem &&
        k.question.answerLabel === entry.question.answerLabel
    );
    if (isDuplicate) {
      drop.add(entry.question);
      continue;
    }
    if (!entry.isHeader) {
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
  "import_from_statement",
  "import_statement",
  "function_definition",
  "class_definition",
  "if_statement",
  "elif_clause",
  "else_clause",
  "while_statement",
  "for_statement",
  "with_statement",
  "try_statement",
  "except_clause",
  "finally_clause",
  "match_statement",
  "match_stmt",
  "case_clause",
  "case_block",
]);

// ============================================================================
// Main Walker
// ============================================================================

export const generateEngineSteps = (
  root: TreeSitterAstNode, // Root of the entire file (for context)
  node: TreeSitterAstNode, // Current node to process
  code: string,
  options: EngineOptions
): EngineStep[] => {
  const steps: EngineStep[] = [];
  const mappedProfile: DecompositionLevel =
    options.profile === "deep" ? "deep" : "shallow";

  const buildQuestionsForAnchor = (anchor: TreeSitterAstNode): QuizQuestion[] => {
    if (options.generateQuiz === false) return [];
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
        const sections = buildCuratedSections(anchor);
        const namesGroup = sections.find((g) => g.key === "names");
        const names = (namesGroup?.items || [])
          .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
          .filter(Boolean);
        const nameText = names.length ? names.join(", ") : "module(s)";
        return {
          prompt: `We import ${nameText}.`,
          semanticRole: "import_statement",
          isDigable: false,
        };
      }

      case "import_from_statement": {
        const sections = buildCuratedSections(anchor);
        const moduleGroup = sections.find((g) => g.key === "module");
        const moduleNode = moduleGroup?.items?.[0];
        const moduleText =
          moduleNode &&
          (textForRange(moduleNode.startIndex, moduleNode.endIndex, code) ||
            moduleNode.type);
        const namesGroup = sections.find((g) => g.key === "names");
        const names = (namesGroup?.items || [])
          .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
          .filter(Boolean);
        let prompt = "We import from another module.";
        if (names.length && moduleText) {
          prompt = `We import ${names.join(", ")} from ${moduleText}.`;
        } else if (moduleText) {
          prompt = `We import from ${moduleText}.`;
        } else if (names.length) {
          prompt = `We import ${names.join(", ")}.`;
        }
        return {
          prompt,
          semanticRole: "import_from_statement",
          isDigable: false,
        };
      }

      case "class_definition": {
        const name = firstChildOfType(anchor, "identifier");
        const nameText = name ? textForNode(name, code) : "class";
        return {
          prompt: `We define a class named: ${nameText}`,
          semanticRole: "class_definition",
          isDigable: hasChildStatements,
        };
      }

      case "function_definition": {
        const name = firstChildOfType(anchor, "identifier");
        const nameText = name ? textForNode(name, code) : "function";
        return {
          prompt: `We define a function named: ${nameText}`,
          semanticRole: "function_definition",
          isDigable: hasChildStatements,
        };
      }

      case "decorated_definition": {
        const innerFn = firstChildOfType(anchor, "function_definition");
        const innerClass = firstChildOfType(anchor, "class_definition");
        const defNode = innerFn || innerClass;
        const nameNode = defNode
          ? firstChildOfType(defNode, "identifier")
          : firstChildOfType(anchor, "identifier");
        let prompt = "We define a decorated definition.";
        if (defNode) {
          const kind = innerClass ? "class" : "function";
          const nameText = nameNode
            ? textForNode(nameNode, code)
            : kind;
          prompt = `We define a ${kind} named: ${nameText}`;
        }
        return {
          prompt,
          semanticRole: "decorated_definition",
          isDigable: hasChildStatements,
        };
      }

      case "if_statement": {
        return {
          prompt: "An if statement checks a condition.",
          semanticRole: "if_statement",
          isDigable: hasChildStatements,
        };
      }

      case "while_statement": {
        return {
          prompt: "A while loop runs as long as the condition is true.",
          semanticRole: "while_statement",
          isDigable: hasChildStatements,
        };
      }

      case "for_statement": {
        return {
          prompt: "A for loop iterates over a sequence.",
          semanticRole: "for_statement",
          isDigable: hasChildStatements,
        };
      }

      case "assignment": {
        return {
          prompt: "An assignment statement stores a value.",
          semanticRole: "assignment",
          isDigable: false,
        };
      }

      case "augmented_assignment": {
        return {
          prompt: "An augmented assignment updates a value.",
          semanticRole: "augmented_assignment",
          isDigable: false,
        };
      }

      default: {
        const label = anchor.type.replace(/_/g, " ");
        if (hasQuestions) {
          return {
            prompt: `Analyze this ${label}.`,
            semanticRole: anchor.type,
            isDigable: hasChildStatements,
          };
        }
        const prompt = anchor.type.endsWith("_statement")
          ? `Next, we have a ${anchor.type.replace("_statement", "")} statement.`
          : `Next, we have a ${label}.`;
        return {
          prompt,
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      }
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

  const blockHasStatements = (block?: TreeSitterAstNode) =>
    Boolean(block && getStatementChildren(block).some(isAnchorNode));

  const clauseHasStatements = (clause?: TreeSitterAstNode) =>
    Boolean(clause && blockHasStatements(firstChildOfType(clause, "block")));

  const walkModule = (mod: TreeSitterAstNode) => {
    for (const stmt of getStatementChildren(mod)) {
      if (isAnchorNode(stmt)) walkStmt(stmt);
    }
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    for (const stmt of getStatementChildren(block)) {
      if (isAnchorNode(stmt)) walkStmt(stmt);
    }
  };

  const walkStmt = (stmt: TreeSitterAstNode) => {
    if (!isAnchorNode(stmt)) return;
    switch (stmt.type) {
      case "function_definition":
      case "class_definition": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "decorated_definition": {
        const innerDef =
          firstChildOfType(stmt, "function_definition") ||
          firstChildOfType(stmt, "class_definition");
        const block = innerDef
          ? firstChildOfType(innerDef, "block")
          : firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "if_statement": {
        const block = firstChildOfType(stmt, "block");
        const elifs = childrenOfType(stmt, "elif_clause");
        const elseCl = firstChildOfType(stmt, "else_clause");
        const hasChildStatements =
          blockHasStatements(block) ||
          elifs.some((e) => clauseHasStatements(e)) ||
          clauseHasStatements(elseCl);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        for (const e of elifs) walkStmt(e);
        if (elseCl) walkStmt(elseCl);
        break;
      }
      case "elif_clause":
      case "else_clause": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "while_statement":
      case "for_statement": {
        const block = firstChildOfType(stmt, "block");
        const elseCl = firstChildOfType(stmt, "else_clause");
        const hasChildStatements =
          blockHasStatements(block) || clauseHasStatements(elseCl);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        if (elseCl) walkStmt(elseCl);
        break;
      }
      case "with_statement": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "try_statement": {
        const body = firstChildOfType(stmt, "block");
        const excepts = (stmt.namedChildren || []).filter((c) =>
          c.type.includes("except")
        );
        const elseCl = firstChildOfType(stmt, "else_clause");
        const finCl = firstChildOfType(stmt, "finally_clause");
        const hasChildStatements =
          blockHasStatements(body) ||
          excepts.some((c) => clauseHasStatements(c)) ||
          clauseHasStatements(elseCl) ||
          clauseHasStatements(finCl);
        emitAnchorStep(stmt, hasChildStatements);
        if (body) walkBlock(body);
        for (const h of excepts) walkStmt(h);
        if (elseCl) walkStmt(elseCl);
        if (finCl) walkStmt(finCl);
        break;
      }
      case "except_clause":
      case "finally_clause": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "match_statement":
      case "match_stmt": {
        const cases = (stmt.namedChildren || []).filter(
          (c) => c.type === "case_clause" || c.type === "case_block"
        );
        const hasChildStatements = cases.some((c) => clauseHasStatements(c));
        emitAnchorStep(stmt, hasChildStatements);
        for (const c of cases) walkStmt(c);
        break;
      }
      case "case_clause":
      case "case_block": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      default: {
        emitAnchorStep(stmt, false);
        break;
      }
    }
  };

  const finalizeSteps = (out: EngineStep[]): EngineStep[] => {
    if (options.generateQuiz !== false) applyQuestionOverlapGuard(out);
    return out;
  };

  if (node.type === "module" && !options.__noGroup) {
    const children = getStatementChildren(node).filter(isAnchorNode);
    const enableGrouping =
      options.grouping === "auto"
        ? children.length >= 12 || code.length >= 5000
        : options.grouping;

    if (enableGrouping) {
      return finalizeSteps(groupTopLevelNodes(root, children, code, options));
    }
  }

  if (node.type === "module") {
    walkModule(node);
    return finalizeSteps(steps);
  }
  if (node.type === "block") {
    walkBlock(node);
    return finalizeSteps(steps);
  }
  walkStmt(node);
  return finalizeSteps(steps);
};

// ============================================================================
// Masking & Payload Helpers (Ported from pyLesson.ts / pyQuiz.ts)
// ============================================================================

export type MaskRange = { start: number; end: number };

function findEnclosingByTypes(
  root: TreeSitterAstNode,
  target: TreeSitterAstNode,
  types: string[]
): TreeSitterAstNode | undefined {
  let found: TreeSitterAstNode | undefined;
  const walk = (n: TreeSitterAstNode) => {
    const kids = n.namedChildren || [];
    for (const c of kids) {
      if (c.startIndex <= target.startIndex && c.endIndex >= target.endIndex) {
        if (types.includes(c.type)) found = c;
        walk(c);
      }
    }
  };
  walk(root);
  return found;
}

function headerMaskAndAnswer(
  stmt: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  const nonStructural = new Set([
    "block",
    "else_clause",
    "elif_clause",
    "finally_clause",
    "except_clause",
  ]);
  const firstNamed = (stmt.namedChildren || []).find(
    (c) => !nonStructural.has(c.type)
  );
  const maskStart = stmt.startIndex;
  const maskEnd = firstNamed ? firstNamed.startIndex : stmt.startIndex;

  const answerText = headerAnswer(stmt, code);

  const masks = maskEnd > maskStart ? [{ start: maskStart, end: maskEnd }] : [];
  return { masks, answerText };
}

export function maskAndAnswerForStep(
  step: EngineStep,
  root: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  if ((step.node as any).isVirtual || step.node.type === "group") {
    return { masks: [], answerText: textForNode(step.node, code) };
  }
  const headerTypes = [
    "if_statement",
    "elif_clause",
    "else_clause",
    "while_statement",
    "for_statement",
    "with_statement",
    "try_statement",
    "except_clause",
    "finally_clause",
    "match_statement",
    "match_stmt",
    "case_clause",
    "case_block",
  ];
  const role = step.lesson?.semanticRole;
  const isHeaderNode = headerTypes.includes(step.node.type);

  if (role === "if_condition" || role === "loop_condition" || isHeaderNode) {
    const stmt = isHeaderNode
      ? step.node
      : findEnclosingByTypes(root, step.node, headerTypes);
    if (stmt) {
      return headerMaskAndAnswer(stmt, code);
    }
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
  questionType?: "single" | "multi";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  sourceRef?: SourceRef;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
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
      sourceRef: bestSourceRef(q),
      revealStart: q.revealStart,
      revealEndBeforeChild: q.revealEndBeforeChild,
      revealEndAfterChild: q.revealEndAfterChild,
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
    profile: "normal" as const,
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
