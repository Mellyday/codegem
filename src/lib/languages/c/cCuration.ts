import type { TreeSitterAstNode } from "../../treeSitter";

export type CuratedSection = {
  key: string;
  items: TreeSitterAstNode[];
};

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

export const textForRange = (
  start: number | undefined,
  end: number | undefined,
  code?: string
) => {
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    typeof code === "string"
  ) {
    return code.slice(start, end);
  }
  return undefined;
};

const isIdentifierNode = (node?: TreeSitterAstNode) =>
  node?.type === "identifier" || node?.type === "field_identifier";

export const extractDeclaratorNameNode = (
  node?: TreeSitterAstNode
): TreeSitterAstNode | undefined => {
  if (!node) return undefined;
  if (isIdentifierNode(node)) return node;
  for (const child of node.namedChildren || []) {
    const found = extractDeclaratorNameNode(child);
    if (found) return found;
  }
  return undefined;
};

export const extractDeclaratorName = (
  node: TreeSitterAstNode | undefined,
  code?: string
): string | undefined => {
  const nameNode = extractDeclaratorNameNode(node);
  if (!nameNode) return undefined;
  return (
    textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
    nameNode.text
  );
};

const DIRECT_DECLARATOR_TYPES = new Set<string>([
  "init_declarator",
  "declarator",
  "pointer_declarator",
  "array_declarator",
  "function_declarator",
  "parenthesized_declarator",
]);

const isDeclaratorLike = (n: TreeSitterAstNode) =>
  DIRECT_DECLARATOR_TYPES.has(n.type) || n.type.includes("declarator");

export const getDeclaratorsForDeclaration = (
  node: TreeSitterAstNode
): TreeSitterAstNode[] => {
  const direct = (node.namedChildren || []).filter(isDeclaratorLike);
  if (direct.length > 0) return direct;
  // Fallback: capture any nested declarator nodes.
  return collectDescendants(node, isDeclaratorLike);
};

export const extractDeclaredNames = (
  declarationNode: TreeSitterAstNode,
  code?: string
): string[] => {
  const names: string[] = [];
  const declarators = getDeclaratorsForDeclaration(declarationNode);
  for (const decl of declarators) {
    const name = extractDeclaratorName(decl, code);
    if (name) names.push(name);
  }
  return Array.from(new Set(names));
};

const isTypeSpecifier = (node: TreeSitterAstNode) =>
  node.type === "type_identifier" ||
  node.type === "primitive_type" ||
  node.type === "sized_type_specifier" ||
  node.type === "struct_specifier" ||
  node.type === "enum_specifier" ||
  node.type === "type_qualifier" ||
  node.type === "storage_class_specifier" ||
  node.type.endsWith("_type");

export const extractDeclaredTypeText = (
  declarationNode: TreeSitterAstNode,
  code?: string
): string => {
  if (!code) return "";
  const declarators = getDeclaratorsForDeclaration(declarationNode);
  const firstDeclarator = declarators[0];
  if (firstDeclarator) {
    const prefix = code.slice(
      declarationNode.startIndex,
      firstDeclarator.startIndex
    );
    return prefix.replace(/\s+/g, " ").trim();
  }
  const typeNodes = (declarationNode.namedChildren || []).filter(isTypeSpecifier);
  if (typeNodes.length > 0) {
    return typeNodes
      .map((n) => code.slice(n.startIndex, n.endIndex))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
};

export const findParameterList = (
  node?: TreeSitterAstNode
): TreeSitterAstNode | undefined => {
  if (!node) return undefined;
  if (node.type === "parameter_list") return node;
  for (const child of node.namedChildren || []) {
    const found = findParameterList(child);
    if (found) return found;
  }
  return undefined;
};

export const findInitializerNode = (
  node?: TreeSitterAstNode
): TreeSitterAstNode | undefined => {
  if (!node) return undefined;
  return (
    childByField(node, "value") ||
    childByField(node, "initializer") ||
    firstChildOfTypes(node, ["initializer", "initializer_list"])
  );
};

export const extractInitializerText = (
  node: TreeSitterAstNode,
  code?: string
): string | undefined => {
  const initNode = findInitializerNode(node);
  if (!initNode || !code) return undefined;
  return textForRange(initNode.startIndex, initNode.endIndex, code)?.trim();
};

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

export const buildCuratedSections = (
  node: TreeSitterAstNode
): CuratedSection[] => {
  switch (node.type) {
    case "preproc_include": {
      const path = firstChildOfTypes(node, [
        "system_lib_string",
        "string_literal",
        "header_name",
        "identifier",
      ]);
      return [{ key: "path", items: path ? [path] : [] }];
    }

    case "function_definition": {
      const declarator =
        childByField(node, "declarator") ||
        firstChildOfTypes(node, [
          "function_declarator",
          "pointer_declarator",
          "declarator",
        ]);
      const name = extractDeclaratorNameNode(declarator);
      const paramsList = findParameterList(declarator);
      const params = paramsList ? paramsList.namedChildren || [] : [];
      const body =
        childByField(node, "body") || firstChildOfType(node, "compound_statement");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "declaration":
    case "type_definition": {
      const declarators = getDeclaratorsForDeclaration(node);
      const names = declarators
        .map((d) => extractDeclaratorNameNode(d))
        .filter(Boolean) as TreeSitterAstNode[];
      const typeNodes = (node.namedChildren || []).filter(isTypeSpecifier);
      const initializers = declarators
        .map((d) => findInitializerNode(d))
        .filter(Boolean) as TreeSitterAstNode[];
      return [
        { key: "names", items: names },
        { key: "type", items: typeNodes.slice(0, 1) },
        { key: "initializers", items: initializers },
      ];
    }

    case "struct_specifier": {
      const name = firstChildOfTypes(node, ["type_identifier", "identifier"]);
      const fields = collectDescendants(
        node,
        (n) => n.type === "field_declaration"
      );
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "fields", items: fields },
      ];
    }

    case "enum_specifier": {
      const name = firstChildOfTypes(node, ["type_identifier", "identifier"]);
      const enumerators = collectDescendants(node, (n) => n.type === "enumerator");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "enumerators", items: enumerators },
      ];
    }

    case "if_statement": {
      const condition =
        childByField(node, "condition") || (node.namedChildren || [])[0];
      const consequence =
        childByField(node, "consequence") ||
        childByField(node, "then") ||
        (node.namedChildren || []).find(
          (c) =>
            c.type === "compound_statement" ||
            c.type.endsWith("_statement")
        );
      const alternative =
        childByField(node, "alternative") ||
        childByField(node, "else") ||
        (node.namedChildren || []).find(
          (c) =>
            c !== consequence &&
            (c.type === "compound_statement" || c.type.endsWith("_statement"))
        );
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "then", items: consequence ? [consequence] : [] },
        { key: "else", items: alternative ? [alternative] : [] },
      ];
    }

    case "for_statement": {
      const init = childByField(node, "initializer");
      const condition = childByField(node, "condition");
      const update = childByField(node, "update");
      const body =
        childByField(node, "body") || firstChildOfType(node, "compound_statement");
      return [
        { key: "init", items: init ? [init] : [] },
        { key: "condition", items: condition ? [condition] : [] },
        { key: "update", items: update ? [update] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "while_statement": {
      const condition = childByField(node, "condition");
      const body =
        childByField(node, "body") || firstChildOfType(node, "compound_statement");
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "do_statement": {
      const body =
        childByField(node, "body") || firstChildOfType(node, "compound_statement");
      const condition = childByField(node, "condition");
      return [
        { key: "body", items: body ? [body] : [] },
        { key: "condition", items: condition ? [condition] : [] },
      ];
    }

    case "switch_statement": {
      const value = childByField(node, "value") || childByField(node, "condition");
      const body =
        childByField(node, "body") || firstChildOfType(node, "compound_statement");
      const cases = body
        ? collectDescendants(body, (n) =>
            n.type === "case_statement" || n.type === "labeled_statement"
          )
        : [];
      return [
        { key: "value", items: value ? [value] : [] },
        { key: "cases", items: cases },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "case_statement":
    case "labeled_statement": {
      const label = (node.namedChildren || [])[0];
      const body = (node.namedChildren || []).find((c) => c !== label);
      return [
        { key: "label", items: label ? [label] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "return_statement": {
      const value = (node.namedChildren || [])[0];
      return [{ key: "value", items: value ? [value] : [] }];
    }

    case "goto_statement": {
      const label = (node.namedChildren || [])[0];
      return [{ key: "label", items: label ? [label] : [] }];
    }

    case "call_expression": {
      const callee =
        childByField(node, "function") ||
        childByField(node, "callee") ||
        (node.namedChildren || [])[0];
      const argsNode = firstChildOfType(node, "argument_list");
      const args = argsNode ? argsNode.namedChildren || [] : [];
      return [
        { key: "callee", items: callee ? [callee] : [] },
        { key: "args", items: args },
      ];
    }

    case "field_expression": {
      const object =
        childByField(node, "argument") || (node.namedChildren || [])[0];
      const field =
        childByField(node, "field") || (node.namedChildren || [])[1];
      return [
        { key: "object", items: object ? [object] : [] },
        { key: "field", items: field ? [field] : [] },
      ];
    }

    case "subscript_expression": {
      const array =
        childByField(node, "argument") || (node.namedChildren || [])[0];
      const index = (node.namedChildren || [])[1];
      return [
        { key: "array", items: array ? [array] : [] },
        { key: "index", items: index ? [index] : [] },
      ];
    }

    case "assignment_expression":
    case "binary_expression": {
      const left = childByField(node, "left") || (node.namedChildren || [])[0];
      const right = childByField(node, "right") || (node.namedChildren || [])[1];
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
      ];
    }

    case "unary_expression": {
      const operand = childByField(node, "argument") || (node.namedChildren || [])[0];
      return [{ key: "operand", items: operand ? [operand] : [] }];
    }

    default: {
      return [{ key: "children", items: node.namedChildren || [] }];
    }
  }
};

export type RevealAnchors = {
  headerEnd: number;
  contentStart?: number;
  contentEnd?: number;
};

export function getRevealAnchors(node: TreeSitterAstNode): RevealAnchors {
  const sections = buildCuratedSections(node);
  const bodySection =
    sections.find((s) => s.key === "body") ||
    sections.find((s) => s.key === "then");
  const body = bodySection?.items[0];
  const headerEnd = body?.startIndex ?? node.endIndex;

  const contentSections = sections.filter(
    (s) =>
      s.key !== "body" &&
      s.key !== "then" &&
      s.key !== "else" &&
      s.key !== "cases" &&
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
  const groupOrder = opts.groupOrder;

  const ordered = groupOrder
    ? [
        ...groupOrder
          .map((key) => sections.find((s) => s.key === key))
          .filter(Boolean),
        ...sections.filter((s) => !groupOrder.includes(s.key)),
      ]
    : sections;

  const filtered = includeBody
    ? ordered
    : ordered.filter((s) => s.key !== "body");

  const questionForKey = (key: string) => {
    switch (key) {
      case "name":
        return "What is the name?";
      case "params":
        return "Which parameters are listed?";
      case "condition":
        return "What is the condition?";
      case "then":
        return "What happens in the then branch?";
      case "else":
        return "What happens in the else branch?";
      case "init":
        return "What initializes the loop?";
      case "update":
        return "What updates the loop?";
      case "value":
        return "What value is used here?";
      case "names":
        return "Which names are declared?";
      case "type":
        return "What type is declared?";
      case "fields":
        return "Which fields are declared?";
      case "enumerators":
        return "Which enumerators are declared?";
      case "body":
        return "What is the body?";
      case "callee":
        return "What function is called?";
      default:
        return `What is the ${key}?`;
    }
  };

  const cards: Array<{
    order: number;
    type: string;
    text: string;
    action: "next";
    semanticRole?: string;
    question?: string;
  }> = [];
  let order = 0;

  for (const group of filtered) {
    for (const item of group.items) {
      cards.push({
        order: order++,
        type: group.key,
        text: code.substring(item.startIndex, item.endIndex),
        action: "next",
        semanticRole: group.key,
        question: questionForKey(group.key),
      });
    }
  }
  return cards;
}

export const isDocstringNode = (
  _node?: TreeSitterAstNode,
  _parent?: TreeSitterAstNode
) => false;
export const isYieldFrom = (_node?: TreeSitterAstNode, _code?: string) => false;
