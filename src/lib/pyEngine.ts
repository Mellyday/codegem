import type { TreeSitterAstNode } from "./treeSitter";
import {
  isDocstringNode,
  childrenOfType,
  firstChildOfType,
  childByField,
  buildCuratedSections,
  collectDescendants,
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
  const out = new Set<string>();
  while (out.size < 3) {
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
  return Array.from(out);
}

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

const rules: Record<string, Rule[]> = {
  assignment: [
    ({ root, node, code, sourceRef }) => {
      const kids = node.namedChildren || [];
      const left = kids[0];
      const right = kids[kids.length - 1];
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
      const kids = node.namedChildren || [];
      if (kids.length < 2) return;
      const qs: Q11[] = [];
      const first = kids[0];
      const firstText =
        textForRange(first.startIndex, first.endIndex, code) || first.type;
      qs.push({
        kind: "identify-field",
        stem: "What is the left operand?",
        answerLabel: firstText,
        options: buildDistractors(firstText, { code }),
        sourceRefs: [
          sourceRef,
          {
            nodeType: first.type,
            start: first.startIndex,
            end: first.endIndex,
            path: computeAstPath(root, first),
          },
        ],
        generatorRule: "comparison.left",
      });
      for (let i = 1; i < kids.length; i++) {
        const comp = kids[i];
        const compText =
          textForRange(comp.startIndex, comp.endIndex, code) || comp.type;
        const prev = kids[i - 1];
        const op = extractOperatorBetween(code, prev.endIndex, comp.startIndex);
        if (op && op.length <= 6) {
          qs.push({
            kind: "operator",
            stem: `What is the operator #${i}?`,
            answerLabel: op,
            options: buildDistractors(op, { code }),
            sourceRefs: [sourceRef],
            generatorRule: "comparison.op",
          });
        }
        qs.push({
          kind: "identify-field",
          stem: `What is comparator #${i}?`,
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
      }
      return qs;
    },
  ],
  dictionary: [
    ({ node, code, sourceRef }) => {
      const keys: string[] = [];
      const keyNodes: { start: number; end: number }[] = [];
      for (const c of node.namedChildren || []) {
        if (c.type === "pair") {
          const [k] = c.namedChildren || [];
          if (k) {
            keys.push(textForRange(k.startIndex, k.endIndex, code) || k.type);
            keyNodes.push({ start: k.startIndex, end: k.endIndex });
          }
        }
      }
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const idPool: string[] = [];
      const strPool: string[] = [];
      try {
        const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
        const reStr = /(['"])((?:\\.|(?!\1).)*)\1/g;
        const snippet = (code || "").slice(spanStart, spanEnd);
        let m: RegExpExecArray | null;
        while ((m = reId.exec(snippet))) idPool.push(m[0]);
        while ((m = reStr.exec(snippet))) if (m[2].trim()) strPool.push(m[2]);
      } catch {}
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
      const fnNode =
        (node.namedChildren || []).find((c) => c.fieldName === "function") ||
        (node.namedChildren || [])[0];
      const argsList =
        (node.namedChildren || []).find((c) => c.fieldName === "arguments") ||
        (node.namedChildren || []).find((c) => c.type === "argument_list");
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
      if (profile !== "shallow" && argsList) {
        const args = argsList.namedChildren || [];
        let pos = 0;
        for (const a of args) {
          if (a.type === "keyword_argument") {
            const nameNode = (a.namedChildren || [])[0];
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
                    nodeType: a.type,
                    start: a.startIndex,
                    end: a.endIndex,
                    path: computeAstPath(root, a),
                  },
                ],
                generatorRule: "call.kwarg-name",
              });
            }
          } else {
            pos += 1;
            const argText =
              textForRange(a.startIndex, a.endIndex, code) || a.type;
            qs.push({
              kind: "call-arg-positional",
              stem: `What is positional argument #${pos}?`,
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
      const children = node.namedChildren || [];
      const left = childByField(node, "left") || children[0];
      const right =
        childByField(node, "right") || children[children.length - 1];
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
      const valueNode =
        childByField(node, "value") || (node.namedChildren || [])[0];
      const second =
        childByField(node, "slice") || (node.namedChildren || [])[1];
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
        if (second.type === "slice") {
          const parts = second.namedChildren || [];
          const labels = ["start", "stop", "step"] as const;
          parts.slice(0, 3).forEach((p, idx) => {
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
      const parts = node.namedChildren || [];
      const labels = ["start", "stop", "step"] as const;
      if (parts.length === 0) return;
      const qs: Q11[] = [];
      parts.slice(0, 3).forEach((p, idx) => {
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
      const params =
        (node.namedChildren || []).find((c) => c.type === "parameters")
          ?.namedChildren || [];
      const qs: Q11[] = [];
      params.forEach((p, idx) => {
        const nameNode = (p.namedChildren || []).find(
          (c) => c.type === "identifier"
        );
        if (nameNode) {
          const nameText =
            textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
            "param";
          qs.push({
            kind: "param-name",
            stem: `What is the name of parameter #${idx + 1}?`,
            answerLabel: nameText,
            options: buildDistractors(nameText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: p.type,
                start: p.startIndex,
                end: p.endIndex,
                path: computeAstPath(root, p),
              },
            ],
            generatorRule: "func.param-name",
          });
        }
        if (profile !== "shallow") {
          const typeNode = (p.namedChildren || []).find(
            (c) => c.type === "type" || c.type === "type_annotation"
          );
          if (typeNode) {
            const typText =
              textForRange(typeNode.startIndex, typeNode.endIndex, code) ||
              "type";
            qs.push({
              kind: "param-type",
              stem: `What is the type of parameter #${idx + 1}?`,
              answerLabel: typText,
              options: buildDistractors(typText, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: typeNode.type,
                  start: typeNode.startIndex,
                  end: typeNode.endIndex,
                  path: computeAstPath(root, typeNode),
                },
              ],
              generatorRule: "func.param-type",
            });
          }
        }
      });
      if (profile !== "shallow") {
        const ret = (node.namedChildren || []).find(
          (c) =>
            c.type === "type" ||
            c.type === "type_annotation" ||
            c.fieldName === "return_type"
        );
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
    if (!topLevelNodes.length) return [];
    const out: EngineStep[] = [];
    let currentCategory: PyCategory | null = null;
    let currentGroup: TreeSitterAstNode[] = [];

    for (const n of topLevelNodes) {
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
// Main Walker
// ============================================================================

export const generateEngineSteps = (
    root: TreeSitterAstNode, // Root of the entire file (for context)
    node: TreeSitterAstNode, // Current node to process
    code: string,
    options: EngineOptions
): EngineStep[] => {
    const steps: EngineStep[] = [];
    const children = (node.namedChildren || []).filter(
        (c) => c.type !== "comment" && !isDocstringNode(c, node)
    );

    // 1. Check for Grouping (Module Level)
    if (node.type === "module" && !options.__noGroup) {
        const enableGrouping = options.grouping === "auto"
            ? (children.length >= 12 || code.length >= 5000)
            : options.grouping;

        if (enableGrouping) {
            return groupTopLevelNodes(root, children, code, options);
        }
    }

    // 2. Generate Quiz Questions using rule-driven logic (unless disabled)
    const questions: QuizQuestion[] = [];
    if (options.generateQuiz !== false) {
        const mappedProfile: DecompositionLevel =
            options.profile === "deep" ? "deep" : "shallow";
        const ruleQuestions = generateQuestionsV11(root, node, mappedProfile, code);
        if (ruleQuestions.length) {
            questions.push(...ruleQuestions);
        } else {
            const txt = textForNode(node, code);
            questions.push({
                kind: "shallow_ident",
                stem: "What is this code block?",
                answerLabel: txt,
                options: [],
                sourceRefs: [
                    {
                        nodeType: node.type,
                        start: node.startIndex,
                        end: node.endIndex,
                        path: computeAstPath(root, node),
                        preview: txt.slice(0, 120),
                    },
                ],
                generatorRule: "shallow_statement",
            });
        }
    }

    // 3. Generate Lesson Step (if applicable)
    //    We default to creating a step for every node visited, unless it's purely structural
    //    or handled by a parent's custom logic.

    let lessonData: EngineStep["lesson"] | undefined;
    let recurse = true;

    switch (node.type) {
        case "module":
            // Module itself doesn't get a step, just yields children
            break;

        case "class_definition": {
            const name = firstChildOfType(node, "identifier");
            const nameText = name ? textForNode(name, code) : "class";
            lessonData = {
                prompt: `We define a class named: ${nameText}`,
                semanticRole: "class_definition",
                isDigable: true,
            };
            break;
        }

        case "function_definition": {
            const name = firstChildOfType(node, "identifier");
            const nameText = name ? textForNode(name, code) : "function";
            lessonData = {
                prompt: `We define a function named: ${nameText}`,
                semanticRole: "function_definition",
                isDigable: true,
            };
            break;
        }

        case "if_statement": {
            lessonData = {
                prompt: "An if statement checks a condition.",
                semanticRole: "if_statement",
                isDigable: true,
            };
            break;
        }

        case "while_statement": {
            lessonData = {
                prompt: "A while loop runs as long as the condition is true.",
                semanticRole: "while_statement",
                isDigable: true,
            };
            break;
        }

        case "for_statement": {
            lessonData = {
                prompt: "A for loop iterates over a sequence.",
                semanticRole: "for_statement",
                isDigable: true,
            };
            break;
        }

        case "assignment": {
            lessonData = {
                prompt: "An assignment statement stores a value.",
                semanticRole: "assignment",
                isDigable: false, // Usually leaf in lesson view, but quiz digs in
            };
            // For assignments, we might not want to recurse in the *lesson* flow 
            // if we treat it as atomic, but for *quiz* generation we might want to 
            // visit children if we had questions for them. 
            // However, current pyQuiz logic handles assignment children inside the assignment rule.
            break;
        }

        default: {
            // Generic fallback
            if (questions.length > 0) {
                // If it has questions, it's interesting enough to be a step
                lessonData = {
                    prompt: `Analyze this ${node.type}.`,
                    semanticRole: node.type,
                    isDigable: children.length > 0,
                };
            } else if (node.type.endsWith("_statement") || node.type === "expression_statement") {
                lessonData = {
                    prompt: `Next, we have a ${node.type.replace("_statement", "")} statement.`,
                    semanticRole: node.type,
                    isDigable: children.length > 0,
                };
            }
            break;
        }
    }

    // 4. Construct the Step
    if (lessonData || questions.length > 0) {
        const step: EngineStep = {
            id: randomString(8),
            node,
            lesson: lessonData,
            quiz: questions.length > 0 ? { questions } : undefined,
        };
        steps.push(step);
    }

    // 5. Recurse
    if (recurse) {
        children.forEach((child) => {
            // Pass root down
            steps.push(...generateEngineSteps(root, child, code, options));
        });
    }

    return steps;
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

    const full = code.substring(stmt.startIndex, stmt.endIndex);
    const colonIdx = full.indexOf(":");
    const answerText = (
        colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]
    ).trimEnd();

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
        "while_statement",
        "for_statement",
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

export function buildCustomQuizPayload(params: {
    fileKey?: { kind: "repo" | "project"; id: string; path: string };
    root: TreeSitterAstNode;
    code: string;
    history: LessonHistoryItem[];
    lessonQueue: EngineStep[];
    currentStep: number;
}) {
    const { fileKey, root, code, history, lessonQueue, currentStep } = params;

    const stepToCard = (
        step: EngineStep,
        order: number,
        source: "visited" | "pending",
        action: "next" | "dig" = "next"
    ) => {
        let question = `What is this ${step.node.type}?`;
        if (step.lesson?.semanticRole === "return_type") {
            question = "What is the return type of this function?";
        } else if (
            step.lesson?.semanticRole === "loop_condition" ||
            step.lesson?.semanticRole === "if_condition"
        ) {
            question = "Write the full header line";
        }

        const { masks, answerText } = maskAndAnswerForStep(step, root, code);

        // Compute progressive reveal anchors for this step.
        // Default: reveal nothing of this node before the question,
        // then reveal the full node after it is answered.
        const revealStart = step.node.startIndex;
        let revealEndBeforeChild: number | undefined = step.node.startIndex;
        let revealEndAfterChild: number | undefined = step.node.endIndex;

        // For header-like nodes (if/elif/while/for headers), maskAndAnswerForStep
        // returns a prefix mask. Show that prefix before asking, then reveal the rest.
        if (masks.length > 0) {
            revealEndBeforeChild = masks[0].end;
            revealEndAfterChild = step.node.endIndex;
        }

        const sourceRef = {
            nodeType: step.node.type,
            start: step.node.startIndex,
            end: step.node.endIndex,
            path: computeAstPath(root, step.node),
            preview: textForNode(step.node, code).slice(0, 120),
        };
        return {
            order,
            type: step.node.type,
            text: answerText,
            action,
            semanticRole: step.lesson?.semanticRole,
            question,
            sourceRef,
            source,
            revealStart,
            revealEndBeforeChild,
            revealEndAfterChild,
        };
    };

    const filteredHistory = history.filter((h) => h.action !== "dig");
    const visitedCards = filteredHistory.map((step, idx) =>
        stepToCard(step, idx, "visited", step.action ?? "next")
    );
    const pendingCards = lessonQueue
        .slice(currentStep)
        .map((step, i) => stepToCard(step, filteredHistory.length + i, "pending"));

    const cards = [...visitedCards, ...pendingCards];

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
        cards: cards.map((c) => ({
            order: c.order,
            type: c.type,
            text: c.text,
            action: c.action,
            question: c.question,
            semanticRole: c.semanticRole,
            sourceRef: (c as any).sourceRef,
            // progressive reveal anchors used by QuizViewer for custom quizzes
            revealStart: (c as any).revealStart,
            revealEndBeforeChild: (c as any).revealEndBeforeChild,
            revealEndAfterChild: (c as any).revealEndAfterChild,
        })),
    };
}

function headerAnswer(stmt: TreeSitterAstNode, code: string): string {
  const full = code.substring(stmt.startIndex, stmt.endIndex);
  const colonIdx = full.indexOf(":");
  return (
    colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]
  ).trimEnd();
}

export function buildHeuristicQuiz(
  root: TreeSitterAstNode,
  code: string,
  profile: "shallow" | "deep",
  opts?: { maxDeepPerStmt?: number; maxQuestions?: number }
): {
  id: string;
  kind: "custom-quiz";
  createdAt: string;
  typeLabel?: string;
  profile?: "shallow" | "normal" | "deep";
  root: { type: string; start?: number; end?: number };
  totalCards: number;
  cards: Array<{
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    sourceRef?: {
      nodeType: string;
      start: number;
      end: number;
      path: number[];
      preview?: string;
    };
    semanticRole?: string;
    question?: string;
    generatorRule?: string;
    difficulty?: "easy" | "medium" | "hard";
    // optional progressive reveal anchors
    revealEndBeforeChild?: number;
    revealEndAfterChild?: number;
  }>;
} {
  const cards: Array<{
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    sourceRef?: {
      nodeType: string;
      start: number;
      end: number;
      path: number[];
      preview?: string;
    };
    semanticRole?: string;
    question?: string;
    generatorRule?: string;
    difficulty?: "easy" | "medium" | "hard";
    revealEndBeforeChild?: number;
    revealEndAfterChild?: number;
  }> = [];
  let order = 0;

  const emitCard = (
    text: string,
    q: string,
    node: TreeSitterAstNode,
    kind?: string,
    semanticRole?: string
  ) => {
    cards.push({
      order: order++,
      type: kind || node.type,
      text,
      action: "next",
      question: q,
      semanticRole,
      sourceRef: {
        nodeType: node.type,
        start: node.startIndex,
        end: node.endIndex,
        path: computeAstPath(root, node),
        preview: code.slice(node.startIndex, node.endIndex).slice(0, 120),
      },
      // progressive reveal anchors for line-by-line shallow/normal quizzes
      revealEndBeforeChild: node.startIndex,
      revealEndAfterChild: node.endIndex,
    });
  };

  const makeIdentifierPool = (spanStart: number, spanEnd: number): string[] => {
    const snippet = code.slice(spanStart, spanEnd);
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(snippet))) out.add(m[0]);
    return Array.from(out);
  };

  const makeStringPool = (spanStart: number, spanEnd: number): string[] => {
    const snippet = code.slice(spanStart, spanEnd);
    const re = /(['"])((?:\\.|(?!\1).)*)\1/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(snippet))) {
      const s = m[2];
      if (s.trim().length > 0) out.add(s);
    }
    return Array.from(out);
  };

  const emitHeader = (stmt: TreeSitterAstNode) => {
    const answerText = headerAnswer(stmt, code);
    emitCard(
      answerText,
      "Write the full header line",
      stmt,
      stmt.type,
      "header"
    );
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    const kids = (block.namedChildren || []).filter(
      (c) => c.type !== "comment" && !isDocstringNode(c, block)
    );
    for (const stmt of kids) walkStmt(stmt);
  };

  const walkStmt = (node: TreeSitterAstNode) => {
    switch (node.type) {
      case "import_from_statement": {
        const groups = buildCuratedSections(node);
        const moduleGroup = groups.find((g) => g.key === "module");
        if (moduleGroup?.items?.[0]) {
          const mod = moduleGroup.items[0];
          const modTxt = code.slice(mod.startIndex, mod.endIndex);
          emitCard(modTxt, "What is the module?", mod, "module");
        }
        const namesGroup = groups.find((g) => g.key === "names");
        const items = namesGroup?.items || [];
        const correct = items
          .map((n) => code.slice(n.startIndex, n.endIndex))
          .filter(Boolean);
        // Build padded option pool (always up to 10)
        const idPool = makeIdentifierPool(
          root.startIndex,
          root.endIndex
        ).filter((s) => !correct.includes(s));
        let pool = Array.from(new Set<string>([...correct, ...idPool]));
        if (pool.length < 10) {
          const needed = 10 - pool.length;
          const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => !pool.includes(d))
            .slice(0, needed);
          pool.push(...pad);
        }
        const MAX = 10;
        const extras = shuffle(pool.filter((p) => !correct.includes(p)));
        const optionPool = shuffle([
          ...correct,
          ...extras.slice(0, Math.max(0, MAX - correct.length)),
        ]).slice(0, MAX);
        const snippet = code.slice(node.startIndex, node.endIndex);
        // Reveal anchors for import-from: show header up to first imported name, then reveal through last name
        const firstStart = items.length
          ? items.reduce((m, it) => Math.min(m, it.startIndex), items[0].startIndex)
          : undefined;
        const lastEnd = items.length
          ? items.reduce((m, it) => Math.max(m, it.endIndex), items[0].endIndex)
          : undefined;
        cards.push({
          order: order++,
          type: "imported_names_multi",
          text: snippet,
          action: "next",
          question: `Which names are imported?`,
          generatorRule: "import_from.names",
          sourceRef: {
            nodeType: node.type,
            start: node.startIndex,
            end: node.endIndex,
            path: computeAstPath(root, node),
            preview: snippet.slice(0, 120),
          },
          questionType: "multi",
          multiCorrect: correct,
          optionPool,
          // progressive reveal anchors
          revealStart: node.startIndex,
          revealEndBeforeChild: firstStart,
          revealEndAfterChild: lastEnd,
        } as any);
        break;
      }
      case "import_statement": {
        const groups = buildCuratedSections(node);
        const namesGroup = groups.find((g) => g.key === "names");
        const items = namesGroup?.items || [];
        const correct = items
          .map((n) => code.slice(n.startIndex, n.endIndex))
          .filter(Boolean);
        const idPool = makeIdentifierPool(
          root.startIndex,
          root.endIndex
        ).filter((s) => !correct.includes(s));
        let pool = Array.from(new Set<string>([...correct, ...idPool]));
        if (pool.length < 10) {
          const needed = 10 - pool.length;
          const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => !pool.includes(d))
            .slice(0, needed);
          pool.push(...pad);
        }
        const MAX = 10;
        const extras = shuffle(pool.filter((p) => !correct.includes(p)));
        const optionPool = shuffle([
          ...correct,
          ...extras.slice(0, Math.max(0, MAX - correct.length)),
        ]).slice(0, MAX);
        const snippet = code.slice(node.startIndex, node.endIndex);
        const namesGroup2 = groups.find((g) => g.key === "names");
        const items2 = namesGroup2?.items || [];
        const firstStart2 = items2.length
          ? items2.reduce((m, it) => Math.min(m, it.startIndex), items2[0].startIndex)
          : undefined;
        const lastEnd2 = items2.length
          ? items2.reduce((m, it) => Math.max(m, it.endIndex), items2[0].endIndex)
          : undefined;
        cards.push({
          order: order++,
          type: "imported_names_multi",
          text: snippet,
          action: "next",
          question: `Which names are imported?`,
          generatorRule: "import.names",
          sourceRef: {
            nodeType: node.type,
            start: node.startIndex,
            end: node.endIndex,
            path: computeAstPath(root, node),
            preview: snippet.slice(0, 120),
          },
          questionType: "multi",
          multiCorrect: correct,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: firstStart2,
          revealEndAfterChild: lastEnd2,
        } as any);
        break;
      }
      case "function_definition": {
        const sections = buildCuratedSections(node);
        const argsGroup = sections.find((s) => s.key === "args");
        const returnsGroup = sections.find((s) => s.key === "returns");

        if (argsGroup) {
          const params = argsGroup.items || [];
          const names: string[] = [];
          for (const p of params) {
            const nameNode = (p.namedChildren || []).find(
              (c) => c.type === "identifier"
            );
            if (nameNode)
              names.push(code.slice(nameNode.startIndex, nameNode.endIndex));
            else names.push(code.slice(p.startIndex, p.endIndex));
          }
          const block = firstChildOfType(node, "block");
          const spanStart = block ? block.startIndex : node.startIndex;
          const spanEnd = block ? block.endIndex : node.endIndex;
          const idPool = makeIdentifierPool(spanStart, spanEnd).filter(
            (s) => !names.includes(s)
          );
          let pool = Array.from(new Set<string>([...names, ...idPool]));
          if (pool.length < 10) {
            const needed = 10 - pool.length;
            const pad = shuffle(GENERIC_DISTRACTORS)
              .filter((d) => !pool.includes(d))
              .slice(0, needed);
            pool.push(...pad);
          }
          const MAX = 10;
          const extras = shuffle(pool.filter((p) => !names.includes(p)));
          const optionPool = shuffle([
            ...names,
            ...extras.slice(0, Math.max(0, MAX - names.length)),
          ]).slice(0, MAX);
          const header = headerAnswer(node, code);
          // Reveal anchors for params: prefix through first param, then through last param
          const firstParamStart = params.length
            ? params.reduce((m, it) => Math.min(m, it.startIndex), params[0].startIndex)
            : undefined;
          const lastParamEnd = params.length
            ? params.reduce((m, it) => Math.max(m, it.endIndex), params[0].endIndex)
            : undefined;
          cards.push({
            order: order++,
            type: "function_params_multi",
            text: header,
            action: "next",
            question: `Which of the following are parameters of this function?`,
            generatorRule: "func.params-multi",
            sourceRef: {
              nodeType: node.type,
              start: node.startIndex,
              end: node.endIndex,
              path: computeAstPath(root, node),
              preview: code
                .slice(node.startIndex, node.endIndex)
                .slice(0, 120),
            },
            questionType: "multi",
            multiCorrect: names,
            optionPool,
            revealStart: node.startIndex,
            revealEndBeforeChild: firstParamStart,
            revealEndAfterChild: lastParamEnd,
          } as any);
        }
        if (returnsGroup) {
          for (let i = 0; i < returnsGroup.items.length; i++) {
            const item = returnsGroup.items[i];
            const text = code.substring(item.startIndex, item.endIndex);
            emitCard(
              text,
              "What is the return type?",
              item,
              item.type,
              "returns"
            );
          }
        }
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        break;
      }
      case "class_definition": {
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        break;
      }
      case "while_statement":
      case "for_statement": {
        emitHeader(node);
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        const elseCl = firstChildOfType(node, "else_clause");
        if (elseCl) {
          emitHeader(elseCl);
          const eb = firstChildOfType(elseCl, "block");
          if (eb) walkBlock(eb);
        }
        break;
      }
      case "if_statement": {
        emitHeader(node);
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        for (const e of childrenOfType(node, "elif_clause")) {
          emitHeader(e);
          const b = firstChildOfType(e, "block");
          if (b) walkBlock(b);
        }
        const elseCl = firstChildOfType(node, "else_clause");
        if (elseCl) {
          emitHeader(elseCl);
          const eb = firstChildOfType(elseCl, "block");
          if (eb) walkBlock(eb);
        }
        break;
      }
      case "with_statement": {
        emitHeader(node);
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        break;
      }
      case "try_statement": {
        emitHeader(node);
        const body = firstChildOfType(node, "block");
        if (body) walkBlock(body);
        for (const h of (node.namedChildren || []).filter((c) =>
          c.type.includes("except")
        )) {
          emitHeader(h);
          const b = firstChildOfType(h, "block");
          if (b) walkBlock(b);
        }
        const elseCl = firstChildOfType(node, "else_clause");
        if (elseCl) {
          emitHeader(elseCl);
          const eb = firstChildOfType(elseCl, "block");
          if (eb) walkBlock(eb);
        }
        const finCl = firstChildOfType(node, "finally_clause");
        if (finCl) {
          emitHeader(finCl);
          const fb = firstChildOfType(finCl, "block");
          if (fb) walkBlock(fb);
        }
        break;
      }
      default: {
        const text = code.slice(node.startIndex, node.endIndex);
        emitCard(text, "What comes next?", node);
        break;
      }
    }
  };

  {
    const tops = (root.namedChildren || []).filter(
      (c) => c.type !== "comment" && !isDocstringNode(c, root)
    );
    for (const top of tops) walkStmt(top);
  }
  if (typeof opts?.maxQuestions === "number") {
    const n = Math.min(cards.length, opts.maxQuestions);
    cards.length = n;
  }

  return {
    id: "",
    kind: "custom-quiz",
    createdAt: new Date().toISOString(),
    typeLabel: "CustomQuizV1.1",
    profile,
    root: { type: root.type, start: root.startIndex, end: root.endIndex },
    totalCards: cards.length,
    cards,
  };
}
