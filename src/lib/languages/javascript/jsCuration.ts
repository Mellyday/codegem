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

const BINDING_LEAF_TYPES = new Set([
  "identifier",
  "shorthand_property_identifier_pattern",
]);

const collectBindingNodes = (
  node: TreeSitterAstNode | undefined,
  out: TreeSitterAstNode[] = []
): TreeSitterAstNode[] => {
  if (!node) return out;
  if (BINDING_LEAF_TYPES.has(node.type)) {
    out.push(node);
    return out;
  }

  switch (node.type) {
    case "assignment_pattern": {
      const left = childByField(node, "left") || node.namedChildren?.[0];
      collectBindingNodes(left, out);
      return out;
    }
    case "object_assignment_pattern": {
      const left = childByField(node, "left") || node.namedChildren?.[0];
      collectBindingNodes(left, out);
      return out;
    }
    case "pair_pattern": {
      const value = childByField(node, "value") || node.namedChildren?.[1];
      collectBindingNodes(value, out);
      return out;
    }
    case "rest_pattern": {
      const inner = node.namedChildren?.[0];
      collectBindingNodes(inner, out);
      return out;
    }
    case "object_pattern":
    case "array_pattern": {
      for (const child of node.namedChildren || []) {
        collectBindingNodes(child, out);
      }
      return out;
    }
    default: {
      for (const child of node.namedChildren || []) {
        collectBindingNodes(child, out);
      }
      return out;
    }
  }
};

export const collectBindingNames = (
  node: TreeSitterAstNode | undefined,
  code: string | undefined
): string[] => {
  const nodes = collectBindingNodes(node, []);
  const names: string[] = [];
  for (const n of nodes) {
    const text =
      typeof code === "string"
        ? code.slice(n.startIndex, n.endIndex)
        : n.type;
    if (text) names.push(text);
  }
  return names;
};

const isDirectiveExpr = (node?: TreeSitterAstNode): boolean => {
  if (!node || node.type !== "expression_statement") return false;
  const first = (node.namedChildren || [])[0];
  return Boolean(first && first.type === "string");
};

export const isDocstringNode = (
  node: TreeSitterAstNode,
  parent?: TreeSitterAstNode
): boolean => {
  if (!parent) return false;
  if (parent.type !== "program" && parent.type !== "statement_block") return false;
  const siblings = parent.namedChildren || [];
  const idx = siblings.indexOf(node);
  if (idx < 0) return false;
  for (let i = 0; i <= idx; i++) {
    if (!isDirectiveExpr(siblings[i])) return false;
  }
  return isDirectiveExpr(node);
};

const collectDecoratorNodes = (node: TreeSitterAstNode): TreeSitterAstNode[] => {
  const byField = childrenByField(node, "decorator");
  if (byField.length > 0) return byField;
  return (node.namedChildren || []).filter((c) => c.type === "decorator");
};

export const buildCuratedSections = (
  node: TreeSitterAstNode
): CuratedSection[] => {
  switch (node.type) {
    case "import_statement": {
      const source = childByField(node, "source");
      const importClause = firstChildOfType(node, "import_clause");
      const requireClause = firstChildOfType(node, "import_require_clause");
      const defaultId = importClause
        ? firstChildOfType(importClause, "identifier")
        : undefined;
      const requireId = requireClause
        ? firstChildOfType(requireClause, "identifier")
        : undefined;
      const namespace = importClause
        ? firstChildOfType(importClause, "namespace_import")
        : undefined;
      const namespaceId = namespace
        ? firstChildOfType(namespace, "identifier")
        : undefined;
      const named = collectDescendants(node, (n) => n.type === "import_specifier");
      const attributes = collectDescendants(node, (n) => n.type === "import_attribute");
      return [
        { key: "source", items: source ? [source] : [] },
        { key: "default", items: defaultId ? [defaultId] : requireId ? [requireId] : [] },
        { key: "namespace", items: namespaceId ? [namespaceId] : [] },
        { key: "named", items: named },
        { key: "attributes", items: attributes },
      ];
    }

    case "import_specifier": {
      const name = childByField(node, "name");
      const alias = childByField(node, "alias");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "alias", items: alias ? [alias] : [] },
      ];
    }

    case "export_statement": {
      const declaration = childByField(node, "declaration");
      const value = childByField(node, "value");
      const source = childByField(node, "source");
      const named = collectDescendants(node, (n) => n.type === "export_specifier");
      const namespace = firstChildOfType(node, "namespace_export");
      return [
        { key: "declaration", items: declaration ? [declaration] : [] },
        { key: "value", items: value ? [value] : [] },
        { key: "named", items: named },
        { key: "namespace", items: namespace ? [namespace] : [] },
        { key: "source", items: source ? [source] : [] },
      ];
    }

    case "export_specifier": {
      const name = childByField(node, "name");
      const alias = childByField(node, "alias");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "alias", items: alias ? [alias] : [] },
      ];
    }

    case "lexical_declaration":
    case "variable_declaration": {
      const declarators = childrenOfType(node, "variable_declarator");
      return [
        { key: "declarators", items: declarators },
      ];
    }

    case "variable_declarator": {
      const name = childByField(node, "name");
      const value = childByField(node, "value");
      const typeAnn = childByField(node, "type");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "value", items: value ? [value] : [] },
        { key: "type", items: typeAnn ? [typeAnn] : [] },
      ];
    }

    case "object": {
      const keys: TreeSitterAstNode[] = [];
      const values: TreeSitterAstNode[] = [];
      for (const child of node.namedChildren || []) {
        if (child.type === "pair") {
          const key = childByField(child, "key") || child.namedChildren?.[0];
          const value = childByField(child, "value") || child.namedChildren?.[1];
          if (key) keys.push(key);
          if (value) values.push(value);
          continue;
        }
        if (child.type === "shorthand_property_identifier") {
          keys.push(child);
          values.push(child);
          continue;
        }
        if (child.type === "method_definition") {
          const name = childByField(child, "name") || child.namedChildren?.[0];
          if (name) keys.push(name);
          values.push(child);
        }
      }
      return [
        { key: "keys", items: keys },
        { key: "values", items: values },
      ];
    }

    case "object_pattern":
    case "array_pattern":
    case "assignment_pattern":
    case "rest_pattern":
    case "pair_pattern":
    case "object_assignment_pattern": {
      const bindings = collectBindingNodes(node, []);
      const defaults = collectDescendants(node, (n) => n.type === "assignment_pattern");
      return [
        { key: "bindings", items: bindings },
        { key: "defaults", items: defaults },
      ];
    }

    case "function_declaration":
    case "generator_function_declaration": {
      const name = childByField(node, "name");
      const params = childByField(node, "parameters");
      const body = childByField(node, "body") || firstChildOfType(node, "statement_block");
      const typeParams = childByField(node, "type_parameters");
      const returnType = childByField(node, "return_type");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "return_type", items: returnType ? [returnType] : [] },
      ];
    }

    case "arrow_function": {
      const param = childByField(node, "parameter");
      const params = childByField(node, "parameters");
      const body = childByField(node, "body");
      return [
        { key: "params", items: params ? [params] : param ? [param] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "class_declaration": {
      const name = childByField(node, "name");
      const body = childByField(node, "body") || firstChildOfType(node, "class_body");
      const decorators = collectDecoratorNodes(node);
      const heritage = firstChildOfType(node, "class_heritage");
      const typeParams = childByField(node, "type_parameters");
      let implementsItems: TreeSitterAstNode[] = [];
      if (heritage) {
        const impl = collectDescendants(heritage, (n) => n.type === "implements_clause");
        if (impl.length > 0) {
          implementsItems = collectDescendants(impl[0], (n) => n.type.endsWith("identifier"));
        }
      }
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "decorators", items: decorators },
        { key: "heritage", items: heritage ? [heritage] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "implements", items: implementsItems },
      ];
    }

    case "method_definition": {
      const name = childByField(node, "name");
      const params = childByField(node, "parameters");
      const body = childByField(node, "body") || firstChildOfType(node, "statement_block");
      const decorators = collectDecoratorNodes(node);
      const typeParams = childByField(node, "type_parameters");
      const returnType = childByField(node, "return_type");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "decorators", items: decorators },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "return_type", items: returnType ? [returnType] : [] },
      ];
    }

    case "field_definition":
    case "public_field_definition": {
      const name = childByField(node, "name") || childByField(node, "property");
      const decorators = collectDecoratorNodes(node);
      const value = childByField(node, "value");
      const typeAnn = childByField(node, "type");
      const modifiers = (node.namedChildren || []).filter((c) =>
        ["accessibility_modifier", "override_modifier", "readonly_modifier"].includes(c.type)
      );
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "decorators", items: decorators },
        { key: "value", items: value ? [value] : [] },
        { key: "type", items: typeAnn ? [typeAnn] : [] },
        { key: "modifiers", items: modifiers },
      ];
    }

    case "if_statement": {
      const condition = childByField(node, "condition");
      const body = childByField(node, "consequence") || firstChildOfType(node, "statement_block");
      const alt = childByField(node, "alternative");
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "else", items: alt ? [alt] : [] },
      ];
    }

    case "else_clause": {
      const body = (node.namedChildren || [])[0];
      return [{ key: "body", items: body ? [body] : [] }];
    }

    case "for_statement": {
      const init = childByField(node, "initializer");
      const condition = childByField(node, "condition");
      const update = childByField(node, "increment");
      const body = childByField(node, "body") || firstChildOfType(node, "statement_block");
      return [
        { key: "init", items: init ? [init] : [] },
        { key: "condition", items: condition ? [condition] : [] },
        { key: "update", items: update ? [update] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "for_in_statement": {
      const left = childByField(node, "left");
      const right = childByField(node, "right");
      const body = childByField(node, "body") || firstChildOfType(node, "statement_block");
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "while_statement":
    case "do_statement": {
      const condition = childByField(node, "condition");
      const body = childByField(node, "body") || firstChildOfType(node, "statement_block");
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "switch_statement": {
      const value = childByField(node, "value");
      const body = childByField(node, "body") || firstChildOfType(node, "switch_body");
      return [
        { key: "value", items: value ? [value] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "switch_case": {
      const value = childByField(node, "value");
      const body = childrenByField(node, "body");
      return [
        { key: "value", items: value ? [value] : [] },
        { key: "body", items: body },
      ];
    }

    case "switch_default": {
      const body = childrenByField(node, "body");
      return [{ key: "body", items: body }];
    }

    case "try_statement": {
      const body = childByField(node, "body");
      const handler = childByField(node, "handler");
      const finalizer = childByField(node, "finalizer");
      return [
        { key: "body", items: body ? [body] : [] },
        { key: "catch", items: handler ? [handler] : [] },
        { key: "finally", items: finalizer ? [finalizer] : [] },
      ];
    }

    case "catch_clause": {
      const param = childByField(node, "parameter");
      const body = childByField(node, "body");
      return [
        { key: "param", items: param ? [param] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "finally_clause": {
      const body = childByField(node, "body");
      return [{ key: "body", items: body ? [body] : [] }];
    }

    case "expression_statement": {
      const expr = (node.namedChildren || [])[0];
      return [{ key: "expr", items: expr ? [expr] : [] }];
    }

    case "call_expression": {
      const callee = childByField(node, "function");
      const argsNode = childByField(node, "arguments");
      const args = argsNode ? argsNode.namedChildren || [] : [];
      return [
        { key: "callee", items: callee ? [callee] : [] },
        { key: "args", items: args },
      ];
    }

    case "member_expression": {
      const object = childByField(node, "object");
      const property = childByField(node, "property");
      const optional = firstChildOfType(node, "optional_chain");
      return [
        { key: "object", items: object ? [object] : [] },
        { key: "property", items: property ? [property] : [] },
        { key: "optional", items: optional ? [optional] : [] },
      ];
    }

    case "subscript_expression": {
      const object = childByField(node, "object");
      const index = childByField(node, "index");
      const optional = firstChildOfType(node, "optional_chain");
      return [
        { key: "object", items: object ? [object] : [] },
        { key: "index", items: index ? [index] : [] },
        { key: "optional", items: optional ? [optional] : [] },
      ];
    }

    case "template_string": {
      const subs = collectDescendants(node, (n) => n.type === "template_substitution");
      return [{ key: "substitutions", items: subs }];
    }

    case "jsx_element": {
      const openTag = childByField(node, "open_tag") || firstChildOfType(node, "jsx_opening_element");
      const name = openTag ? childByField(openTag, "name") || firstChildOfType(openTag, "identifier") : undefined;
      const attributes = openTag
        ? (openTag.namedChildren || []).filter((c) => c.type === "jsx_attribute" || c.type === "jsx_expression")
        : [];
      const children = (node.namedChildren || []).filter(
        (c) => !["jsx_opening_element", "jsx_closing_element"].includes(c.type)
      );
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "attributes", items: attributes },
        { key: "children", items: children },
      ];
    }

    case "jsx_self_closing_element": {
      const name = childByField(node, "name") || firstChildOfType(node, "identifier");
      const attributes = (node.namedChildren || []).filter((c) => c.type === "jsx_attribute" || c.type === "jsx_expression");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "attributes", items: attributes },
      ];
    }

    case "jsx_fragment": {
      const children = (node.namedChildren || []).filter(
        (c) => !["jsx_opening_fragment", "jsx_closing_fragment"].includes(c.type)
      );
      return [
        { key: "name", items: [] },
        { key: "attributes", items: [] },
        { key: "children", items: children },
      ];
    }

    case "jsx_attribute": {
      const name = (node.namedChildren || [])[0];
      const value = (node.namedChildren || [])[1];
      return [
        { key: "name", items: name ? [name] : [] },
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

const getSwitchCaseBodyStart = (node: TreeSitterAstNode): number | undefined => {
  const bodyNodes = childrenByField(node, "body");
  if (!bodyNodes.length) return undefined;
  return bodyNodes[0].startIndex;
};

export function getRevealAnchors(node: TreeSitterAstNode): RevealAnchors {
  const sections = buildCuratedSections(node);
  const bodySection = sections.find((s) => s.key === "body");
  const body = bodySection?.items?.[0];
  let headerEnd = body?.startIndex ?? node.endIndex;

  if (node.type === "switch_statement") {
    const switchBody = childByField(node, "body") || firstChildOfType(node, "switch_body");
    if (switchBody) headerEnd = switchBody.startIndex;
  }

  if (node.type === "switch_case" || node.type === "switch_default") {
    const bodyStart = getSwitchCaseBodyStart(node);
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
    return s.items.every((it) => it.type === "statement_block" || it.type === "class_body");
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
    if (nodeType === "method_definition" && key === "params")
      return `What is parameter #${idx + 1}?`;
    if (nodeType === "call_expression" && key === "args")
      return `What is argument #${idx + 1}?`;
    if (key === "body") return "What is the body?";
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
