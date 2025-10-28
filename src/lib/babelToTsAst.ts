import type { File as BabelFile } from "@babel/types";
import type { TreeSitterAstNode } from "./treeSitter";

type AnyBabelNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  } | null;
  [key: string]: any;
};

const isBabelNode = (v: any): v is AnyBabelNode =>
  v && typeof v === "object" && typeof v.type === "string" && ("start" in v || "end" in v);

const toPosition = (node: AnyBabelNode | undefined | null): { row: number; column: number } => {
  const line = node?.loc?.start?.line ?? 1;
  const column = node?.loc?.start?.column ?? 0;
  return { row: Math.max(0, line - 1), column: Math.max(0, column) };
};

const toEndPosition = (node: AnyBabelNode | undefined | null): { row: number; column: number } => {
  const line = node?.loc?.end?.line ?? 1;
  const column = node?.loc?.end?.column ?? 0;
  return { row: Math.max(0, line - 1), column: Math.max(0, column) };
};

export function adaptBabelToTsAst(file: BabelFile): TreeSitterAstNode {
  const root: AnyBabelNode = (file as unknown) as AnyBabelNode;

  const visit = (node: AnyBabelNode, parent?: AnyBabelNode, parentKey?: string): TreeSitterAstNode => {
    // Collect child nodes from enumerable properties
    const namedChildren: TreeSitterAstNode[] = [];
    for (const key of Object.keys(node)) {
      const value = (node as any)[key];
      if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
      if (isBabelNode(value)) {
        const child = visit(value, node, key);
        namedChildren.push(child);
      } else if (Array.isArray(value)) {
        for (const el of value) {
          if (isBabelNode(el)) {
            const child = visit(el, node, key);
            namedChildren.push(child);
          }
        }
      }
    }

    const startIndex = typeof node.start === "number" && node.start >= 0 ? node.start : 0;
    const endIndex = typeof node.end === "number" && node.end >= 0 ? node.end : startIndex;

    const base: TreeSitterAstNode = {
      type: node.type, // Keep Babel type names (e.g., FunctionDeclaration)
      named: true,
      startPosition: toPosition(node),
      endPosition: toEndPosition(node),
      startIndex,
      endIndex,
      text: undefined,
      children: [],
      namedChildren,
    };

    // Attach fieldName when known (property key from parent)
    if (parent && parentKey) {
      (base as any).fieldName = parentKey;
    }

    return base;
  };

  return visit(root, undefined, undefined);
}

