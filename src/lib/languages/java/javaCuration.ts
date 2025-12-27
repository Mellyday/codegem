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

export const isDocstringNode = () => false;

export const isYieldFrom = () => false;

const annotationTypes = new Set(["annotation", "marker_annotation"]);

const collectAnnotations = (node: TreeSitterAstNode) => {
  const modifiers = firstChildOfType(node, "modifiers");
  if (!modifiers) return [];
  return collectDescendants(modifiers, (n) => annotationTypes.has(n.type));
};

const declarationBody = (node: TreeSitterAstNode) =>
  childByField(node, "body") ||
  firstChildOfTypes(node, [
    "class_body",
    "interface_body",
    "enum_body",
    "annotation_type_body",
  ]);

export const buildCuratedSections = (
  node: TreeSitterAstNode
): CuratedSection[] => {
  switch (node.type) {
    case "package_declaration": {
      const name = firstChildOfTypes(node, ["scoped_identifier", "identifier"]);
      return [{ key: "name", items: name ? [name] : [] }];
    }

    case "import_declaration": {
      const name = firstChildOfTypes(node, ["scoped_identifier", "identifier"]);
      const wildcard = childrenOfType(node, "asterisk");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "wildcard", items: wildcard },
      ];
    }

    case "class_declaration":
    case "interface_declaration":
    case "enum_declaration":
    case "record_declaration":
    case "annotation_type_declaration": {
      const name = childByField(node, "name") || firstChildOfType(node, "identifier");
      const typeParams = childByField(node, "type_parameters");
      const superclass = childByField(node, "superclass") || firstChildOfType(node, "superclass");
      const interfaces =
        childByField(node, "interfaces") ||
        firstChildOfType(node, "super_interfaces") ||
        firstChildOfType(node, "extends_interfaces");
      const body = declarationBody(node);
      const annotations = collectAnnotations(node);

      const sections: CuratedSection[] = [
        { key: "name", items: name ? [name] : [] },
        { key: "modifiers", items: firstChildOfType(node, "modifiers") ? [firstChildOfType(node, "modifiers") as TreeSitterAstNode] : [] },
        { key: "annotations", items: annotations },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "extends", items: superclass ? [superclass] : [] },
        { key: "implements", items: interfaces ? [interfaces] : [] },
        { key: "body", items: body ? [body] : [] },
      ];

      if (node.type === "record_declaration") {
        const components = childByField(node, "parameters");
        if (components) sections.push({ key: "components", items: [components] });
      }

      if (node.type === "enum_declaration") {
        const enumBody = body && body.type === "enum_body" ? body : firstChildOfType(node, "enum_body");
        const constants = enumBody ? childrenOfType(enumBody, "enum_constant") : [];
        sections.push({ key: "constants", items: constants });
      }

      if (node.type === "annotation_type_declaration") {
        const annotationBody =
          body && body.type === "annotation_type_body"
            ? body
            : firstChildOfType(node, "annotation_type_body");
        const members = annotationBody ? (annotationBody.namedChildren || []) : [];
        sections.push({ key: "members", items: members });
      }

      return sections;
    }

    case "method_declaration": {
      const name = childByField(node, "name");
      const params = childByField(node, "parameters");
      const typeParams = childByField(node, "type_parameters");
      const returnType = childByField(node, "type");
      const throwsNode = firstChildOfType(node, "throws");
      const body = childByField(node, "body");
      return [
        { key: "modifiers", items: firstChildOfType(node, "modifiers") ? [firstChildOfType(node, "modifiers") as TreeSitterAstNode] : [] },
        { key: "annotations", items: collectAnnotations(node) },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "return_type", items: returnType ? [returnType] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "throws", items: throwsNode ? [throwsNode] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "constructor_declaration":
    case "compact_constructor_declaration": {
      const name = childByField(node, "name") || firstChildOfType(node, "identifier");
      const params = childByField(node, "parameters");
      const throwsNode = firstChildOfType(node, "throws");
      const body = childByField(node, "body");
      return [
        { key: "modifiers", items: firstChildOfType(node, "modifiers") ? [firstChildOfType(node, "modifiers") as TreeSitterAstNode] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "params", items: params ? [params] : [] },
        { key: "throws", items: throwsNode ? [throwsNode] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "field_declaration": {
      const typeNode = childByField(node, "type");
      const declarators = childrenByField(node, "declarator");
      return [
        { key: "modifiers", items: firstChildOfType(node, "modifiers") ? [firstChildOfType(node, "modifiers") as TreeSitterAstNode] : [] },
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "declarators", items: declarators },
      ];
    }

    case "local_variable_declaration": {
      const typeNode = childByField(node, "type");
      const declarators = childrenByField(node, "declarator");
      return [
        { key: "modifiers", items: firstChildOfType(node, "modifiers") ? [firstChildOfType(node, "modifiers") as TreeSitterAstNode] : [] },
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "declarators", items: declarators },
      ];
    }

    case "variable_declarator": {
      const name = childByField(node, "name");
      const value = childByField(node, "value");
      return [
        { key: "name", items: name ? [name] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    case "static_initializer": {
      const body = firstChildOfType(node, "block");
      return [{ key: "body", items: body ? [body] : [] }];
    }

    case "if_statement": {
      const condition = childByField(node, "condition");
      const thenNode = childByField(node, "consequence");
      const elseNode = childByField(node, "alternative");
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "then", items: thenNode ? [thenNode] : [] },
        { key: "else", items: elseNode ? [elseNode] : [] },
      ];
    }

    case "for_statement": {
      const init = childrenByField(node, "init");
      const condition = childByField(node, "condition");
      const update = childrenByField(node, "update");
      const body = childByField(node, "body");
      return [
        { key: "init", items: init },
        { key: "condition", items: condition ? [condition] : [] },
        { key: "update", items: update },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "enhanced_for_statement": {
      const name = childByField(node, "name");
      const value = childByField(node, "value");
      const body = childByField(node, "body");
      return [
        { key: "var", items: name ? [name] : [] },
        { key: "iterable", items: value ? [value] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "while_statement":
    case "do_statement": {
      const condition = childByField(node, "condition");
      const body = childByField(node, "body");
      return [
        { key: "condition", items: condition ? [condition] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "switch_expression": {
      const value = childByField(node, "condition");
      const body = childByField(node, "body");
      const cases = body
        ? (body.namedChildren || []).filter(
            (c) =>
              c.type === "switch_block_statement_group" || c.type === "switch_rule"
          )
        : [];
      return [
        { key: "value", items: value ? [value] : [] },
        { key: "cases", items: cases },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "switch_block_statement_group":
    case "switch_rule": {
      const labels = childrenOfType(node, "switch_label");
      const bodyItems =
        node.type === "switch_rule"
          ? (node.namedChildren || []).filter(
              (c) =>
                c.type === "block" ||
                c.type === "expression_statement" ||
                c.type === "throw_statement"
            )
          : (node.namedChildren || []).filter((c) => c.type === "statement");
      return [
        { key: "labels", items: labels },
        { key: "body", items: bodyItems },
      ];
    }

    case "try_statement":
    case "try_with_resources_statement": {
      const resources = childByField(node, "resources");
      const body = childByField(node, "body");
      const catches = childrenOfType(node, "catch_clause");
      const finallyClause = childrenOfType(node, "finally_clause");
      return [
        { key: "resources", items: resources ? [resources] : [] },
        { key: "body", items: body ? [body] : [] },
        { key: "catches", items: catches },
        { key: "finally", items: finallyClause },
      ];
    }

    case "catch_clause": {
      const param = firstChildOfType(node, "catch_formal_parameter");
      const body = firstChildOfType(node, "block");
      return [
        { key: "param", items: param ? [param] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "synchronized_statement": {
      const body = childByField(node, "body");
      const monitor = firstChildOfType(node, "parenthesized_expression");
      return [
        { key: "monitor", items: monitor ? [monitor] : [] },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "return_statement":
    case "throw_statement": {
      const value = (node.namedChildren || [])[0];
      return [{ key: "value", items: value ? [value] : [] }];
    }

    case "break_statement":
    case "continue_statement": {
      const label = (node.namedChildren || [])[0];
      return [{ key: "label", items: label ? [label] : [] }];
    }

    case "expression_statement": {
      const expr = (node.namedChildren || [])[0];
      return [{ key: "expression", items: expr ? [expr] : [] }];
    }

    case "method_invocation": {
      const object = childByField(node, "object");
      const name = childByField(node, "name");
      const argsNode = childByField(node, "arguments");
      const args = argsNode ? argsNode.namedChildren || [] : [];
      return [
        { key: "object", items: object ? [object] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "args", items: args },
      ];
    }

    case "object_creation_expression": {
      const typeNode = childByField(node, "type");
      const argsNode = childByField(node, "arguments");
      const args = argsNode ? argsNode.namedChildren || [] : [];
      const classBody = firstChildOfType(node, "class_body");
      return [
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "args", items: args },
        { key: "class_body", items: classBody ? [classBody] : [] },
      ];
    }

    case "lambda_expression": {
      const params = childByField(node, "parameters");
      const body = childByField(node, "body");
      let paramItems: TreeSitterAstNode[] = [];
      if (params) {
        if (params.type === "formal_parameters") {
          paramItems = params.namedChildren || [];
        } else {
          paramItems = [params];
        }
      }
      return [
        { key: "params", items: paramItems },
        { key: "body", items: body ? [body] : [] },
      ];
    }

    case "method_reference": {
      const qualifier = firstChildOfTypes(node, ["_type", "primary_expression", "super"]);
      const name = firstChildOfType(node, "identifier");
      return [
        { key: "qualifier", items: qualifier ? [qualifier] : [] },
        { key: "name", items: name ? [name] : [] },
      ];
    }

    case "assignment_expression": {
      const left = childByField(node, "left");
      const right = childByField(node, "right");
      return [
        { key: "left", items: left ? [left] : [] },
        { key: "right", items: right ? [right] : [] },
      ];
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
  const bodyKeys = new Set(["body", "then", "consequence", "cases", "catches", "finally"]);
  const bodySection = sections.find((s) => bodyKeys.has(s.key));
  const body = bodySection?.items[0];
  let headerEnd = body?.startIndex ?? node.endIndex;

  if (node.type === "switch_expression") {
    const cases = sections.find((s) => s.key === "cases")?.items;
    if (cases && cases[0]) headerEnd = cases[0].startIndex;
  }

  const contentSections = sections.filter(
    (s) => !bodyKeys.has(s.key) && s.items.length > 0
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
    if (
      (nodeType === "method_declaration" ||
        nodeType === "constructor_declaration") &&
      key === "params"
    ) {
      return `What is parameter #${idx + 1}?`;
    }
    if (key === "body") return "What is the body?";
    if (nodeType === "method_invocation" && key === "name")
      return "What method is called?";
    if (nodeType === "method_invocation" && key === "args")
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
