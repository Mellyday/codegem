import { Suspense } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { TreeSitterAstNode } from "../lib/treeSitter";
import { randomString, shuffleArray } from "../lib/utils";
import {
  cardsFromCuratedSections,
  findDeepestNodeCoveringSpan,
  findNearestAnchorCoveringSpan,
} from "../lib/pyCuration";
import { ErrorBoundary } from "./ErrorBoundary";
import { SavedCustomQuizzesPanel } from "./SavedCustomQuizzesPanel";

// Treat Python blocks/suites as body-owning containers
const BLOCK_TYPES = new Set(["block", "suite"]);

const CURATABLE_ANCHORS = new Set([
  "function_definition",
  "class_definition",
  "assignment",
  "expression_statement",
  "call",
  "if_statement", "if_stmt",
  "elif_clause", "else_clause",
  "for_statement", "for_stmt",
  "while_statement", "while_stmt",
  "with_statement",
  "try_statement",
]);
type QuizMode = "setup" | "active" | "complete";

export type QuizViewerProps = {
  root: TreeSitterAstNode;
  // Full source code for computing exact text of nodes
  code?: string;
  // File context to load saved custom quizzes
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  mode: QuizMode;
  onStart: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onReturnToAst: () => void;
  // Notify parent of the absolute end index to reveal in the code viewer
  onRevealChange?: (endIndex: number | undefined) => void;
};

type Question = {
  // Human-readable stem for the current question
  stem: string;
  // The label corresponding to the correct answer
  answerLabel: string;
  // Options to display
  options: string[];
  // Optional snippet text to show (used by custom quizzes)
  snippetText?: string;
  // Optional metadata for AST-sourced questions
  parentType?: string;
  childType?: string;
  index?: number;
  // Optional v1.1 metadata
  kind?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  sourceRefs?: SourceRef[];
  // For controlling how much of the parent's code to reveal while this question is active
  // Absolute indices within the source file. Only set for AST-sourced questions
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
};

const gatherContainerTypes = (node: TreeSitterAstNode, acc: Set<string>) => {
  if ((node.namedChildren || []).length > 0) {
    acc.add(node.type);
    for (const c of node.namedChildren || []) gatherContainerTypes(c, acc);
  }
  return acc;
};

const generateDistractors = (correct: string): string[] => {
  const out = new Set<string>();
  while (out.size < 3) {
    const d = randomString(correct.length);
    if (d !== correct) out.add(d);
  }
  return Array.from(out);
};

const textForNode = (
  node: TreeSitterAstNode,
  code?: string
): string | undefined => {
  if (node.text && node.text.length > 0) return node.text;
  if (code) {
    return code.substring(node.startIndex, node.endIndex);
  }
  return undefined;
};

const generateQuestions = (
  node: TreeSitterAstNode,
  breakdownTypes: Set<string>,
  code?: string
): Question[] => {
  const questions: Question[] = [];
  const children = node.namedChildren || [];
  children.forEach((child, idx) => {
    if (
      breakdownTypes.has(child.type) &&
      (child.namedChildren || []).length > 0
    ) {
      questions.push(...generateQuestions(child, breakdownTypes, code));
    } else {
      const childType = child.type;
      // Prefer the actual source text where available (identifier, parameters, etc.)
      const preferredLabel = textForNode(child, code) || childType;
      const distractors = generateDistractors(preferredLabel);
      const options = shuffleArray([preferredLabel, ...distractors]);

      // Compute reveal ranges relative to the parent
      const parentStart = node.startIndex;
      const revealStart = parentStart;
      const revealEndBeforeChild = child.startIndex;
      const revealEndAfterChild = child.endIndex;

      questions.push({
        stem: "What comes next?",
        answerLabel: preferredLabel,
        options,
        parentType: node.type,
        index: idx,
        childType,
        revealStart,
        revealEndBeforeChild,
        revealEndAfterChild,
      });
    }
  });
  return questions;
};

// v1.1: stable reference to an AST node or slice
type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

// Saved Custom Quiz structures (v1 and v1.1)
type SavedCustomQuizCardV11 = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  // v1.1 additions
  sourceRef?: SourceRef;
  semanticRole?: string;
  question?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
};

type SavedCustomQuizV11 = {
  id: string;
  kind: "custom-quiz";
  createdAt: string;
  typeLabel?: string; // e.g., CustomQuizV1.1
  profile?: "shallow" | "normal" | "deep";
  root: { type: string; text?: string; start?: number; end?: number; path?: number[] };
  totalCards: number;
  cards: SavedCustomQuizCardV11[];
};

// fetching of saved quizzes moved to SavedCustomQuizzesPanel

const generateQuestionsFromCustom = (
  quiz: SavedCustomQuizV11,
  code?: string,
  astRootFallback?: TreeSitterAstNode
): Question[] => {
  // Progressive “What comes next?” using saved card texts.
  // Attempts to compute absolute reveal indices by searching within the file's code.
  // Ignore any cards saved from a "dig deeper" action to prevent duplicates
  const cards = quiz.cards
    .filter((c) => c.action !== "dig")
    .slice()
    .sort((a, b) => a.order - b.order);
  const qs: Question[] = [];

  let rootStart = -1;
  if (typeof code === "string") {
    if (quiz.root.start !== undefined) rootStart = quiz.root.start;
    else if (quiz.root.text) rootStart = code.indexOf(quiz.root.text);
  }
  if (rootStart < 0 && astRootFallback) {
    rootStart = astRootFallback.startIndex;
  }

  let cursor = rootStart >= 0 ? rootStart : 0;

  for (const c of cards) {
    const correct = c.text;
    const options = shuffleArray([correct, ...generateDistractors(correct)]);
    const stem = c.question || "What comes next?";

    if (typeof code === "string" && rootStart >= 0) {
      let childStart = code.indexOf(correct, cursor);
      if (childStart < 0) {
        childStart = code.indexOf(correct, rootStart);
      }
      if (childStart >= 0) {
        const childEnd = childStart + correct.length;
        qs.push({
          stem,
          answerLabel: correct,
          options,
          kind: c.type,
          generatorRule: c.generatorRule,
          difficulty: c.difficulty,
          sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
          revealStart: rootStart,
          revealEndBeforeChild: childStart,
          revealEndAfterChild: childEnd,
        });
        cursor = childEnd;
        continue;
      }
    }

    // Fallback: no reveal indices if we cannot locate in source
    qs.push({
      stem,
      answerLabel: correct,
      options,
      kind: c.type,
      generatorRule: c.generatorRule,
      difficulty: c.difficulty,
      sourceRefs: c.sourceRef ? [c.sourceRef] : undefined,
    });
  }

  return qs;
};

// -------- v1.1 helpers for deeper breakdown --------
type DecompositionLevel = "shallow" | "normal" | "deep";

const computeAstPath = (
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

const resolveByPath = (
  root: TreeSitterAstNode,
  path: number[] | undefined
): TreeSitterAstNode | undefined => {
  if (!path) return undefined;
  let cur: TreeSitterAstNode | undefined = root;
  for (const idx of path) {
    if (!cur?.namedChildren || !cur.namedChildren[idx]) return undefined;
    cur = cur.namedChildren[idx];
  }
  return cur;
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

// Basic distractors upgrade stub (non-breaking)
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

// Helpers for reading fields and extracting operators/chains
const childByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).find((c) => c.fieldName === field);

const extractOperatorBetween = (
  code: string | undefined,
  leftEnd: number,
  rightStart: number
): string | undefined => {
  if (!code) return undefined;
  const raw = code.slice(leftEnd, rightStart).trim();
  // Compress inner whitespace to a single space
  return raw.replace(/\s+/g, " ");
};

type ChainLink = { kind: "attr" | "call"; name?: string; args?: TreeSitterAstNode[] };
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
      ? textForRange(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
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

// Minimal rule set: assignment and call; can expand incrementally
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
              nameNode && textForRange(nameNode.startIndex, nameNode.endIndex, code);
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
      const right = childByField(node, "right") || children[children.length - 1];
      if (!left || !right) return;
      const leftText = textForRange(left.startIndex, left.endIndex, code) || left.type;
      const rightText = textForRange(right.startIndex, right.endIndex, code) || right.type;
      const op = extractOperatorBetween(code, left.endIndex, right.startIndex);
      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the left operand?",
          answerLabel: leftText,
          options: buildDistractors(leftText, { code }),
          sourceRefs: [
            sourceRef,
            { nodeType: left.type, start: left.startIndex, end: left.endIndex, path: computeAstPath(root, left) },
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
            { nodeType: right.type, start: right.startIndex, end: right.endIndex, path: computeAstPath(root, right) },
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
      const leftText = textForRange(left.startIndex, left.endIndex, code) || left.type;
      qs.push({
        kind: "identify-field",
        stem: "What is the left operand?",
        answerLabel: leftText,
        options: buildDistractors(leftText, { code }),
        sourceRefs: [
          sourceRef,
          { nodeType: left.type, start: left.startIndex, end: left.endIndex, path: computeAstPath(root, left) },
        ],
        generatorRule: "comparison.left",
      });
      for (let i = 1; i < kids.length; i++) {
        const comp = kids[i];
        const compText = textForRange(comp.startIndex, comp.endIndex, code) || comp.type;
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
            { nodeType: comp.type, start: comp.startIndex, end: comp.endIndex, path: computeAstPath(root, comp) },
          ],
          generatorRule: "comparison.comparator",
        });
      }
      return qs;
    },
  ],
  subscript: [
    ({ root, node, code, sourceRef }) => {
      const valueNode = childByField(node, "value") || (node.namedChildren || [])[0];
      const second = childByField(node, "slice") || (node.namedChildren || [])[1];
      if (!valueNode) return;
      const valueText = textForRange(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the base being indexed?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            { nodeType: valueNode.type, start: valueNode.startIndex, end: valueNode.endIndex, path: computeAstPath(root, valueNode) },
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
                { nodeType: p.type, start: p.startIndex, end: p.endIndex, path: computeAstPath(root, p) },
              ],
              generatorRule: `slice.${labels[idx]}`,
            });
          });
        } else {
          const idxText = textForRange(second.startIndex, second.endIndex, code) || second.type;
          qs.push({
            kind: "identify-field",
            stem: "What is the index?",
            answerLabel: idxText,
            options: buildDistractors(idxText, { code }),
            sourceRefs: [
              sourceRef,
              { nodeType: second.type, start: second.startIndex, end: second.endIndex, path: computeAstPath(root, second) },
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
            { nodeType: p.type, start: p.startIndex, end: p.endIndex, path: computeAstPath(root, p) },
          ],
          generatorRule: `slice.${labels[idx]}`,
        });
      });
      return qs;
    },
  ],
  function_definition: [
    ({ root, node, code, sourceRef, profile }) => {
      const params = (node.namedChildren || []).find((c) => c.type === "parameters")?.namedChildren || [];
      const qs: Q11[] = [];
      params.forEach((p, idx) => {
        const nameNode = (p.namedChildren || []).find((c) => c.type === "identifier");
        if (nameNode) {
          const nameText = textForRange(nameNode.startIndex, nameNode.endIndex, code) || "param";
          qs.push({
            kind: "param-name",
            stem: `What is the name of parameter #${idx + 1}?`,
            answerLabel: nameText,
            options: buildDistractors(nameText, { code }),
            sourceRefs: [
              sourceRef,
              { nodeType: p.type, start: p.startIndex, end: p.endIndex, path: computeAstPath(root, p) },
            ],
            generatorRule: "func.param-name",
          });
        }
        if (profile !== "shallow") {
          const typeNode = (p.namedChildren || []).find(
            (c) => c.type === "type" || c.type === "type_annotation"
          );
          if (typeNode) {
            const typeText = textForRange(typeNode.startIndex, typeNode.endIndex, code) || "type";
            qs.push({
              kind: "param-type",
              stem: `What is the type annotation of parameter #${idx + 1}?`,
              answerLabel: typeText,
              options: buildDistractors(typeText, { code }),
              sourceRefs: [
                sourceRef,
                { nodeType: typeNode.type, start: typeNode.startIndex, end: typeNode.endIndex, path: computeAstPath(root, typeNode) },
              ],
              generatorRule: "func.param-type",
            });
          }
        }
      });
      if (profile !== "shallow") {
        const ret = (node.namedChildren || []).find(
          (c) => c.type === "type" || c.type === "return_type"
        );
        if (ret) {
          const retText = textForRange(ret.startIndex, ret.endIndex, code) || "type";
          qs.push({
            kind: "param-type",
            stem: "What is the return type of this function?",
            answerLabel: retText,
            options: buildDistractors(retText, { code }),
            sourceRefs: [
              sourceRef,
              { nodeType: ret.type, start: ret.startIndex, end: ret.endIndex, path: computeAstPath(root, ret) },
            ],
            generatorRule: "func.return-type",
          });
        }
      }
      return qs;
    },
  ],
};

function generateQuestionsV11(
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
  // Fallback: no decomposition
  return [];
}

export const QuizViewer = ({
  root,
  code,
  fileKey,
  mode,
  onStart,
  onCancel,
  onComplete,
  onReturnToAst,
  onRevealChange,
}: QuizViewerProps) => {
  // Setup state
  const containerTypes = useMemo(
    () => Array.from(gatherContainerTypes(root, new Set<string>())),
    [root]
  );
  const [breakdownTypes, setBreakdownTypes] = useState<Set<string>>(
    () => new Set(containerTypes.filter((t) => t === "block"))
  );

  // Custom quiz selection state
  const [selectedCustom, setSelectedCustom] = useState<
    SavedCustomQuizV11 | undefined
  >(undefined);

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [score, setScore] = useState(0);
  // Persist answers per question index so navigation retains choices
  const [answers, setAnswers] = useState<Array<string | undefined>>([]);
  // Track per-option expansion state (keyed by question+option index)
  const [expandedOptions, setExpandedOptions] = useState<
    Record<string, boolean>
  >({});
  // Marked questions
  const [marked, setMarked] = useState<Set<number>>(new Set());

  const toggleMark = (idx: number) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  useEffect(() => {
    if (mode === "active") {
      const qs = selectedCustom
        ? generateQuestionsFromCustom(selectedCustom, code, root)
        : generateQuestions(root, breakdownTypes, code);
      setQuestions(qs);
      setCurrent(0);
      setSelected(undefined);
      setScore(0);
      setAnswers(new Array(qs.length).fill(undefined));
      setExpandedOptions({});
      // Initial reveal if available (applies to AST and custom)
      if (qs.length > 0 && typeof qs[0].revealEndBeforeChild === "number") {
        onRevealChange?.(qs[0].revealEndBeforeChild);
      } else {
        onRevealChange?.(undefined);
      }
    }
  }, [mode, root, breakdownTypes, code, selectedCustom]);

  // Clear reveal when leaving quiz modes
  useEffect(() => {
    if (mode !== "active") {
      onRevealChange?.(undefined);
    }
  }, [mode, onRevealChange]);

  const total = questions.length;
  const currentQ = questions[current];

  const handleToggleType = (type: string) => {
    setBreakdownTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const renderSetup = () => {
    // Show unique container-like types available for breakdown selection
    const preview = generateQuestions(root, breakdownTypes);
    return (
      <div className="space-y-4">
        <div className="mb-2">
          <h3 className="text-lg font-semibold text-slate-800">Quiz Setup</h3>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Starting from: <span className="font-mono">{root.type}</span>
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-sm text-slate-700">
            Break down these node types into their children:
          </p>
          {containerTypes.length === 0 ? (
            <p className="text-xs italic text-slate-400">
              No container nodes detected
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {containerTypes.map((t) => (
                <li
                  key={t}
                  className="flex items-center gap-2 rounded bg-white px-2 py-1 text-sm shadow-sm"
                >
                  <input
                    id={`bd-${t}`}
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    checked={breakdownTypes.has(t)}
                    onChange={() => handleToggleType(t)}
                  />
                  <label
                    htmlFor={`bd-${t}`}
                    className="font-mono text-xs text-slate-700"
                  >
                    {t}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <span className="text-sm text-slate-700">
            Preview questions:{" "}
            <span className="font-semibold">{preview.length}</span>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600"
              onClick={() => {
                setSelectedCustom(undefined);
                onStart();
              }}
            >
              Start Quiz
            </button>
          </div>
        </div>

        <ErrorBoundary fallback={<div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600">Failed to load quizzes.</div>}>
          <Suspense fallback={<div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Loading saved quizzes…</div>}>
            <SavedCustomQuizzesPanel
              fileKey={fileKey}
              onStartSaved={(q) => {
                // panel is isolated; only it remounts on refresh/errors
                setSelectedCustom(q as any);
                onStart();
              }}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    );
  };

  const renderActive = () => {
    if (!currentQ) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Generating questions…
        </div>
      );
    }

    const answered = selected !== undefined;
    const correct = selected === currentQ.answerLabel;

    const handleSelect = (opt: string) => {
      if (answered) return;
      setSelected(opt);
      setAnswers((prev) => {
        const next = prev.slice();
        next[current] = opt;
        return next;
      });
      if (opt === currentQ.answerLabel) setScore((s) => s + 1);
      if (typeof currentQ.revealEndAfterChild === "number") {
        onRevealChange?.(currentQ.revealEndAfterChild);
      }
    };

    const next = () => {
      if (current + 1 >= total) {
        onComplete();
      } else {
        const nextIdx = current + 1;
        setCurrent(nextIdx);
        setSelected(answers[nextIdx]);
        // Update reveal window for the next question if available (AST or custom)
        const nextQ = questions[current + 1];
        if (nextQ && typeof nextQ.revealEndBeforeChild === "number") {
          onRevealChange?.(nextQ.revealEndBeforeChild);
        } else {
          onRevealChange?.(undefined);
        }
      }
    };

    const prev = () => {
      if (current > 0) {
        const idx = current - 1;
        setCurrent(idx);
        setSelected(answers[idx]);
        const q = questions[idx];
        if (q && typeof q.revealEndBeforeChild === "number") {
          onRevealChange?.(q.revealEndBeforeChild);
        } else {
          onRevealChange?.(undefined);
        }
      }
    };

    const jumpTo = (idx: number) => {
      if (!Number.isFinite(idx)) return;
      const clamped = Math.min(
        Math.max(0, Math.floor(idx)),
        Math.max(0, total - 1)
      );
      setCurrent(clamped);
      setSelected(answers[clamped]);
      const q = questions[clamped];
      if (q && typeof q.revealEndBeforeChild === "number") {
        onRevealChange?.(q.revealEndBeforeChild);
      } else {
        onRevealChange?.(undefined);
      }
    };

    const stepNavItems = (() => {
      const n = total;
      const cur = current;
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

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">
              {selectedCustom ? "Custom Quiz" : "AST Quiz"}
            </h3>
            {!selectedCustom && currentQ.parentType && (
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Parent: <span className="font-mono">{currentQ.parentType}</span>
              </p>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Q {current + 1} / {total} · Score {score}
            {marked.size > 0 && (
              <span className="ml-2 text-amber-600">· Marked {marked.size}</span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${total ? ((current + 1) / total) * 100 : 0}%` }}
          />
        </div>

        {/* Step navigator: chips + slider + go-to */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 -mx-2 px-2">
              {stepNavItems.map((it, idx) =>
                typeof it === "number" ? (
                  <button
                    key={`s-${idx}-${it}`}
                    type="button"
                    onClick={() => jumpTo(it)}
                    className={
                      it === current
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
                htmlFor="q-range"
                className="text-xs text-slate-500 whitespace-nowrap"
              >
                Jump
              </label>
              <input
                id="q-range"
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={current}
                onChange={(e) => jumpTo(Number(e.target.value))}
                className="h-1.5 w-40 cursor-pointer appearance-none rounded bg-slate-200 accent-amber-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={prev}
              disabled={current <= 0}
            >
              <ChevronsLeft className="h-4 w-4" />
              Prev
            </button>
            <div className="flex items-center gap-2">
              <label htmlFor="q-input" className="text-xs text-slate-500">
                Go to
              </label>
              <input
                id="q-input"
                type="number"
                min={1}
                max={Math.max(1, total)}
                defaultValue={current + 1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).valueAsNumber;
                    if (Number.isFinite(v)) jumpTo(v - 1);
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
                    if (Number.isFinite(v)) jumpTo(v - 1);
                  }
                }}
              >
                Go
              </button>
            </div>
            <button
              type="button"
              className={
                marked.has(current)
                  ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 shadow-sm"
                  : "rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              }
              onClick={() => toggleMark(current)}
            >
              {marked.has(current) ? "Unmark" : "Mark this"}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-amber-600 disabled:opacity-50"
              onClick={next}
              disabled={!answered}
            >
              {current + 1 >= total ? "Finish" : "Next"}
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-800">{currentQ.stem}</p>
          <p className="text-xs text-slate-500">
            Choose the next part of the code.
          </p>

          <ul className="mt-3 grid gap-2">
            {currentQ.options.map((opt, i) => {
              const isCorrect = opt === currentQ.answerLabel;
              const isSelected = selected === opt;
              const base =
                "w-full rounded-md border px-3 py-2 text-left text-sm shadow-sm";
              const idle =
                "border-slate-200 bg-white hover:bg-slate-50 text-slate-700";
              const correctCls = "border-green-200 bg-green-50 text-green-700";
              const wrongCls = "border-rose-200 bg-rose-50 text-rose-700";
              const answered = selected !== undefined;

              const cls = !answered
                ? `${base} ${idle}`
                : `${base} ${
                    isSelected ? (isCorrect ? correctCls : wrongCls) : isCorrect ? correctCls : idle
                  }`;

              const optionId = `${current}-${i}`;
              const isExpanded = !!expandedOptions[optionId];
              const isLong = opt.length > 100;

              return (
                <li key={optionId}>
                  {/* Make the whole row a non-button clickable region */}
                  <div className={`${cls}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="w-full text-left"
                      onClick={() => handleSelect(opt)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelect(opt);
                        }
                      }}
                    >
                      <span
                        className={`font-mono whitespace-pre-wrap break-all sm:break-words ${
                          isLong && !isExpanded ? "line-clamp-2" : ""
                        }`}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {opt}
                      </span>
                    </div>

                    {/* Show More/Less outside the clickable area and stop events early */}
                    {isLong && (
                      <button
                        type="button"
                        className="mt-1 text-xs font-semibold text-amber-600 hover:underline"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedOptions((prev) => ({
                            ...prev,
                            [optionId]: !prev[optionId],
                          }));
                        }}
                      >
                        {isExpanded ? "Show Less" : "Show More"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {answered && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                correct
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}
            >
              {correct
                ? "Correct!"
                : `Incorrect — answer: ${currentQ.answerLabel}`}
            </div>
          )}

          {/* Old inline breakdown/drill actions removed in favor of Mark flow */}
        </div>
      </div>
    );
  };

  // Helper to locate the AST node for a given question
  function nodeFromQuestion(
    q: Question,
    root: TreeSitterAstNode,
    code?: string
  ): TreeSitterAstNode | undefined {
    if (!root) return undefined;

    // Prefer block/suite if the span is exactly a block, else land on a statement anchor
    const resolveAnchor = (s: number, e: number) => {
      const deepest = findDeepestNodeCoveringSpan(root, s, e);
      if (deepest && BLOCK_TYPES.has(deepest.type)) {
        // If user marked a body span exactly, keep the block as the anchor
        return deepest;
      }
      const anchor = findNearestAnchorCoveringSpan(root, s, e, CURATABLE_ANCHORS);
      return anchor ?? deepest;
    };

    // Prefer explicit reveal spans (child range)
    if (
      typeof q.revealEndBeforeChild === "number" &&
      typeof q.revealEndAfterChild === "number"
    ) {
      const n = resolveAnchor(
        q.revealEndBeforeChild,
        q.revealEndAfterChild
      );
      if (n) return n;
    }

    // Fallback: locate answer text and resolve deepest covering node
    if (code && q.answerLabel) {
      const idx = code.indexOf(q.answerLabel);
      if (idx >= 0) {
        const n = resolveAnchor(idx, idx + q.answerLabel.length);
        if (n) return n;
      }
    }

    return undefined;
  }

  // Helpers to ensure we include a single body card for function definitions
  function findBlockChild(n?: TreeSitterAstNode) {
    if (!n?.namedChildren) return undefined;
    return n.namedChildren.find((c) => BLOCK_TYPES.has(c.type));
  }
  function hasBodyPiece(pieces: any[]) {
    return pieces.some(
      (p) =>
        p?.semanticRole === "body" ||
        p?.semanticRole === "block" ||
        p?.type === "body" ||
        p?.type === "block"
    );
  }

  function deriveCardsEnsuringBody(
    anchor: TreeSitterAstNode,
    code: string
  ): any[] {
    const isFunc = anchor.type === "function_definition";
    const hasBlock = !!findBlockChild(anchor);

    // Optional stable group ordering for common statements (handle _stmt/_statement)
    const isWhile =
      anchor.type === "while_statement" || anchor.type === "while_stmt";
    const isIf = anchor.type === "if_statement" || anchor.type === "if_stmt";
    const isFor = anchor.type === "for_statement" || anchor.type === "for_stmt";
    const isElif = anchor.type === "elif_clause";
    const isElse = anchor.type === "else_clause";
    const groupOrder =
      isFunc
        ? ["type_params", "args", "returns", "body", "decorators"]
      : isWhile
        ? ["test", "body", "orelse"]
      : isIf
        ? ["test", "body", "orelse"]
      : isElif
        ? ["test", "body"]
      : isElse
        ? ["body"]
      : isFor
        ? ["target", "iter", "body", "orelse"]
        : anchor.type === "with_statement"
        ? ["items", "body"]
        : anchor.type === "try_statement"
        ? ["body", "handlers", "orelse", "finalbody"]
        : undefined;

    let pieces =
      cardsFromCuratedSections(anchor, code, {
        // Show a single "body" card whenever this node actually owns a block/suite
        includeBody: hasBlock || isFunc,
        groupOrder,
      }) || [];

    // Fallback: if for any reason we still didn't get a body card but this node owns one,
    // synthesize exactly one body card from the block/suite span.
    if (hasBlock && !hasBodyPiece(pieces)) {
      const body = findBlockChild(anchor);
      if (body) {
        pieces = [
          ...pieces,
          {
            order: 0, // caller will overwrite
            type: "block",
            text: code.substring(body.startIndex, body.endIndex),
            action: "next" as const,
            semanticRole: "body",
            question: "What is the body?",
          },
        ];
      }
    }
    return pieces;
  }

  // Types and builders for saving derived quizzes
  type SavedCustomQuizCard = {
    order: number;
    type: string;
    text: string;
    source: "visited" | "pending";
    action: "next" | "dig";
    semanticRole?: string;
    question?: string;
  };

  function baseCardsFromQuestions(
    qs: Question[],
    code?: string
  ): SavedCustomQuizCard[] {
    return qs.map((q, i) => {
      const text =
        typeof q.revealEndBeforeChild === "number" &&
        typeof q.revealEndAfterChild === "number" &&
        code
          ? code.substring(q.revealEndBeforeChild, q.revealEndAfterChild)
          : q.answerLabel;
      return {
        order: i,
        type: q.childType || "unknown",
        text: String(text ?? ""),
        source: "visited",
        action: "next",
        semanticRole: q.parentType,
        question: q.stem,
      };
    });
  }

  function derivedCardsFromMarks(
    markedIdxs: number[],
    qs: Question[],
    root: TreeSitterAstNode,
    code: string
  ): SavedCustomQuizCard[] {
    let order = 0;
    const out: SavedCustomQuizCard[] = [];
    for (const qi of markedIdxs) {
      const q = qs[qi];
      if (!q) continue;
      const node = nodeFromQuestion(q, root, code);
      if (!node) continue;
      const cards = deriveCardsEnsuringBody(node, code).map((c) => ({
        ...c,
        order: order++,
        source: "visited" as const,
        action: "next" as const,
      }));
      out.push(...cards);
    }
    return out;
  }

  const renderComplete = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-800">Quiz Complete</h3>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          You can return to the AST view.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-700">Thanks for playing!</p>
      </div>
      <div className="flex justify-end gap-2">
        {code && (
          <>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={marked.size === 0}
              onClick={async () => {
                try {
                  const markedIdxs = Array.from(marked.values()).sort((a, b) => a - b);
                  const toSaveQs = markedIdxs.map((i) => questions[i]).filter(Boolean);
                  const only = baseCardsFromQuestions(toSaveQs, code).map((c, i) => ({
                    ...c,
                    order: i,
                  }));
                  if (only.length === 0) {
                    alert("Could not extract the marked card.");
                    return;
                  }
                  const payload = {
                    fileKey,
                    name: `Selected cards ${new Date().toLocaleString()}`,
                    type: "CustomQuizV1",
                    rootNode: {
                      type: root.type,
                      text: code.substring(root.startIndex, root.endIndex),
                    },
                    cards: only.map(({ order, type, text, action, question }) => ({
                      order,
                      type,
                      text,
                      action,
                      question,
                    })),
                  } as any;

                  const res = await fetch("/api/quizzes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  alert("Saved quiz with only the marked cards.");
                } catch (err) {
                  console.error(err);
                  alert("Failed to save single-card quiz.");
                }
              }}
            >
              Save: Only Marked
            </button>

            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={marked.size === 0}
              onClick={async () => {
                try {
                  const markedIdxs = Array.from(marked.values()).sort((a, b) => a - b);
                  const base = baseCardsFromQuestions(questions, code);
                  const markedSet = new Set(markedIdxs);
                  // Precompute derived pieces per marked index
                  const derivedByIndex = new Map<number, ReturnType<typeof baseCardsFromQuestions>>();
                  for (const idx of markedIdxs) {
                    const anchorQ = questions[idx];
                    const anchorNode = nodeFromQuestion(anchorQ, root, code);
                    if (!anchorNode) continue;
                    const pieces = deriveCardsEnsuringBody(anchorNode, code).map((c) => ({
                      ...c,
                      source: "visited" as const,
                      action: "next" as const,
                    }));
                    // If nothing derived, fall back to the original base card
                    derivedByIndex.set(idx, pieces.length ? pieces : [base[idx]]);
                  }

                  // Build combined by replacing each marked card with its derived pieces, in-place
                  const combined: typeof base = [] as any;
                  for (let i = 0; i < base.length; i++) {
                    if (markedSet.has(i)) {
                      const parts = derivedByIndex.get(i) || [];
                      combined.push(...parts);
                    } else {
                      combined.push(base[i]);
                    }
                  }
                  // Normalize order
                  for (let i = 0; i < combined.length; i++) combined[i].order = i;

                  if (combined.length === 0) {
                    alert("Nothing to save.");
                    return;
                  }

                  const payload = {
                    fileKey,
                    name: `Mixed drill ${new Date().toLocaleString()}`,
                    type: "CustomQuizV1",
                    rootNode: {
                      type: root.type,
                      text: code.substring(root.startIndex, root.endIndex),
                    },
                    cards: combined.map(({ order, type, text, action, question }) => ({
                      order,
                      type,
                      text,
                      action,
                      question,
                    })),
                  } as any;

                  const res = await fetch("/api/quizzes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  alert("Saved quiz with breakdown inserted at each marked position.");
                } catch (err) {
                  console.error(err);
                  alert("Failed to save mixed quiz.");
                }
              }}
            >
              Save: Insert Breakdown
            </button>
          </>
        )}
        {!selectedCustom && (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            onClick={async () => {
              const exportPayload = {
                type: "ast-quiz",
                root: {
                  type: root.type,
                  startIndex: root.startIndex,
                  endIndex: root.endIndex,
                },
                totalQuestions: questions.length,
                questions: questions.map((q, i) => ({
                  index: i,
                  stem: q.stem,
                  parentType: q.parentType,
                  childType: q.childType,
                  correctAnswer: q.answerLabel,
                  revealStart: q.revealStart,
                  revealEndBeforeChild: q.revealEndBeforeChild,
                  revealEndAfterChild: q.revealEndAfterChild,
                  codeSnippet:
                    typeof code === "string" &&
                    typeof q.revealStart === "number" &&
                    typeof q.revealEndBeforeChild === "number"
                      ? code.substring(q.revealStart, q.revealEndBeforeChild)
                      : undefined,
                  childText:
                    typeof code === "string" &&
                    typeof q.revealEndBeforeChild === "number" &&
                    typeof q.revealEndAfterChild === "number"
                      ? code.substring(
                          q.revealEndBeforeChild,
                          q.revealEndAfterChild
                        )
                      : undefined,
                  options: q.options,
                })),
              };

              const json = JSON.stringify(exportPayload, null, 2);

              const fallbackCopy = (text: string) => {
                try {
                  const ta = document.createElement("textarea");
                  ta.value = text;
                  ta.style.position = "fixed";
                  ta.style.left = "-9999px";
                  document.body.appendChild(ta);
                  ta.focus();
                  ta.select();
                  document.execCommand("copy");
                  document.body.removeChild(ta);
                  return true;
                } catch {
                  return false;
                }
              };

              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(json);
                } else {
                  const ok = fallbackCopy(json);
                  if (!ok) throw new Error("Clipboard unavailable");
                }
              } catch {
                // ignore
              }
            }}
          >
            Copy JSON
          </button>
        )}
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

  return (
    <div className="space-y-3">
      {mode === "setup" && renderSetup()}
      {mode === "active" && renderActive()}
      {mode === "complete" && renderComplete()}
    </div>
  );
};
