import type { TreeSitterAstNode } from "./treeSitter";

export type CuratedSection = {
  key: string;
  items: TreeSitterAstNode[];
};

export const childrenOfType = (node: TreeSitterAstNode, type: string) =>
  (node.namedChildren || []).filter((c) => c.type === type);

export const firstChildOfType = (node: TreeSitterAstNode, type: string) =>
  (node.namedChildren || []).find((c) => c.type === type);

export const childrenByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).filter((c) => (c as any).fieldName === field);

export const childByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).find((c) => (c as any).fieldName === field);

export const buildCuratedSections = (node: TreeSitterAstNode): CuratedSection[] => {
  switch (node.type) {
    // Top-level
    case "File":
    case "Program":
      return [{ key: "body", items: node.namedChildren || [] }];

    // Functions
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const id = childByField(node, "id");
      const params = childrenByField(node, "params");
      const body = childByField(node, "body") || firstChildOfType(node, "BlockStatement");
      return [
        { key: "name", items: id ? [id] : [] },
        { key: "params", items: params },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    // Classes
    case "ClassDeclaration":
    case "ClassExpression": {
      const id = childByField(node, "id");
      const superClass = childByField(node, "superClass");
      const body = childByField(node, "body") || firstChildOfType(node, "ClassBody");
      return [
        { key: "name", items: id ? [id] : [] },
        { key: "super", items: superClass ? [superClass] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }
    case "ClassBody": {
      return [{ key: "body", items: node.namedChildren || [] }];
    }
    case "ClassMethod":
    case "ObjectMethod":
    case "ClassProperty":
    case "ClassPrivateProperty":
    case "MethodDefinition": {
      const key = childByField(node, "key");
      const params = childrenByField(node, "params");
      const value = childByField(node, "value");
      const body = childByField(node, "body") || firstChildOfType(node, "BlockStatement");
      return [
        { key: "key", items: key ? [key] : [] },
        { key: params.length ? "params" : "value", items: params.length ? params : value ? [value] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    // Variables
    case "VariableDeclaration": {
      const decls = childrenByField(node, "declarations");
      return [{ key: "declarations", items: decls.length ? decls : (node.namedChildren || []) }];
    }
    case "VariableDeclarator": {
      const id = childByField(node, "id");
      const init = childByField(node, "init");
      return [
        { key: "id", items: id ? [id] : [] },
        { key: "init", items: init ? [init] : [] },
      ];
    }

    // Calls & members
    case "CallExpression": {
      const callee = childByField(node, "callee") || (node.namedChildren || [])[0];
      const args = childrenByField(node, "arguments");
      return [
        { key: "callee", items: callee ? [callee] : [] },
        { key: "args", items: args.length ? args : (node.namedChildren || []).slice(1) },
      ];
    }
    case "NewExpression": {
      const callee = childByField(node, "callee");
      const args = childrenByField(node, "arguments");
      return [
        { key: "constructor", items: callee ? [callee] : [] },
        { key: "args", items: args },
      ];
    }
    case "MemberExpression": {
      const obj = childByField(node, "object") || (node.namedChildren || [])[0];
      const prop = childByField(node, "property") || (node.namedChildren || [])[1];
      return [
        { key: "object", items: obj ? [obj] : [] },
        { key: "property", items: prop ? [prop] : [] },
      ];
    }

    // Control flow
    case "IfStatement": {
      const test = childByField(node, "test");
      const cons = childByField(node, "consequent");
      const alt = childByField(node, "alternate");
      return [
        { key: "test", items: test ? [test] : [] },
        { key: "consequent", items: cons ? [cons] : [] },
        { key: "alternate", items: alt ? [alt] : [] },
      ];
    }
    case "WhileStatement": {
      const test = childByField(node, "test");
      const body = childByField(node, "body");
      return [
        { key: "test", items: test ? [test] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }
    case "ForStatement": {
      const init = childByField(node, "init");
      const test = childByField(node, "test");
      const update = childByField(node, "update");
      const body = childByField(node, "body");
      return [
        { key: "init", items: init ? [init] : [] },
        { key: "test", items: test ? [test] : [] },
        { key: "update", items: update ? [update] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }
    case "ForInStatement":
    case "ForOfStatement": {
      const left = childByField(node, "left");
      const right = childByField(node, "right");
      const body = childByField(node, "body");
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    // Expressions
    case "ReturnStatement": {
      const arg = childByField(node, "argument");
      return [{ key: "argument", items: arg ? [arg] : [] }];
    }
    case "AssignmentExpression":
    case "AssignmentPattern": {
      const left = childByField(node, "left") || (node.namedChildren || [])[0];
      const right = childByField(node, "right") || (node.namedChildren || [])[1];
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
      ];
    }
    case "BinaryExpression":
    case "LogicalExpression": {
      const left = childByField(node, "left") || (node.namedChildren || [])[0];
      const right = childByField(node, "right") || (node.namedChildren || [])[1];
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
      ];
    }
    case "ConditionalExpression": {
      const test = childByField(node, "test");
      const cons = childByField(node, "consequent");
      const alt = childByField(node, "alternate");
      return [
        { key: "test", items: test ? [test] : [] },
        { key: "consequent", items: cons ? [cons] : [] },
        { key: "alternate", items: alt ? [alt] : [] },
      ];
    }
    case "ArrayExpression": {
      return [{ key: "elements", items: node.namedChildren || [] }];
    }
    case "ObjectExpression": {
      return [{ key: "properties", items: node.namedChildren || [] }];
    }

    // Modules
    case "ImportDeclaration": {
      const source = childByField(node, "source");
      const specs = childrenByField(node, "specifiers");
      return [
        { key: "source", items: source ? [source] : [] },
        { key: "specifiers", items: specs },
      ];
    }
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration":
    case "ExportAllDeclaration": {
      const decl = childByField(node, "declaration");
      const specs = childrenByField(node, "specifiers");
      const src = childByField(node, "source");
      return [
        { key: "declaration", items: decl ? [decl] : [] },
        { key: "specifiers", items: specs },
        { key: "source", items: src ? [src] : [] },
      ];
    }

    default:
      return [{ key: "children", items: node.namedChildren || [] }];
  }
};

export function findDeepestNodeCoveringSpan(
  root: TreeSitterAstNode,
  start: number,
  end: number
): TreeSitterAstNode | undefined {
  let best: TreeSitterAstNode | undefined;
  const dfs = (n: TreeSitterAstNode) => {
    if (n.startIndex <= start && n.endIndex >= end) {
      best = n;
      for (const c of n.namedChildren || []) dfs(c);
    }
  };
  dfs(root);
  return best;
}

export function findNearestAnchorCoveringSpan(
  root: TreeSitterAstNode,
  start: number,
  end: number,
  types: Set<string>
): TreeSitterAstNode | undefined {
  let best: TreeSitterAstNode | undefined;
  const dfs = (n: TreeSitterAstNode) => {
    if (n.startIndex <= start && n.endIndex >= end) {
      if (types.has(n.type)) best = n;
      for (const c of n.namedChildren || []) dfs(c);
    }
  };
  dfs(root);
  return best;
}

export function cardsFromCuratedSections(
  node: TreeSitterAstNode,
  code: string,
  opts: { includeBody?: boolean; groupOrder?: string[] } = {}
): Array<{
  order: number;
  type: string;
  text: string;
  action: "next";
  semanticRole?: string;
  question?: string;
}> {
  const sections = buildCuratedSections(node).filter((s) => s.items.length > 0);
  const includeBody = opts.includeBody ?? false;
  const inlineHints = sections.filter((s) => {
    if (s.items.length === 0) return false;
    if (s.key === "body") return !includeBody;
    return s.items.every((it) => it.type === "BlockStatement");
  });
  let flatGroups = sections.filter((s) => !inlineHints.includes(s));

  if (opts.groupOrder && opts.groupOrder.length) {
    const priority = new Map<string, number>();
    opts.groupOrder.forEach((k, i) => priority.set(k, i));
    const sectionIndex = new Map<CuratedSection, number>();
    sections.forEach((s, i) => sectionIndex.set(s, i));
    flatGroups = [...flatGroups].sort((a, b) => {
      const pa = priority.has(a.key) ? (priority.get(a.key) as number) : Number.MAX_SAFE_INTEGER;
      const pb = priority.has(b.key) ? (priority.get(b.key) as number) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const ia = sectionIndex.get(a) as number;
      const ib = sectionIndex.get(b) as number;
      return ia - ib;
    });
  }

  let order = 0;
  const out: Array<{
    order: number;
    type: string;
    text: string;
    action: "next";
    semanticRole?: string;
    question?: string;
  }> = [];

  const qFor = (nodeType: string, key: string, idx: number) => {
    if ((nodeType.includes("Function") || nodeType === "MethodDefinition") && key === "params")
      return `What is the parameter #${idx + 1}?`;
    if (key === "body") return "What is the body?";
    if ((nodeType === "CallExpression" || nodeType === "NewExpression") && key === "callee")
      return "Which function/class is being called?";
    if ((nodeType === "CallExpression" || nodeType === "NewExpression") && key === "args")
      return `What is positional argument #${idx + 1}?`;
    if (key === "id" || key === "name") return "What is the name?";
    if (key === "left") return "What is the left-hand side?";
    if (key === "right") return "What is the right-hand side?";
    return `What is the ${key}?`;
  };

  flatGroups.forEach((group) => {
    group.items.forEach((item, idx) => {
      const text = code.substring(item.startIndex, item.endIndex);
      out.push({
        order: order++,
        type: item.type,
        text,
        action: "next",
        semanticRole: group.key,
        question: qFor(node.type, group.key, idx),
      });
    });
  });

  return out;
}

