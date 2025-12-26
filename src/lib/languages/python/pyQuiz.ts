import type { TreeSitterAstNode } from "../../treeSitter";
import {
  buildCuratedSections,
  childrenOfType,
  firstChildOfType,
  isDocstringNode,
  collectDescendants,
} from "./pyCuration";

// -------- Shared helpers --------
export const computeAstPath = (
  root: TreeSitterAstNode,
  target: TreeSitterAstNode
): number[] => {
  const path: number[] = [];
  let found = false;
  const dfs = (node: TreeSitterAstNode, cur: number[]) => {
    if (found) return;
    if (
      node.startIndex === target.startIndex &&
      node.endIndex === target.endIndex &&
      node.type === target.type
    ) {
      path.push(...cur);
      found = true;
      return;
    }
    (node.namedChildren || []).forEach((c, idx) => dfs(c, cur.concat(idx)));
  };
  dfs(root, []);
  return path;
};

const textForRange = (
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

const childByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).find((c) => c.fieldName === field);

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

// -------- Rules + generator (v1.1) --------
type DecompositionLevel = "shallow" | "normal" | "deep";

type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

type RuleCtx = {
  root: TreeSitterAstNode;
  node: TreeSitterAstNode;
  code?: string;
  sourceRef: SourceRef;
  profile: DecompositionLevel;
};

type Q11 = {
  stem: string;
  kind: string;
  answerLabel: string;
  options: string[];
  sourceRefs: SourceRef[];
  generatorRule: string;
  difficulty?: "easy" | "medium" | "hard";
  // optional multi-select support for deep rules
  questionType?: "single" | "multi";
  multiCorrect?: string[];
  optionPool?: string[];
  multiSelectHint?: number;
  // reveal ranges for progressive reveal (absolute indices)
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};

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
          stem: "What is the operator?",
          answerLabel: op,
          options: buildDistractors(op, { code }),
          sourceRefs: [sourceRef],
          generatorRule: "binary.op",
        });
      }
      return qs;
    },
  ],
  comparison: [
    ({ root, node, code, sourceRef }) => {
      const kids = node.namedChildren || [];
      if (kids.length < 2) return;
      const left = kids[0];
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
      // Collect keys from pairs: {k: v, **d} → only include explicit keys
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
      // Build a simple option pool by scanning nearby code for identifiers and strings
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
      } catch { }
      let pool = Array.from(new Set<string>([...keys, ...idPool, ...strPool]));
      if (pool.length < 10) {
        const needed = 10 - pool.length;
        const pad = shuffle(GENERIC_DISTRACTORS)
          .filter((d) => !pool.includes(d))
          .slice(0, needed);
        pool.push(...pad);
      }
      // Ensure all correct keys are included, then fill up to max
      const MAX = 10;
      const extras = shuffle(pool.filter((p) => !keys.includes(p)));
      const optionPool = shuffle([
        ...keys,
        ...extras.slice(0, Math.max(0, MAX - keys.length)),
      ]).slice(0, MAX);
      // Compute reveal anchors: show dict prefix up to first key, then reveal through last key
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
          answerLabel: keys[0], // unused for multi
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

// -------- Heuristic Orchestrator (Shallow/Deep) --------
type Profile = "shallow" | "deep";

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
  profile: Profile,
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
          ? items.reduce(
            (m, it) => Math.min(m, it.startIndex),
            items[0].startIndex
          )
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
          ? items2.reduce(
            (m, it) => Math.min(m, it.startIndex),
            items2[0].startIndex
          )
          : undefined;
        const lastEnd2 = items2.length
          ? items2.reduce(
            (m, it) => Math.max(m, it.endIndex),
            items2[0].endIndex
          )
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
              preview: code.slice(node.startIndex, node.endIndex).slice(0, 120),
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
        if (profile === "deep") {
          const deepQs = generateQuestionsV11(root, node, "deep", code).slice(
            0,
            opts?.maxDeepPerStmt ?? 6
          );
          for (const q of deepQs) {
            if (
              q.questionType === "multi" &&
              Array.isArray(q.multiCorrect) &&
              q.multiCorrect.length
            ) {
              const snippet = code.slice(node.startIndex, node.endIndex);
              cards.push({
                order: order++,
                type: q.kind,
                text: snippet,
                action: "next",
                question: q.stem,
                generatorRule: q.generatorRule,
                sourceRef: {
                  nodeType: node.type,
                  start: node.startIndex,
                  end: node.endIndex,
                  path: computeAstPath(root, node),
                  preview: snippet.slice(0, 120),
                },
                questionType: "multi",
                multiCorrect: q.multiCorrect,
                multiSelectHint: q.multiSelectHint ?? q.multiCorrect.length,
                optionPool: q.optionPool,
                // propagate reveal anchors when provided by rule
                revealStart: q.revealStart,
                revealEndBeforeChild: q.revealEndBeforeChild,
                revealEndAfterChild: q.revealEndAfterChild,
              } as any);
            } else {
              emitCard(q.answerLabel, q.stem, node, q.kind);
            }
          }
        }
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
