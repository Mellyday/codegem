import type { TreeSitterAstNode } from "../../treeSitter";

export type CuratedSection = {
  key: string;
  items: TreeSitterAstNode[];
};

// Basic helpers
export const childrenOfType = (node: TreeSitterAstNode, type: string) =>
  (node.namedChildren || []).filter((c) => c.type === type);

export const firstChildOfType = (node: TreeSitterAstNode, type: string) =>
  childrenOfType(node, type)[0];

export const childrenByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).filter((c) => c.fieldName === field);

export const childByField = (node: TreeSitterAstNode, field: string) =>
  childrenByField(node, field)[0];

export const firstChildOfTypes = (node: TreeSitterAstNode, types: string[]) =>
  (node.namedChildren || []).find((c) => types.includes(c.type));

export const collectDescendants = (
  node: TreeSitterAstNode,
  predicate: (n: TreeSitterAstNode) => boolean,
  out: TreeSitterAstNode[] = []
): TreeSitterAstNode[] => {
  for (const child of node.namedChildren || []) {
    if (predicate(child)) out.push(child);
    collectDescendants(child, predicate, out);
  }
  return out;
};

// Convenience helpers for consuming curated sections
export const getSectionItems = (
  node: TreeSitterAstNode,
  key: string
): TreeSitterAstNode[] => {
  const sections = buildCuratedSections(node);
  return sections.find((s) => s.key === key)?.items || [];
};

export const getSectionFirstItem = (
  node: TreeSitterAstNode,
  key: string
): TreeSitterAstNode | undefined => getSectionItems(node, key)[0];

// Ruby does not have docstrings in the Python sense.
export const isDocstringNode = () => false;

// For interface parity with Python curation
export const isYieldFrom = () => false;

const BODY_NODE_TYPES = [
  "body_statement",
  "statement_list",
  "block",
  "do_block",
  "brace_block",
];

const getBodyNode = (node: TreeSitterAstNode) =>
  childByField(node, "body") || firstChildOfTypes(node, BODY_NODE_TYPES);

const getArgsNode = (node: TreeSitterAstNode) =>
  childByField(node, "arguments") ||
  firstChildOfTypes(node, [
    "argument_list",
    "argument_list_with_parentheses",
    "arguments",
    "command_argument_list",
    "parenthesized_arguments",
  ]);

const getCallNameNode = (node: TreeSitterAstNode) =>
  childByField(node, "method") ||
  childByField(node, "name") ||
  childByField(node, "message") ||
  firstChildOfTypes(node, ["identifier", "constant", "operator"]);

const getCallReceiverNode = (node: TreeSitterAstNode) =>
  childByField(node, "receiver") || childByField(node, "object");

const getParamsNode = (node: TreeSitterAstNode) =>
  childByField(node, "parameters") ||
  childByField(node, "params") ||
  firstChildOfTypes(node, [
    "parameters",
    "method_parameters",
    "parameter_list",
    "block_parameters",
  ]);

const inferConditionNode = (node: TreeSitterAstNode) => {
  const byField =
    childByField(node, "condition") ||
    childByField(node, "test") ||
    childByField(node, "predicate");
  if (byField) return byField;
  const body = getBodyNode(node);
  const fallbacks = (node.namedChildren || []).filter(
    (c) => c !== body && c.type !== "else" && c.type !== "elsif"
  );
  return fallbacks[0];
};

const inferElseNode = (node: TreeSitterAstNode) =>
  childByField(node, "alternative") ||
  childByField(node, "else") ||
  firstChildOfTypes(node, ["else", "elsif"]);

const inferWhenConditions = (node: TreeSitterAstNode) => {
  const byField =
    childByField(node, "conditions") ||
    childByField(node, "condition") ||
    childByField(node, "pattern");
  if (byField) {
    return byField.namedChildren?.length ? byField.namedChildren : [byField];
  }
  const body = getBodyNode(node);
  return (node.namedChildren || []).filter((c) => c !== body);
};

const inferRescueExceptions = (node: TreeSitterAstNode) => {
  const byField =
    childByField(node, "exceptions") ||
    childByField(node, "exception") ||
    childByField(node, "exception_class");
  if (byField) {
    return byField.namedChildren?.length ? byField.namedChildren : [byField];
  }
  const body = getBodyNode(node);
  return (node.namedChildren || []).filter((c) => c !== body);
};

const inferRescueBinding = (node: TreeSitterAstNode) =>
  childByField(node, "binding") ||
  childByField(node, "name") ||
  childByField(node, "variable");

// Curated sections for Ruby constructs
export const buildCuratedSections = (
  node: TreeSitterAstNode
): CuratedSection[] => {
  switch (node.type) {
    case "call":
    case "command":
    case "command_call":
    case "method_call": {
      const name = getCallNameNode(node);
      const receiver = getCallReceiverNode(node);
      const argsNode = getArgsNode(node);
      const args = argsNode ? argsNode.namedChildren || [] : [];
      return [
        { key: "receiver", items: receiver ? [receiver] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "args", items: args },
      ];
    }

    case "block":
    case "do_block":
    case "brace_block": {
      const callNode =
        childByField(node, "call") ||
        firstChildOfTypes(node, ["call", "command", "command_call", "method_call"]);
      const paramsNode =
        childByField(node, "block_parameters") || getParamsNode(node);
      const body = getBodyNode(node);
      return [
        { key: "call", items: callNode ? [callNode] : [] },
        { key: "block_params", items: paramsNode ? [paramsNode] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "class": {
      const name =
        childByField(node, "name") ||
        firstChildOfTypes(node, ["constant", "identifier"]);
      const superclass =
        childByField(node, "superclass") || childByField(node, "parent");
      const body = getBodyNode(node);
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "superclass", items: superclass ? [superclass] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "module": {
      const name =
        childByField(node, "name") ||
        firstChildOfTypes(node, ["constant", "identifier"]);
      const body = getBodyNode(node);
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "singleton_class": {
      const receiver =
        childByField(node, "receiver") || firstChildOfTypes(node, ["self", "constant", "identifier"]);
      const body = getBodyNode(node);
      return [
        { key: "receiver", items: receiver ? [receiver] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "method":
    case "method_definition": {
      const name =
        childByField(node, "name") ||
        firstChildOfTypes(node, ["identifier", "constant"]);
      const paramsNode = getParamsNode(node);
      const body = getBodyNode(node);
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: paramsNode ? [paramsNode] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "singleton_method":
    case "singleton_method_definition": {
      const receiver =
        childByField(node, "receiver") || firstChildOfTypes(node, ["self", "constant", "identifier"]);
      const name =
        childByField(node, "name") ||
        firstChildOfTypes(node, ["identifier", "constant"]);
      const paramsNode = getParamsNode(node);
      const body = getBodyNode(node);
      return [
        { key: "receiver", items: receiver ? [receiver] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: paramsNode ? [paramsNode] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "assignment": {
      const target =
        childByField(node, "left") ||
        childByField(node, "lhs") ||
        childByField(node, "target") ||
        (node.namedChildren || [])[0];
      const value =
        childByField(node, "right") ||
        childByField(node, "rhs") ||
        childByField(node, "value") ||
        (node.namedChildren || [])[1];
      return [
        { key: "target", items: target ? [target] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    case "multiple_assignment": {
      const left =
        childByField(node, "left") ||
        childByField(node, "lhs") ||
        (node.namedChildren || [])[0];
      const right =
        childByField(node, "right") ||
        childByField(node, "rhs") ||
        (node.namedChildren || [])[1];
      const targets = left
        ? left.namedChildren?.length
          ? left.namedChildren
          : [left]
        : [];
      const values = right
        ? right.namedChildren?.length
          ? right.namedChildren
          : [right]
        : [];
      return [
        { key: "targets", items: targets },
        { key: "values", items: values },
      ];
    }

    case "hash": {
      const keys: TreeSitterAstNode[] = [];
      const values: TreeSitterAstNode[] = [];
      for (const child of node.namedChildren || []) {
        if (child.type === "pair") {
          const key = childByField(child, "key") || child.namedChildren?.[0];
          const value = childByField(child, "value") || child.namedChildren?.[1];
          if (key) keys.push(key);
          if (value) values.push(value);
        }
      }
      return [
        { key: "keys", items: keys },
        { key: "values", items: values },
      ];
    }

    case "if":
    case "unless":
    case "elsif":
    case "if_modifier":
    case "unless_modifier": {
      const condition = inferConditionNode(node);
      const body = getBodyNode(node);
      const elseNode = inferElseNode(node);
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "else", items: elseNode ? [elseNode] : [] },
      ];
    }

    case "case": {
      const subject =
        childByField(node, "subject") ||
        childByField(node, "value") ||
        (node.namedChildren || []).find(
          (c) => c.type !== "when" && c.type !== "when_clause" && c.type !== "else"
        );
      const whens = (node.namedChildren || []).filter(
        (c) => c.type === "when" || c.type === "when_clause"
      );
      const elseNode = childByField(node, "else") || firstChildOfType(node, "else");
      return [
        { key: "subject", items: subject ? [subject] : [] },
        { key: "whens", items: whens },
        { key: "else", items: elseNode ? [elseNode] : [] },
      ];
    }

    case "when":
    case "when_clause": {
      const body = getBodyNode(node);
      const conditions = inferWhenConditions(node);
      return [
        { key: "conditions", items: conditions },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "while":
    case "until":
    case "for":
    case "while_modifier":
    case "until_modifier": {
      const condition = inferConditionNode(node);
      const body = getBodyNode(node);
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "begin": {
      const body = getBodyNode(node);
      const rescues = (node.namedChildren || []).filter(
        (c) => c.type === "rescue" || c.type === "rescue_clause"
      );
      const elseNode = childByField(node, "else") || firstChildOfType(node, "else");
      const ensureNode =
        childByField(node, "ensure") || firstChildOfType(node, "ensure");
      return [
        { key: "body", items: body ? [body] : [] },
        { key: "rescues", items: rescues },
        { key: "else", items: elseNode ? [elseNode] : [] },
        { key: "ensure", items: ensureNode ? [ensureNode] : [] },
      ];
    }

    case "rescue":
    case "rescue_clause": {
      const body = getBodyNode(node);
      const exceptions = inferRescueExceptions(node);
      const binding = inferRescueBinding(node);
      return [
        { key: "exceptions", items: exceptions },
        { key: "binding", items: binding ? [binding] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "ensure": {
      const body = getBodyNode(node);
      return [{ key: "body", items: body ? [body] : [] }];
    }

    default: {
      return [{ key: "children", items: node.namedChildren || [] }];
    }
  }
};

// =====================================================================
// Reveal Anchors
// =====================================================================

export type RevealAnchors = {
  headerEnd: number;
  contentStart?: number;
  contentEnd?: number;
};

export function getRevealAnchors(node: TreeSitterAstNode): RevealAnchors {
  const sections = buildCuratedSections(node);

  const bodySection =
    sections.find((s) => s.key === "body") ||
    sections.find((s) => s.key === "then") ||
    sections.find((s) => s.key === "consequence");
  const body = bodySection?.items[0];

  let headerEnd = body?.startIndex ?? node.endIndex;

  if (node.type === "case") {
    const whens = sections.find((s) => s.key === "whens")?.items || [];
    if (whens.length > 0) headerEnd = whens[0].startIndex;
  }

  const contentSections = sections.filter(
    (s) =>
      s.key !== "body" &&
      s.key !== "else" &&
      s.key !== "ensure" &&
      s.key !== "rescues" &&
      s.items.length > 0
  );
  const allContentItems = contentSections.flatMap((s) => s.items);

  let contentStart: number | undefined;
  let contentEnd: number | undefined;
  if (allContentItems.length > 0) {
    contentStart = Math.min(...allContentItems.map((n) => n.startIndex));
    contentEnd = Math.max(...allContentItems.map((n) => n.endIndex));
  }

  return { headerEnd, contentStart, contentEnd };
}

export function getSectionSpan(
  node: TreeSitterAstNode,
  sectionKey: string
): { start: number; end: number } | undefined {
  const items = getSectionItems(node, sectionKey);
  if (items.length === 0) return undefined;
  const start = Math.min(...items.map((n) => n.startIndex));
  const end = Math.max(...items.map((n) => n.endIndex));
  return { start, end };
}

// Utility: find the deepest named node that covers a given character span
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

// Utility: find a node by its exact character span
export function findNodeBySpan(
  root: TreeSitterAstNode,
  start: number,
  end: number
): TreeSitterAstNode | undefined {
  let found: TreeSitterAstNode | undefined;
  const dfs = (n: TreeSitterAstNode) => {
    if (found) return;
    if (n.startIndex === start && n.endIndex === end) {
      found = n;
      return;
    }
    for (const c of n.namedChildren || []) {
      if (c.startIndex <= start && c.endIndex >= end) dfs(c);
      if (found) return;
    }
  };
  dfs(root);
  return found;
}

// Find the deepest node of any of the given types that covers [start, end]
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

// Turn curated sections into simple quiz cards
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
    return s.items.every((it) => it.type === "block");
  });
  let flatGroups = sections.filter((s) => !inlineHints.includes(s));

  if (opts.groupOrder && opts.groupOrder.length) {
    const priority = new Map<string, number>();
    opts.groupOrder.forEach((k, i) => priority.set(k, i));
    const sectionIndex = new Map<CuratedSection, number>();
    sections.forEach((s, i) => sectionIndex.set(s, i));
    flatGroups = [...flatGroups].sort((a, b) => {
      const pa = priority.has(a.key)
        ? (priority.get(a.key) as number)
        : Number.MAX_SAFE_INTEGER;
      const pb = priority.has(b.key)
        ? (priority.get(b.key) as number)
        : Number.MAX_SAFE_INTEGER;
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
    if ((nodeType === "method" || nodeType === "singleton_method") && key === "params")
      return "Which parameters does this method accept?";
    if (key === "body") return "What is the body?";
    if (nodeType === "call" && key === "name")
      return "Which method is being called?";
    if (nodeType === "call" && key === "args")
      return `What is argument #${idx + 1}?`;
    if (key === "target") return "What is the left-hand side (target)?";
    if (key === "value") return "What is the right-hand side (value)?";
    if (key === "name") return "What is the name?";
    if (key === "superclass") return "What does this inherit from?";
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
