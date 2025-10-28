import type { TreeSitterAstNode } from "./treeSitter";
import { buildCuratedSections, childrenOfType, firstChildOfType } from "./jsCuration";

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

type DecompositionLevel = "shallow" | "normal" | "deep";

type Q11 = {
  stem: string;
  kind: string;
  answerLabel: string;
  options: string[];
  sourceRefs: { nodeType: string; start: number; end: number; path: number[] }[];
  generatorRule: string;
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

function buildDistractors(correct: string): string[] {
  const out = new Set<string>();
  while (out.size < 3) {
    const v = correct.length > 1 ? correct.slice(0, -1) : correct + "_";
    if (v && v !== correct) out.add(v);
    if (out.size < 3) out.add(correct + "?");
    if (out.size < 3) out.add(correct.toUpperCase());
  }
  return Array.from(out);
}

export function buildHeuristicQuiz(
  root: TreeSitterAstNode,
  code: string,
  profile: DecompositionLevel,
  opts?: { maxQuestions?: number; maxDeepPerStmt?: number }
) {
  const cards: {
    order: number;
    type: string;
    text: string;
    action: "next";
    stem: string;
    generatorRule?: string;
  }[] = [];
  let order = 0;

  const emitCard = (
    text: string,
    stem: string,
    node: TreeSitterAstNode,
    kind?: string
  ) => {
    cards.push({
      order: order++,
      type: kind || node.type,
      text,
      action: "next",
      stem,
      generatorRule: kind,
    });
  };

  const header = (n: TreeSitterAstNode) => {
    const line = code.slice(n.startIndex, n.endIndex).split("\n")[0] || n.type;
    emitCard(line, "What is the header?", n, "header");
  };

  const walkBlock = (blk: TreeSitterAstNode) => {
    for (const ch of blk.namedChildren || []) walkStmt(ch);
  };

  const walkStmt = (node: TreeSitterAstNode) => {
    switch (node.type) {
      case "ImportDeclaration": {
        const sections = buildCuratedSections(node);
        const src = sections.find((s) => s.key === "source")?.items?.[0];
        if (src) emitCard(code.slice(src.startIndex, src.endIndex), "What is the import source?", src, "import_source");
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const sections = buildCuratedSections(node);
        const params = sections.find((s) => s.key === "params");
        const body = sections.find((s) => s.key === "body");
        if (params) {
          params.items.forEach((p, i) => {
            const t = code.slice(p.startIndex, p.endIndex) || p.type;
            emitCard(t, `What is parameter #${i + 1}?`, p, "param");
          });
        }
        if (body?.items?.[0]) walkBlock(body.items[0]);
        break;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const body = firstChildOfType(node, "ClassBody");
        if (body) walkBlock(body);
        break;
      }
      case "IfStatement": {
        header(node);
        const cons = (node.namedChildren || []).find((c) => (c as any).fieldName === "consequent");
        const alt = (node.namedChildren || []).find((c) => (c as any).fieldName === "alternate");
        if (cons) walkBlock(cons);
        if (alt) walkBlock(alt);
        break;
      }
      case "WhileStatement":
      case "ForStatement":
      case "ForOfStatement":
      case "ForInStatement": {
        header(node);
        const body = (node.namedChildren || []).find((c) => (c as any).fieldName === "body");
        if (body) walkBlock(body);
        break;
      }
      default: {
        const text = code.slice(node.startIndex, node.endIndex) || node.type;
        emitCard(text, "What comes next?", node);
        if (profile === "deep") {
          const sections = buildCuratedSections(node);
          for (const s of sections) {
            for (const it of s.items) {
              const t = code.slice(it.startIndex, it.endIndex) || it.type;
              emitCard(t, `What is the ${s.key}?`, it, s.key);
            }
          }
        }
      }
    }
  };

  for (const top of root.namedChildren || []) walkStmt(top);
  if (typeof opts?.maxQuestions === "number") cards.length = Math.min(cards.length, opts.maxQuestions);

  return {
    id: "",
    kind: "custom-quiz",
    createdAt: new Date().toISOString(),
    typeLabel: "CustomQuizV1.1",
    profile,
    root: { type: root.type, start: root.startIndex, end: root.endIndex },
    totalCards: cards.length,
    cards,
  } as const;
}
