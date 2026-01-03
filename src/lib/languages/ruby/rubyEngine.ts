import type { TreeSitterAstNode } from "../../treeSitter";
import {
  childrenOfType,
  firstChildOfType,
  childByField,
  buildCuratedSections,
  getSectionItems,
  getSectionFirstItem,
  getRevealAnchors,
  getSectionSpan,
} from "./rubyCuration";
import { randomString } from "../../utils";

// ======================================================================
// Types
// ======================================================================

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

// ======================================================================
// Helpers
// ======================================================================

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
  )
    return code.slice(start, end);
  return undefined;
};

const headerAnswer = (stmt: TreeSitterAstNode, code?: string): string => {
  if (!code) return stmt.type;
  const { headerEnd } = getRevealAnchors(stmt);
  return code.slice(stmt.startIndex, headerEnd).trimEnd();
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

function buildDistractors(correct: string): string[] {
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
    const reId = /[A-Za-z_][A-Za-z0-9_?!]*/g;
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

// ======================================================================
// Ruby-specific extraction helpers
// ======================================================================

const CALL_NODE_TYPES = new Set([
  "call",
  "command",
  "command_call",
  "method_call",
]);

const normalizeParamText = (raw: string) =>
  raw.replace(/\s+/g, " ").replace(/,+$/, "").trim();

const stripOuterParens = (raw: string) =>
  raw.replace(/^\(/, "").replace(/\)$/, "").trim();

const extractCallParts = (
  node: TreeSitterAstNode,
  code?: string
): {
  name?: string;
  nameNode?: TreeSitterAstNode;
  receiverNode?: TreeSitterAstNode;
  args: TreeSitterAstNode[];
} => {
  const nameNode =
    childByField(node, "method") ||
    childByField(node, "name") ||
    childByField(node, "message") ||
    firstChildOfType(node, "identifier") ||
    firstChildOfType(node, "constant");
  const receiverNode =
    childByField(node, "receiver") || childByField(node, "object");
  const argsNode =
    childByField(node, "arguments") ||
    firstChildOfType(node, "argument_list") ||
    firstChildOfType(node, "argument_list_with_parentheses") ||
    firstChildOfType(node, "command_argument_list") ||
    firstChildOfType(node, "arguments");
  let args = argsNode ? argsNode.namedChildren || [] : [];
  if (!argsNode) {
    const skip = new Set<TreeSitterAstNode>();
    if (nameNode) skip.add(nameNode);
    if (receiverNode) skip.add(receiverNode);
    args = (node.namedChildren || []).filter((c) => !skip.has(c));
  }
  let name = nameNode
    ? textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
    : undefined;
  if (!name && code) {
    const snippet = textForRange(node.startIndex, node.endIndex, code) || "";
    const receiverMatch = snippet.match(
      /(?:\.|::)\s*([A-Za-z_][A-Za-z0-9_?!]*)/
    );
    if (receiverMatch) {
      name = receiverMatch[1];
    } else {
      const firstWord = snippet.trim().match(/^[A-Za-z_][A-Za-z0-9_?!]*/);
      if (firstWord) name = firstWord[0];
    }
  }
  return { name, nameNode, receiverNode, args };
};

type CallChainSegment = {
  segmentType: "base" | "field" | "args";
  text: string;
  node: TreeSitterAstNode;
};

const decomposeCallChain = (
  node: TreeSitterAstNode,
  code?: string
): CallChainSegment[] => {
  const segments: CallChainSegment[] = [];
  const walk = (n: TreeSitterAstNode | undefined) => {
    if (!n) return;
    if (CALL_NODE_TYPES.has(n.type)) {
      const { name, nameNode, receiverNode, args } = extractCallParts(n, code);
      if (receiverNode) walk(receiverNode);
      const text =
        name ||
        (nameNode &&
          textForRange(nameNode.startIndex, nameNode.endIndex, code)) ||
        textForRange(n.startIndex, n.endIndex, code) ||
        n.type;
      segments.push({
        text,
        segmentType: receiverNode ? "field" : "base",
        node: nameNode || n,
      });
      if (args.length > 0) {
        segments.push({
          text: "()",
          segmentType: "args",
          node: n,
        });
      }
      return;
    }
    const text = textForRange(n.startIndex, n.endIndex, code) || n.type;
    segments.push({ text, segmentType: "base", node: n });
  };

  walk(node);
  return segments;
};

const extractStringLiteral = (node: TreeSitterAstNode, code: string) => {
  const raw = textForRange(node.startIndex, node.endIndex, code)?.trim();
  if (!raw) return undefined;
  const quoteMatch = raw.match(/^(['"])([\s\S]*)\1$/);
  if (quoteMatch) return quoteMatch[2];
  if (node.type.toLowerCase().includes("string")) {
    return raw.replace(/^['"]|['"]$/g, "");
  }
  return undefined;
};

const extractParamInfo = (
  paramsNode: TreeSitterAstNode | undefined,
  code: string
): {
  all: string[];
  keywordParams: string[];
  defaults: Array<{ name: string; value: string; node: TreeSitterAstNode }>;
} => {
  if (!paramsNode) return { all: [], keywordParams: [], defaults: [] };
  const params = paramsNode.namedChildren || [];
  const all: string[] = [];
  const keywordParams: string[] = [];
  const defaults: Array<{ name: string; value: string; node: TreeSitterAstNode }> = [];

  params.forEach((p) => {
    const rawText = textForRange(p.startIndex, p.endIndex, code) || "";
    let raw = normalizeParamText(stripOuterParens(rawText));
    if (!raw || raw === "*") return;

    const kwMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_?!]*)\s*:(.*)$/);
    if (kwMatch) {
      const name = kwMatch[1];
      const rhs = kwMatch[2].trim();
      if (rhs) defaults.push({ name, value: rhs, node: p });
      keywordParams.push(name);
      all.push(name);
      return;
    }

    let prefix = "";
    if (raw.startsWith("**")) {
      prefix = "**";
      raw = raw.slice(2).trim();
    } else if (raw.startsWith("*")) {
      prefix = "*";
      raw = raw.slice(1).trim();
    } else if (raw.startsWith("&")) {
      prefix = "&";
      raw = raw.slice(1).trim();
    }

    const defaultParts = raw.split("=");
    const name = defaultParts[0].trim().replace(/,+$/, "");
    if (!name) return;
    const fullName = prefix ? `${prefix}${name}` : name;
    all.push(fullName);

    if (prefix.startsWith("**") || kwMatch) {
      keywordParams.push(fullName);
    }

    if (defaultParts.length > 1) {
      const value = defaultParts.slice(1).join("=").trim();
      if (value) defaults.push({ name, value, node: p });
    }
  });

  return { all, keywordParams, defaults };
};

const REQUIRE_METHODS = new Set(["require", "require_relative", "load"]);

const requireKindForNode = (node: TreeSitterAstNode, code: string) => {
  if (!CALL_NODE_TYPES.has(node.type)) return undefined;
  const { name } = extractCallParts(node, code);
  if (name && REQUIRE_METHODS.has(name)) return name;
  const snippet = textForRange(node.startIndex, node.endIndex, code) || "";
  const match = snippet.trim().match(/^(require_relative|require|load)\b/);
  return match ? match[1] : undefined;
};

const requireArgsForNode = (
  node: TreeSitterAstNode,
  code: string,
  profile: "shallow" | "deep"
): string[] => {
  const { args } = extractCallParts(node, code);
  const out: string[] = [];
  args.forEach((arg) => {
    const literal = extractStringLiteral(arg, code);
    if (literal) out.push(literal);
    else if (profile === "deep") {
      const raw = textForRange(arg.startIndex, arg.endIndex, code)?.trim();
      if (raw) out.push(raw);
    }
  });
  return out;
};

// ======================================================================
// Quiz rule generation
// ======================================================================

type DecompositionLevel = "shallow" | "deep";

type RuleCtx = {
  root: TreeSitterAstNode;
  node: TreeSitterAstNode;
  code: string;
  sourceRef: SourceRef;
  profile: DecompositionLevel;
};

const headerQuestion = (
  node: TreeSitterAstNode,
  sourceRef: SourceRef,
  code: string
): QuizQuestion => {
  const span = headerSpanByAst(node);
  return {
    kind: node.type,
    stem: "Write the full header line",
    answerLabel: headerAnswer(node, code),
    options: [],
    sourceRefs: [sourceRef],
    generatorRule: "header.line",
    revealEndBeforeChild: span.start,
    revealEndAfterChild: span.end,
  };
};

const singleQuestion = (
  stem: string,
  answerLabel: string,
  sourceRefs: SourceRef[],
  generatorRule: string
): QuizQuestion => ({
  kind: generatorRule,
  stem,
  answerLabel,
  options: buildDistractors(answerLabel),
  sourceRefs,
  generatorRule,
});

const multiQuestion = (
  stem: string,
  answers: string[],
  sourceRef: SourceRef,
  generatorRule: string,
  code: string,
  spanStart: number,
  spanEnd: number,
  extra?: Partial<QuizQuestion>
): QuizQuestion => {
  const unique = Array.from(new Set(answers));
  const optionPool = buildMultiSelectOptionPool(unique, code, spanStart, spanEnd);
  return {
    kind: generatorRule,
    stem,
    answerLabel: unique[0] ?? "item",
    options: optionPool,
    sourceRefs: [sourceRef],
    generatorRule,
    questionType: "multi",
    multiCorrect: unique,
    optionPool,
    ...extra,
  };
};

const generateQuestionsForAnchor = ({
  root,
  node,
  code,
  sourceRef,
  profile,
}: RuleCtx): QuizQuestion[] => {
  const qs: QuizQuestion[] = [];

  switch (node.type) {
    case "class":
    case "module":
    case "singleton_class": {
      qs.push(headerQuestion(node, sourceRef, code));
      const nameNode = getSectionFirstItem(node, "name");
      const nameText =
        nameNode && (textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type);
      if (nameText) {
        qs.push(
          singleQuestion(
            node.type === "module" ? "What is the module name?" : "What is the class name?",
            nameText,
            [
              sourceRef,
              {
                nodeType: nameNode.type,
                start: nameNode.startIndex,
                end: nameNode.endIndex,
                path: computeAstPath(root, nameNode),
              },
            ],
            `${node.type}.name`
          )
        );
      }
      if (node.type === "class") {
        const superclass = getSectionFirstItem(node, "superclass");
        if (superclass) {
          const superText =
            textForRange(superclass.startIndex, superclass.endIndex, code) ||
            superclass.type;
          qs.push(
            singleQuestion(
              "What does this class inherit from?",
              superText,
              [
                sourceRef,
                {
                  nodeType: superclass.type,
                  start: superclass.startIndex,
                  end: superclass.endIndex,
                  path: computeAstPath(root, superclass),
                },
              ],
              "class.superclass"
            )
          );
        }
      }
      if (profile === "deep") {
        const body = getSectionFirstItem(node, "body");
        if (body) {
          const statements = (body.namedChildren || []).filter(
            (c) => c.type !== "comment"
          );
          const includes: string[] = [];
          const extendsMods: string[] = [];
          for (const stmt of statements) {
            if (!CALL_NODE_TYPES.has(stmt.type)) break;
            const call = extractCallParts(stmt, code);
            if (!call.name || (call.name !== "include" && call.name !== "extend"))
              break;
            const args = call.args
              .map((a) => textForRange(a.startIndex, a.endIndex, code) || "")
              .map((t) => t.trim())
              .filter(Boolean);
            if (call.name === "include") includes.push(...args);
            if (call.name === "extend") extendsMods.push(...args);
          }
          if (includes.length > 0) {
            qs.push(
              multiQuestion(
                "Which modules are included?",
                includes,
                sourceRef,
                "class.include",
                code,
                body.startIndex,
                body.endIndex
              )
            );
          }
          if (extendsMods.length > 0) {
            qs.push(
              multiQuestion(
                "Which modules are extended?",
                extendsMods,
                sourceRef,
                "class.extend",
                code,
                body.startIndex,
                body.endIndex
              )
            );
          }
        }
      }
      break;
    }

    case "method":
    case "method_definition":
    case "singleton_method":
    case "singleton_method_definition": {
      qs.push(headerQuestion(node, sourceRef, code));
      const nameNode = getSectionFirstItem(node, "name");
      const nameText =
        nameNode && (textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type);
      if (nameText) {
        qs.push(
          singleQuestion(
            "What is the method name?",
            nameText,
            [
              sourceRef,
              {
                nodeType: nameNode.type,
                start: nameNode.startIndex,
                end: nameNode.endIndex,
                path: computeAstPath(root, nameNode),
              },
            ],
            "method.name"
          )
        );
      }
      const paramsNode = getSectionFirstItem(node, "params");
      const paramsInfo = extractParamInfo(paramsNode, code);
      if (paramsInfo.all.length > 0) {
        const paramsSpan =
          paramsNode ? { start: paramsNode.startIndex, end: paramsNode.endIndex } : undefined;
        qs.push(
          multiQuestion(
            "Which parameters does this method accept?",
            paramsInfo.all,
            sourceRef,
            "method.params",
            code,
            node.startIndex,
            node.endIndex,
            {
              revealStart: node.startIndex,
              revealEndBeforeChild: paramsSpan?.start,
              revealEndAfterChild: paramsSpan?.end,
            }
          )
        );
      }
      if (profile === "deep") {
        for (const def of paramsInfo.defaults) {
          qs.push(
            singleQuestion(
              `What is the default value of parameter ${def.name}?`,
              def.value,
              [
                sourceRef,
                {
                  nodeType: def.node.type,
                  start: def.node.startIndex,
                  end: def.node.endIndex,
                  path: computeAstPath(root, def.node),
                },
              ],
              "method.param-default"
            )
          );
        }
        if (paramsInfo.keywordParams.length > 0) {
          qs.push(
            multiQuestion(
              "Which keyword parameters are accepted?",
              paramsInfo.keywordParams,
              sourceRef,
              "method.keyword-params",
              code,
              node.startIndex,
              node.endIndex
            )
          );
        }
        if (node.type === "singleton_method" || node.type === "singleton_method_definition") {
          const receiver = getSectionFirstItem(node, "receiver");
          if (receiver) {
            const receiverText =
              textForRange(receiver.startIndex, receiver.endIndex, code) ||
              receiver.type;
            qs.push(
              singleQuestion(
                "What is the receiver of this singleton method?",
                receiverText,
                [
                  sourceRef,
                  {
                    nodeType: receiver.type,
                    start: receiver.startIndex,
                    end: receiver.endIndex,
                    path: computeAstPath(root, receiver),
                  },
                ],
                "method.singleton-receiver"
              )
            );
          }
        }
      }
      break;
    }

    case "block":
    case "do_block":
    case "brace_block": {
      const callNode = getSectionFirstItem(node, "call");
      const call = callNode ? extractCallParts(callNode, code) : undefined;
      const callName = call?.name;
      if (callName) {
        qs.push(
          singleQuestion(
            "Which method is being called with a block?",
            callName,
            [sourceRef],
            "block.call"
          )
        );
      }
      if (profile === "deep") {
        const paramsNode = getSectionFirstItem(node, "block_params");
        const paramsInfo = extractParamInfo(paramsNode, code);
        if (paramsInfo.all.length > 0) {
          qs.push(
            multiQuestion(
              "Which parameters does the block accept?",
              paramsInfo.all,
              sourceRef,
              "block.params",
              code,
              node.startIndex,
              node.endIndex
            )
          );
        }
      }
      break;
    }

    case "assignment": {
      const target = getSectionFirstItem(node, "target");
      const value = getSectionFirstItem(node, "value");
      if (target) {
        const targetText =
          textForRange(target.startIndex, target.endIndex, code) || target.type;
        qs.push(
          singleQuestion(
            "What is the left-hand target?",
            targetText,
            [
              sourceRef,
              {
                nodeType: target.type,
                start: target.startIndex,
                end: target.endIndex,
                path: computeAstPath(root, target),
              },
            ],
            "assignment.target"
          )
        );
      }
      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        qs.push(
          singleQuestion(
            "What is the right-hand value?",
            valueText,
            [
              sourceRef,
              {
                nodeType: value.type,
                start: value.startIndex,
                end: value.endIndex,
                path: computeAstPath(root, value),
              },
            ],
            "assignment.value"
          )
        );
      }
      break;
    }

    case "multiple_assignment": {
      const targets = getSectionItems(node, "targets");
      const values = getSectionItems(node, "values");
      if (targets.length > 0) {
        const targetTexts = targets
          .map((t) => textForRange(t.startIndex, t.endIndex, code) || "")
          .map((t) => t.trim())
          .filter(Boolean);
        if (targetTexts.length > 0) {
          qs.push(
            multiQuestion(
              "Which targets are assigned?",
              targetTexts,
              sourceRef,
              "multi_assignment.targets",
              code,
              node.startIndex,
              node.endIndex
            )
          );
        }
      }
      if (profile === "deep" && values.length > 0) {
        const first = values[0];
        const valueText =
          textForRange(first.startIndex, first.endIndex, code) || first.type;
        qs.push(
          singleQuestion(
            "What is the first assigned value?",
            valueText,
            [
              sourceRef,
              {
                nodeType: first.type,
                start: first.startIndex,
                end: first.endIndex,
                path: computeAstPath(root, first),
              },
            ],
            "multi_assignment.first_value"
          )
        );
      }
      break;
    }

    case "if":
    case "unless":
    case "elsif":
    case "if_modifier":
    case "unless_modifier": {
      qs.push(headerQuestion(node, sourceRef, code));
      if (profile === "deep") {
        const condition = getSectionFirstItem(node, "condition");
        if (condition) {
          const condText =
            textForRange(condition.startIndex, condition.endIndex, code) ||
            condition.type;
          qs.push(
            singleQuestion(
              "What is the condition expression?",
              condText,
              [
                sourceRef,
                {
                  nodeType: condition.type,
                  start: condition.startIndex,
                  end: condition.endIndex,
                  path: computeAstPath(root, condition),
                },
              ],
              "if.condition"
            )
          );
        }
      }
      break;
    }

    case "case": {
      qs.push(headerQuestion(node, sourceRef, code));
      const subject = getSectionFirstItem(node, "subject");
      if (subject) {
        const subjectText =
          textForRange(subject.startIndex, subject.endIndex, code) ||
          subject.type;
        qs.push(
          singleQuestion(
            "What is the case subject?",
            subjectText,
            [
              sourceRef,
              {
                nodeType: subject.type,
                start: subject.startIndex,
                end: subject.endIndex,
                path: computeAstPath(root, subject),
              },
            ],
            "case.subject"
          )
        );
      }
      break;
    }

    case "when":
    case "when_clause": {
      qs.push(headerQuestion(node, sourceRef, code));
      const conditions = getSectionItems(node, "conditions");
      const condTexts = conditions
        .map((c) => textForRange(c.startIndex, c.endIndex, code) || "")
        .map((t) => t.trim())
        .filter(Boolean);
      if (condTexts.length > 0) {
        qs.push(
          multiQuestion(
            "Which conditions are matched?",
            condTexts,
            sourceRef,
            "when.conditions",
            code,
            node.startIndex,
            node.endIndex
          )
        );
      }
      break;
    }

    case "while":
    case "until":
    case "for":
    case "while_modifier":
    case "until_modifier": {
      qs.push(headerQuestion(node, sourceRef, code));
      if (profile === "deep") {
        const condition = getSectionFirstItem(node, "condition");
        if (condition) {
          const condText =
            textForRange(condition.startIndex, condition.endIndex, code) ||
            condition.type;
          qs.push(
            singleQuestion(
              "What is the loop condition?",
              condText,
              [
                sourceRef,
                {
                  nodeType: condition.type,
                  start: condition.startIndex,
                  end: condition.endIndex,
                  path: computeAstPath(root, condition),
                },
              ],
              "loop.condition"
            )
          );
        }
      }
      break;
    }

    case "begin": {
      qs.push(headerQuestion(node, sourceRef, code));
      break;
    }

    case "rescue":
    case "rescue_clause": {
      qs.push(headerQuestion(node, sourceRef, code));
      const exceptions = getSectionItems(node, "exceptions");
      const excTexts = exceptions
        .map((e) => textForRange(e.startIndex, e.endIndex, code) || "")
        .map((t) => t.trim())
        .filter(Boolean);
      if (excTexts.length > 0) {
        qs.push(
          multiQuestion(
            "Which exception class(es) are rescued?",
            excTexts,
            sourceRef,
            "rescue.exceptions",
            code,
            node.startIndex,
            node.endIndex
          )
        );
      }
      const binding = getSectionFirstItem(node, "binding");
      if (binding) {
        const bindText =
          textForRange(binding.startIndex, binding.endIndex, code) ||
          binding.type;
        qs.push(
          singleQuestion(
            "What is the rescue binding name?",
            bindText,
            [
              sourceRef,
              {
                nodeType: binding.type,
                start: binding.startIndex,
                end: binding.endIndex,
                path: computeAstPath(root, binding),
              },
            ],
            "rescue.binding"
          )
        );
      }
      break;
    }

    case "ensure": {
      qs.push(headerQuestion(node, sourceRef, code));
      break;
    }

    case "return":
    case "break":
    case "next": {
      const value =
        childByField(node, "value") || (node.namedChildren || [])[0];
      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        const stem =
          node.type === "return"
            ? "What value is returned?"
            : node.type === "break"
              ? "What value is the break expression?"
              : "What value is passed to next?";
        qs.push(
          singleQuestion(
            stem,
            valueText,
            [
              sourceRef,
              {
                nodeType: value.type,
                start: value.startIndex,
                end: value.endIndex,
                path: computeAstPath(root, value),
              },
            ],
            `${node.type}.value`
          )
        );
      }
      break;
    }

    case "call":
    case "command":
    case "command_call":
    case "method_call": {
      const fullCallText =
        textForRange(node.startIndex, node.endIndex, code) || node.type;

      if (profile === "shallow") {
        qs.push({
          kind: "call.full",
          stem: "What method is called?",
          answerLabel: fullCallText,
          options: shuffle([fullCallText, ...buildDistractors(fullCallText)]),
          sourceRefs: [sourceRef],
          generatorRule: "call.full",
        });
        break;
      }

      const segments = decomposeCallChain(node, code);
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
            const chainArgs = extractCallParts(seg.node, code).args || [];
            if (chainArgs.length > 0) {
              const argTexts = chainArgs.map(
                (a) => textForRange(a.startIndex, a.endIndex, code) || a.type
              );
              const optionPool = buildMultiSelectOptionPool(
                argTexts,
                code,
                node.startIndex,
                node.endIndex
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
        break;
      }

      const call = extractCallParts(node, code);
      const calleeText =
        call.receiverNode && call.nameNode && code
          ? textForRange(call.receiverNode.startIndex, call.nameNode.endIndex, code) ||
            call.name ||
            "call"
          : call.name || "call";
      qs.push({
        kind: "call.callee",
        stem: "What method is called?",
        answerLabel: calleeText,
        options: shuffle([calleeText, ...buildDistractors(calleeText)]),
        sourceRefs: [sourceRef],
        generatorRule: "call.callee",
      });
      if (call.args.length > 0) {
        const argTexts = call.args.map(
          (a) => textForRange(a.startIndex, a.endIndex, code) || a.type
        );
        const optionPool = buildMultiSelectOptionPool(
          argTexts,
          code,
          node.startIndex,
          node.endIndex
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
      break;
    }

    default:
      break;
  }

  return qs;
};

const generateImportGroupQuestions = (
  root: TreeSitterAstNode,
  run: TreeSitterAstNode[],
  code: string,
  profile: DecompositionLevel
): QuizQuestion[] => {
  const allRequires: string[] = [];
  const relativeRequires: string[] = [];
  const loadRequires: string[] = [];

  for (const node of run) {
    const kind = requireKindForNode(node, code);
    if (!kind) continue;
    const args = requireArgsForNode(node, code, profile);
    if (args.length === 0) continue;
    allRequires.push(...args);
    if (kind === "require_relative") relativeRequires.push(...args);
    if (kind === "load") loadRequires.push(...args);
  }

  if (allRequires.length === 0) return [];
  const sourceRef: SourceRef = {
    nodeType: "import_group",
    start: run[0].startIndex,
    end: run[run.length - 1].endIndex,
    path: computeAstPath(root, run[0]),
    preview: textForRange(run[0].startIndex, run[run.length - 1].endIndex, code)?.slice(0, 120),
  };

  const spanStart = run[0].startIndex;
  const spanEnd = run[run.length - 1].endIndex;

  const qs: QuizQuestion[] = [
    {
      ...multiQuestion(
        "Which libraries/files are required here?",
        allRequires,
        sourceRef,
        "import_group.requires",
        code,
        spanStart,
        spanEnd
      ),
      distractorPoolSize: 10,
    },
  ];

  if (profile === "deep") {
    if (relativeRequires.length > 0) {
      qs.push(
        multiQuestion(
          "Which of these use require_relative?",
          relativeRequires,
          sourceRef,
          "import_group.require_relative",
          code,
          spanStart,
          spanEnd
        )
      );
    }
    if (loadRequires.length > 0) {
      qs.push(
        multiQuestion(
          "Which of these use load?",
          loadRequires,
          sourceRef,
          "import_group.load",
          code,
          spanStart,
          spanEnd
        )
      );
    }
  }

  return qs;
};

// ======================================================================
// Anchors and overlap guard
// ======================================================================

const ANCHOR_NODE_TYPES = new Set<string>([
  "class",
  "module",
  "singleton_class",
  "method",
  "method_definition",
  "singleton_method",
  "singleton_method_definition",
  "assignment",
  "multiple_assignment",
  "if",
  "unless",
  "elsif",
  "if_modifier",
  "unless_modifier",
  "case",
  "when",
  "when_clause",
  "while",
  "until",
  "for",
  "while_modifier",
  "until_modifier",
  "begin",
  "rescue",
  "rescue_clause",
  "ensure",
  "return",
  "break",
  "next",
  "block",
  "do_block",
  "brace_block",
  "call",
  "command",
  "command_call",
  "method_call",
]);

export const isAnchorNode = (node: TreeSitterAstNode): boolean =>
  ANCHOR_NODE_TYPES.has(node.type);

const BODY_NODE_TYPES = new Set([
  "body_statement",
  "statement_list",
  "block",
  "do_block",
  "brace_block",
]);

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

const filterOverlappingQuestions = (steps: EngineStep[]) => {
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
    const children = step.lesson?.childSteps || [];
    if (children.length) children.forEach(collect);
  };

  steps.forEach(collect);

  const sorted = entries.slice().sort((a, b) => {
    const la = a.span.end - a.span.start;
    const lb = b.span.end - b.span.start;
    if (la !== lb) return la - lb;
    return a.span.start - b.span.start;
  });

  const seenKeys = new Set<string>();
  const kept: typeof entries = [];
  const drop = new Set<QuizQuestion>();

  const makeDuplicateKey = (entry: Entry) =>
    `${entry.question.generatorRule}::${entry.span.start}-${entry.span.end}`;

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

const NO_FALLBACK_QUIZ_NODE_TYPES = new Set<string>([
  "class",
  "module",
  "singleton_class",
  "method",
  "method_definition",
  "singleton_method",
  "singleton_method_definition",
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
  "assignment",
  "multiple_assignment",
]);

// ======================================================================
// Main walker
// ======================================================================

export const generateEngineSteps = (
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  code: string,
  options: EngineOptions
): EngineStep[] => {
  const steps: EngineStep[] = [];
  const profile: DecompositionLevel =
    options.profile === "deep" ? "deep" : "shallow";

  const buildQuestionsForAnchor = (anchor: TreeSitterAstNode): QuizQuestion[] => {
    if (options.generateQuiz === false) return [];
    const sourceRef: SourceRef = {
      nodeType: anchor.type,
      start: anchor.startIndex,
      end: anchor.endIndex,
      path: computeAstPath(root, anchor),
      preview: textForRange(anchor.startIndex, anchor.endIndex, code)?.slice(0, 120),
    };
    const ruleQs = generateQuestionsForAnchor({
      root,
      node: anchor,
      code,
      sourceRef,
      profile,
    });
    if (ruleQs.length) return ruleQs;
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
      case "class": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : undefined;
        const label = options.includeNames !== false && nameText ? ` ${nameText}` : "";
        return {
          prompt: `We define a class${label}.`,
          semanticRole: "class",
          isDigable: hasChildStatements,
        };
      }
      case "module": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : undefined;
        const label = options.includeNames !== false && nameText ? ` ${nameText}` : "";
        return {
          prompt: `We define a module${label}.`,
          semanticRole: "module",
          isDigable: hasChildStatements,
        };
      }
      case "method":
      case "method_definition":
      case "singleton_method":
      case "singleton_method_definition": {
        const name = getSectionFirstItem(anchor, "name");
        const nameText = name ? textForRange(name.startIndex, name.endIndex, code) : undefined;
        const label = options.includeNames !== false && nameText ? ` ${nameText}` : "";
        return {
          prompt: `We define a method${label}.`,
          semanticRole: "method",
          isDigable: hasChildStatements,
        };
      }
      case "assignment":
      case "multiple_assignment":
        return {
          prompt: "We assign values.",
          semanticRole: "assignment",
          isDigable: false,
        };
      case "block":
      case "do_block":
      case "brace_block":
        return {
          prompt: "We call a method with a block.",
          semanticRole: "block",
          isDigable: hasChildStatements,
        };
      case "call":
      case "command":
      case "command_call":
      case "method_call":
        return {
          prompt: "We call a method.",
          semanticRole: "call",
          isDigable: false,
        };
      case "if":
      case "unless":
      case "elsif":
        return {
          prompt: "We evaluate a condition.",
          semanticRole: "if",
          isDigable: hasChildStatements,
        };
      case "case":
        return {
          prompt: "We branch on a case.",
          semanticRole: "case",
          isDigable: hasChildStatements,
        };
      case "while":
      case "until":
      case "for":
        return {
          prompt: "We iterate over a loop.",
          semanticRole: "loop",
          isDigable: hasChildStatements,
        };
      case "begin":
      case "rescue":
      case "rescue_clause":
      case "ensure":
        return {
          prompt: "We handle exceptions.",
          semanticRole: "exception",
          isDigable: hasChildStatements,
        };
      case "return":
      case "break":
      case "next":
        return {
          prompt: `We ${anchor.type}.`,
          semanticRole: anchor.type,
          isDigable: false,
        };
      default: {
        if (hasQuestions) {
          return {
            prompt: `Analyze this ${anchor.type}.`,
            semanticRole: anchor.type,
            isDigable: hasChildStatements,
          };
        }
        return {
          prompt: `Next, we have a ${anchor.type}.`,
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

  const getBody = (stmt: TreeSitterAstNode) =>
    getSectionFirstItem(stmt, "body") ||
    getSectionFirstItem(stmt, "then") ||
    getSectionFirstItem(stmt, "consequence");

  const walkBody = (body?: TreeSitterAstNode) => {
    if (!body) return;
    const children = getStatementChildren(body);
    for (const stmt of children) {
      if (isAnchorNode(stmt)) walkStmt(stmt);
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
      options.generateQuiz !== false
        ? generateImportGroupQuestions(root, run, code, profile)
        : [];
    const childSteps: EngineStep[] = run.map((importNode) => ({
      id: randomString(8),
      node: importNode,
      displaySpan: { start: importNode.startIndex, end: importNode.endIndex },
      lesson: {
        semanticRole: "require",
        prompt: "Require statement.",
        isDigable: false,
      },
    }));
    const lessonPrompt =
      run.length === 1
        ? "We require dependencies for this file."
        : `This block requires dependencies from ${run.length} statements.`;
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

  const collectRequireRun = (
    children: TreeSitterAstNode[],
    startIndex: number
  ): { run: TreeSitterAstNode[]; nextIndex: number } => {
    const run: TreeSitterAstNode[] = [];
    let i = startIndex;
    while (i < children.length) {
      const stmt = children[i];
      if (requireKindForNode(stmt, code)) {
        run.push(stmt);
        i++;
        continue;
      }
      break;
    }
    return { run, nextIndex: i };
  };

  const walkProgram = (program: TreeSitterAstNode) => {
    const children = getStatementChildren(program);
    let i = 0;
    while (i < children.length) {
      const stmt = children[i];
      if (requireKindForNode(stmt, code)) {
        const { run, nextIndex } = collectRequireRun(children, i);
        emitImportRunStep(run);
        i = nextIndex;
        continue;
      }
      if (isAnchorNode(stmt)) walkStmt(stmt);
      i++;
    }
  };

  const walkStmt = (stmt: TreeSitterAstNode) => {
    if (!isAnchorNode(stmt)) return;
    switch (stmt.type) {
      case "class":
      case "module":
      case "singleton_class": {
        const body = getBody(stmt);
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        break;
      }
      case "method":
      case "method_definition":
      case "singleton_method":
      case "singleton_method_definition": {
        const body = getBody(stmt);
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        break;
      }
      case "if":
      case "unless":
      case "elsif":
      case "if_modifier":
      case "unless_modifier": {
        const body = getBody(stmt);
        const elseNode = getSectionFirstItem(stmt, "else");
        const hasChildStatements =
          blockHasStatements(body) ||
          (elseNode ? blockHasStatements(getBody(elseNode)) : false);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        if (elseNode) {
          if (isAnchorNode(elseNode)) walkStmt(elseNode);
          else walkBody(getBody(elseNode) || elseNode);
        }
        break;
      }
      case "case": {
        const whens = getSectionItems(stmt, "whens");
        const hasChildStatements = whens.some((w) => blockHasStatements(getBody(w)));
        emitAnchorStep(stmt, hasChildStatements);
        whens.forEach((w) => walkStmt(w));
        break;
      }
      case "when":
      case "when_clause": {
        const body = getBody(stmt);
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        break;
      }
      case "while":
      case "until":
      case "for":
      case "while_modifier":
      case "until_modifier": {
        const body = getBody(stmt);
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        break;
      }
      case "begin": {
        const body = getBody(stmt);
        const rescues = getSectionItems(stmt, "rescues");
        const ensureNode = getSectionFirstItem(stmt, "ensure");
        const hasChildStatements =
          blockHasStatements(body) ||
          rescues.some((r) => blockHasStatements(getBody(r))) ||
          (ensureNode ? blockHasStatements(getBody(ensureNode)) : false);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        rescues.forEach((r) => walkStmt(r));
        if (ensureNode) walkStmt(ensureNode);
        break;
      }
      case "rescue":
      case "rescue_clause":
      case "ensure": {
        const body = getBody(stmt);
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        break;
      }
      case "block":
      case "do_block":
      case "brace_block": {
        const body = getBody(stmt);
        const hasChildStatements = blockHasStatements(body);
        emitAnchorStep(stmt, hasChildStatements);
        walkBody(body);
        break;
      }
      default:
        emitAnchorStep(stmt, false);
        break;
    }
  };

  if (node.type === "program") {
    walkProgram(node);
    filterOverlappingQuestions(steps);
    return steps;
  }
  if (BODY_NODE_TYPES.has(node.type)) {
    walkBody(node);
    filterOverlappingQuestions(steps);
    return steps;
  }
  walkStmt(node);
  filterOverlappingQuestions(steps);
  return steps;
};

// ======================================================================
// Masking & Payload Helpers
// ======================================================================

export type MaskRange = { start: number; end: number };

function headerMaskAndAnswer(
  stmt: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  const { headerEnd } = getRevealAnchors(stmt);
  const answerText = headerAnswer(stmt, code);
  const masks =
    headerEnd > stmt.startIndex
      ? [{ start: stmt.startIndex, end: headerEnd }]
      : [];
  return { masks, answerText };
}

export function maskAndAnswerForStep(
  step: EngineStep,
  _root: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  if ((step.node as any).isVirtual || step.node.type === "import_group") {
    return { masks: [], answerText: textForNode(step.node, code) };
  }
  const headerTypes = new Set([
    "class",
    "module",
    "singleton_class",
    "method",
    "method_definition",
    "singleton_method",
    "singleton_method_definition",
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
  ]);
  if (headerTypes.has(step.node.type)) {
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
    if (!Array.isArray(q.sourceRefs) || q.sourceRefs.length === 0)
      return undefined;
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
            preview: textForRange(revealSpan.start, revealSpan.end, code)?.slice(
              0,
              120
            ),
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
