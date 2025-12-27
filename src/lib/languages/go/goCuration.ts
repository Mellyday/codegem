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

const IMPORT_SPEC_TYPES = new Set(["import_spec"]);
const CONST_SPEC_TYPES = new Set(["const_spec"]);
const VAR_SPEC_TYPES = new Set(["var_spec"]);
const TYPE_SPEC_TYPES = new Set(["type_spec", "type_alias"]);
const PARAM_TYPES = new Set([
  "parameter_declaration",
  "variadic_parameter_declaration",
]);
const FIELD_DECL_TYPES = new Set(["field_declaration"]);
const INTERFACE_ELEM_TYPES = new Set(["method_elem", "type_elem"]);
const CASE_TYPES = new Set([
  "expression_case",
  "type_case",
  "communication_case",
  "default_case",
]);

const filterParamNodes = (node: TreeSitterAstNode) =>
  (node.namedChildren || []).filter((c) => PARAM_TYPES.has(c.type));

const filterCaseBodyNodes = (node: TreeSitterAstNode) =>
  (node.namedChildren || []).filter((c) => {
    if (!c.fieldName) return true;
    return !["value", "type", "communication"].includes(c.fieldName);
  });

export const buildCuratedSections = (
  node: TreeSitterAstNode
): CuratedSection[] => {
  switch (node.type) {
    case "package_clause": {
      const name =
        firstChildOfType(node, "package_identifier") ||
        firstChildOfType(node, "identifier");
      return [{ key: "name", items: name ? [name] : [] }];
    }

    case "import_declaration": {
      const specs = collectDescendants(node, (n) => IMPORT_SPEC_TYPES.has(n.type));
      return [{ key: "specs", items: specs }];
    }

    case "import_spec": {
      const name = childByField(node, "name");
      const path = childByField(node, "path");
      return [
        { key: "path", items: path ? [path] : [] },
        { key: "name", items: name ? [name] : [] },
      ];
    }

    case "const_declaration": {
      const specs = collectDescendants(node, (n) => CONST_SPEC_TYPES.has(n.type));
      return [{ key: "specs", items: specs }];
    }

    case "var_declaration": {
      const specs = collectDescendants(node, (n) => VAR_SPEC_TYPES.has(n.type));
      return [{ key: "specs", items: specs }];
    }

    case "const_spec":
    case "var_spec": {
      const names = childrenByField(node, "name");
      const typeNode = childByField(node, "type");
      const values = childrenByField(node, "value");
      return [
        { key: "names", items: names },
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "values", items: values },
      ];
    }

    case "type_declaration": {
      const specs = collectDescendants(node, (n) => TYPE_SPEC_TYPES.has(n.type));
      return [{ key: "specs", items: specs }];
    }

    case "type_spec": {
      const name = childByField(node, "name");
      const typeParams = childByField(node, "type_parameters");
      const value = childByField(node, "type");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    case "type_alias": {
      const name = childByField(node, "name");
      const value = childByField(node, "type");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    case "type_parameter_list": {
      const params = collectDescendants(node, (n) => n.type === "type_parameter_declaration");
      return [{ key: "params", items: params }];
    }

    case "type_parameter_declaration": {
      const names = childrenByField(node, "name");
      const typeNode = childByField(node, "type");
      return [
        { key: "names", items: names },
        { key: "type", items: typeNode ? [typeNode] : [] },
      ];
    }

    case "function_declaration": {
      const name = childByField(node, "name");
      const typeParams = childByField(node, "type_parameters");
      const params = childByField(node, "parameters");
      const results = childByField(node, "result");
      const body = childByField(node, "body") || firstChildOfType(node, "block");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "results", items: results ? [results] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "method_declaration": {
      const receiver = childByField(node, "receiver");
      const name = childByField(node, "name") || firstChildOfType(node, "field_identifier");
      const params = childByField(node, "parameters");
      const results = childByField(node, "result");
      const body = childByField(node, "body") || firstChildOfType(node, "block");
      return [
        { key: "receiver", items: receiver ? [receiver] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "results", items: results ? [results] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "func_literal": {
      const params = childByField(node, "parameters");
      const results = childByField(node, "result");
      const body = childByField(node, "body") || firstChildOfType(node, "block");
      return [
        { key: "params", items: params ? [params] : [] },
        { key: "results", items: results ? [results] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "parameter_list": {
      const params = filterParamNodes(node);
      return [{ key: "params", items: params }];
    }

    case "parameter_declaration":
    case "variadic_parameter_declaration": {
      const names = childrenByField(node, "name");
      const typeNode = childByField(node, "type");
      return [
        { key: "names", items: names },
        { key: "type", items: typeNode ? [typeNode] : [] },
      ];
    }

    case "struct_type": {
      const fields = collectDescendants(node, (n) => FIELD_DECL_TYPES.has(n.type));
      return [{ key: "fields", items: fields }];
    }

    case "field_declaration": {
      const names = childrenByField(node, "name");
      const typeNode = childByField(node, "type");
      const tag = childByField(node, "tag");
      return [
        { key: "names", items: names },
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "tag", items: tag ? [tag] : [] },
      ];
    }

    case "interface_type": {
      const methods = collectDescendants(node, (n) => INTERFACE_ELEM_TYPES.has(n.type));
      return [{ key: "methods", items: methods }];
    }

    case "method_elem": {
      const name = childByField(node, "name");
      const params = childByField(node, "parameters");
      const results = childByField(node, "result");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "results", items: results ? [results] : [] },
      ];
    }

    case "if_statement": {
      const condition = childByField(node, "condition");
      const body = childByField(node, "consequence");
      const alt = childByField(node, "alternative");
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "else", items: alt ? [alt] : [] },
      ];
    }

    case "for_statement": {
      const body = childByField(node, "body") || firstChildOfType(node, "block");
      const clause = firstChildOfTypes(node, ["for_clause", "range_clause"]);
      const condition = firstChildOfTypes(node, ["binary_expression", "unary_expression", "identifier", "call_expression"]);
      return [
        { key: "clause", items: clause ? [clause] : [] },
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "for_clause": {
      const init = childByField(node, "initializer");
      const condition = childByField(node, "condition");
      const update = childByField(node, "update");
      return [
        { key: "init", items: init ? [init] : [] },
        { key: "condition", items: condition ? [condition] : [] },
        { key: "update", items: update ? [update] : [] },
      ];
    }

    case "range_clause": {
      const left = childByField(node, "left");
      const right = childByField(node, "right");
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
      ];
    }

    case "expression_switch_statement": {
      const value = childByField(node, "value");
      return [{ key: "value", items: value ? [value] : [] }];
    }

    case "type_switch_statement": {
      const alias = childByField(node, "alias");
      const value = childByField(node, "value");
      return [
        { key: "alias", items: alias ? [alias] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    case "expression_case": {
      const values = childByField(node, "value");
      const body = filterCaseBodyNodes(node);
      return [
        { key: "values", items: values ? [values] : [] },
        { key: "body", items: body },
      ];
    }

    case "type_case": {
      const types = childrenByField(node, "type");
      const body = filterCaseBodyNodes(node);
      return [
        { key: "types", items: types },
        { key: "body", items: body },
      ];
    }

    case "communication_case": {
      const comm = childByField(node, "communication");
      const body = filterCaseBodyNodes(node);
      return [
        { key: "communication", items: comm ? [comm] : [] },
        { key: "body", items: body },
      ];
    }

    case "default_case": {
      const body = filterCaseBodyNodes(node);
      return [{ key: "body", items: body }];
    }

    case "short_var_declaration":
    case "assignment_statement": {
      const left = childByField(node, "left");
      const right = childByField(node, "right");
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
      ];
    }

    case "inc_statement":
    case "dec_statement": {
      const operand = (node.namedChildren || [])[0];
      return [{ key: "operand", items: operand ? [operand] : [] }];
    }

    case "call_expression": {
      const callee = childByField(node, "function") || (node.namedChildren || [])[0];
      const argsNode = childByField(node, "arguments");
      const args = argsNode ? argsNode.namedChildren || [] : [];
      return [
        { key: "callee", items: callee ? [callee] : [] },
        { key: "args", items: args },
      ];
    }

    case "selector_expression": {
      const obj = childByField(node, "operand");
      const prop = childByField(node, "field");
      return [
        { key: "object", items: obj ? [obj] : [] },
        { key: "property", items: prop ? [prop] : [] },
      ];
    }

    case "index_expression": {
      const obj = childByField(node, "operand");
      const idx = childByField(node, "index");
      return [
        { key: "object", items: obj ? [obj] : [] },
        { key: "index", items: idx ? [idx] : [] },
      ];
    }

    case "slice_expression": {
      const obj = childByField(node, "operand");
      const start = childByField(node, "start");
      const end = childByField(node, "end");
      const capacity = childByField(node, "capacity");
      return [
        { key: "object", items: obj ? [obj] : [] },
        { key: "start", items: start ? [start] : [] },
        { key: "end", items: end ? [end] : [] },
        { key: "capacity", items: capacity ? [capacity] : [] },
      ];
    }

    case "composite_literal": {
      const typeNode = childByField(node, "type");
      const body = childByField(node, "body") || firstChildOfType(node, "literal_value");
      const elements = body ? body.namedChildren || [] : [];
      return [
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "elements", items: elements },
      ];
    }

    case "keyed_element": {
      const kids = node.namedChildren || [];
      const key = kids[0];
      const value = kids[1];
      return [
        { key: "key", items: key ? [key] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    default:
      return [{ key: "children", items: node.namedChildren || [] }];
  }
};

export type RevealAnchors = {
  headerEnd: number;
  contentStart?: number;
  contentEnd?: number;
};

const getCaseBodyStart = (node: TreeSitterAstNode): number | undefined => {
  const bodyNodes = filterCaseBodyNodes(node).filter((c) => !CASE_TYPES.has(c.type));
  if (bodyNodes.length === 0) return undefined;
  return bodyNodes[0].startIndex;
};

export function getRevealAnchors(node: TreeSitterAstNode): RevealAnchors {
  const sections = buildCuratedSections(node);
  const bodySection = sections.find((s) => s.key === "body");
  const body = bodySection?.items?.[0];
  let headerEnd = body?.startIndex ?? node.endIndex;

  if (node.type === "expression_switch_statement" || node.type === "type_switch_statement" || node.type === "select_statement") {
    const cases = (node.namedChildren || []).filter((c) => CASE_TYPES.has(c.type));
    if (cases[0]) headerEnd = cases[0].startIndex;
  }

  if (CASE_TYPES.has(node.type)) {
    const bodyStart = getCaseBodyStart(node);
    if (typeof bodyStart === "number") headerEnd = bodyStart;
  }

  const contentSections = sections.filter(
    (s) => s.key !== "body" && s.items.length > 0
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
    return s.items.every((it) => it.type === "block");
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
    if (nodeType === "function_declaration" && key === "params")
      return `What is parameter #${idx + 1}?`;
    if (nodeType === "method_declaration" && key === "params")
      return `What is parameter #${idx + 1}?`;
    if (key === "body") return "What is the body?";
    if (nodeType === "call_expression" && key === "callee")
      return "Which function is being called?";
    if (nodeType === "call_expression" && key === "args")
      return `What is argument #${idx + 1}?`;
    if (key === "name") return "What is the name?";
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
