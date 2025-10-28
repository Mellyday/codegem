import type { TreeSitterAstNode } from "./treeSitter";
import {
  buildCuratedSections,
  childrenOfType,
  firstChildOfType,
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
};

type Rule = (ctx: RuleCtx) => Q11[] | undefined;

const rules: Record<string, Rule[]> = {
  assignment: [
    ({ root, node, code, sourceRef }) => {
      const kids = node.namedChildren || [];
      const left = kids[0];
      const right = kids[kids.length - 1];
      if (!left || !right) return;
      const leftText = textForRange(left.startIndex, left.endIndex, code) || left.type;
      const rightText = textForRange(right.startIndex, right.endIndex, code) || right.type;
      return [
        {
          kind: "identify-field",
          stem: "What is the left-hand side (target) of this assignment?",
          answerLabel: leftText,
          options: buildDistractors(leftText, { code }),
          sourceRefs: [
            sourceRef,
            { nodeType: left.type, start: left.startIndex, end: left.endIndex, path: computeAstPath(root, left) },
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
            { nodeType: right.type, start: right.startIndex, end: right.endIndex, path: computeAstPath(root, right) },
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
                  { nodeType: a.type, start: a.startIndex, end: a.endIndex, path: computeAstPath(root, a) },
                ],
                generatorRule: "call.kwarg-name",
              });
            }
          } else {
            pos += 1;
            const argText = textForRange(a.startIndex, a.endIndex, code) || a.type;
            qs.push({
              kind: "call-arg-positional",
              stem: `What is positional argument #${pos}?`,
              answerLabel: argText,
              options: buildDistractors(argText, { code }),
              sourceRefs: [
                sourceRef,
                { nodeType: a.type, start: a.startIndex, end: a.endIndex, path: computeAstPath(root, a) },
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
            const typText = textForRange(typeNode.startIndex, typeNode.endIndex, code) || "type";
            qs.push({
              kind: "param-type",
              stem: `What is the type of parameter #${idx + 1}?`,
              answerLabel: typText,
              options: buildDistractors(typText, { code }),
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
          (c) => c.type === "type" || c.type === "type_annotation" || c.fieldName === "return_type"
        );
        if (ret) {
          const retText = textForRange(ret.startIndex, ret.endIndex, code) || ret.type;
          qs.push({
            kind: "return-type",
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
  return (colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]).trimEnd();
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
    });
  };

  const emitHeader = (stmt: TreeSitterAstNode) => {
    const answerText = headerAnswer(stmt, code);
    emitCard(answerText, "Write the full header line", stmt, stmt.type, "header");
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    for (const stmt of block.namedChildren || []) walkStmt(stmt);
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
        for (const name of namesGroup?.items || []) {
          const txt = code.slice(name.startIndex, name.endIndex);
          emitCard(txt, "Which name is imported?", name, "imported_name");
        }
        break;
      }
      case "import_statement": {
        const groups = buildCuratedSections(node);
        const namesGroup = groups.find((g) => g.key === "names");
        for (const name of namesGroup?.items || []) {
          const txt = code.slice(name.startIndex, name.endIndex);
          emitCard(txt, "Which name is imported?", name, "imported_name");
        }
        break;
      }
      case "function_definition": {
        const sections = buildCuratedSections(node);
        const argsGroup = sections.find((s) => s.key === "args");
        const returnsGroup = sections.find((s) => s.key === "returns");
        const ordered = [argsGroup, returnsGroup].filter(Boolean) as typeof sections;
        for (const group of ordered) {
          for (let i = 0; i < group.items.length; i++) {
            const item = group.items[i];
            const text = code.substring(item.startIndex, item.endIndex);
            const question = group.key === "args"
              ? `What is the name or text of parameter #${i + 1}?`
              : "What is the return type?";
            emitCard(text, question, item, item.type, group.key);
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
        for (const h of (node.namedChildren || []).filter((c) => c.type.includes("except"))) {
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
          const deepQs = generateQuestionsV11(root, node, "deep", code).slice(0, opts?.maxDeepPerStmt ?? 6);
          for (const q of deepQs) emitCard(q.answerLabel, q.stem, node, q.kind);
        }
      }
    }
  };

  for (const top of root.namedChildren || []) walkStmt(top);
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

