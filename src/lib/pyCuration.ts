import type { TreeSitterAstNode } from "./treeSitter";

export type CuratedSection = {
  key: string;
  items: TreeSitterAstNode[];
};

// Helpers (copied from AstChildrenSidebar)
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

const isYieldType = (type: string) =>
  type === "yield_expr" || type === "yield_expression" || type === "yield";

export const isYieldFrom = (node: TreeSitterAstNode, code?: string) => {
  if (!code || !isYieldType(node.type)) return false;
  const start = node.startIndex;
  const end = Math.min(code.length, node.endIndex + 8, node.startIndex + 256);
  const snippet = code.slice(start, end);
  return /\byield\s+from\b/.test(snippet);
};

// Curated sections builder (copied from AstChildrenSidebar, logic unchanged)
export const buildCuratedSections = (
  node: TreeSitterAstNode
): CuratedSection[] => {
  switch (node.type) {
    case "match_stmt":
    case "match_statement": {
      // match <subject>: case ...
      const children = node.namedChildren || [];
      const cases = children.filter(
        (c) => c.type === "case_block" || c.type === "case_clause"
      );
      const subject = children.find(
        (c) => c.type !== "case_block" && c.type !== "case_clause"
      );
      return [
        { key: "subject", items: subject ? [subject] : [] },
        { key: "cases", items: cases },
      ];
    }

    case "case_block":
    case "case_clause": {
      // case <pattern> [if guard]: <block>
      const pattern = (node.namedChildren || []).find(
        (c) => c.type === "pattern" || c.type === "pattern_list"
      );
      const guard =
        firstChildOfType(node, "guard") || firstChildOfType(node, "if_clause");
      const block = firstChildOfType(node, "block");
      return [
        { key: "pattern", items: pattern ? [pattern] : [] },
        { key: "guard", items: guard ? [guard] : [] },
        { key: "body", items: block ? [block] : [] },
      ];
    }

    // Pattern matching: curated views for common pattern node types
    case "or_pattern": {
      // p1 | p2 | ...
      return [{ key: "patterns", items: node.namedChildren || [] }];
    }

    case "as_pattern": {
      // <pattern> as name
      const name = (node.namedChildren || []).find(
        (c) => c.type === "identifier"
      );
      const inner = (node.namedChildren || []).find((c) => c !== name);
      return [
        { key: "pattern", items: inner ? [inner] : [] },
        { key: "name", items: name ? [name] : [] },
      ];
    }

    case "class_pattern": {
      // Point(x=..., y=...)
      const cls =
        firstChildOfType(node, "identifier") ||
        firstChildOfType(node, "dotted_name");
      // Normalize arg container label differences
      const argsNode = firstChildOfTypes(node, ["argument_list", "arguments"]);
      const allArgs = argsNode ? argsNode.namedChildren || [] : [];
      const keywords = allArgs.filter((c) => c.type === "keyword_argument");
      const positionals = allArgs.filter((c) => c.type !== "keyword_argument");
      // Only include actual bindings: identifiers from capture_pattern and as_pattern
      const captureIds = collectDescendants(
        node,
        (n) => n.type === "capture_pattern"
      )
        .map((n) => firstChildOfType(n, "identifier"))
        .filter(Boolean) as TreeSitterAstNode[];
      const asIds = collectDescendants(node, (n) => n.type === "as_pattern")
        .map((n) =>
          (n.namedChildren || []).find((c) => c.type === "identifier")
        )
        .filter(Boolean) as TreeSitterAstNode[];
      const boundNames = [...captureIds, ...asIds];
      return [
        { key: "class", items: cls ? [cls] : [] },
        { key: "args", items: positionals },
        { key: "keywords", items: keywords },
        { key: "binds", items: boundNames },
      ];
    }

    case "sequence_pattern":
    case "list_pattern":
    case "tuple_pattern": {
      return [{ key: "elements", items: node.namedChildren || [] }];
    }

    case "mapping_pattern": {
      const keys: TreeSitterAstNode[] = [];
      const values: TreeSitterAstNode[] = [];
      let restNode: TreeSitterAstNode | undefined;
      for (const c of node.namedChildren || []) {
        if (c.type === "pair" || c.type === "key_value_pattern") {
          const [k, v] = c.namedChildren || [];
          if (k) keys.push(k);
          if (v) values.push(v);
        } else if (
          c.type === "dictionary_splat" ||
          c.type === "rest_pattern" ||
          c.type === "double_star_pattern"
        ) {
          // **rest in mapping patterns
          restNode = (c.namedChildren || [])[0] || c;
        }
      }
      return [
        { key: "keys", items: keys },
        { key: "values", items: values },
        { key: "rest", items: restNode ? [restNode] : [] },
      ];
    }

    case "pattern_list": {
      return [{ key: "patterns", items: node.namedChildren || [] }];
    }

    case "capture_pattern": {
      const name = (node.namedChildren || []).find(
        (c) => c.type === "identifier"
      );
      return [{ key: "name", items: name ? [name] : [] }];
    }

    case "value_pattern":
    case "literal_pattern": {
      return [{ key: "value", items: node.namedChildren || [] }];
    }

    case "raise_stmt":
    case "raise_statement": {
      // raise <exc> [from <cause>]
      const children = node.namedChildren || [];
      const exc = children[0] ? [children[0]] : [];
      const cause = children.length > 1 ? [children[children.length - 1]] : [];
      return [
        { key: "exc", items: exc },
        { key: "cause", items: cause },
      ];
    }

    case "assert_stmt":
    case "assert_statement": {
      // assert <test>[, <msg>]
      const children = node.namedChildren || [];
      const test = children[0] ? [children[0]] : [];
      const msg = children.length > 1 ? [children[1]] : [];
      return [
        { key: "test", items: test },
        { key: "msg", items: msg },
      ];
    }

    case "del_stmt":
    case "del_statement": {
      // del a, b, c
      return [{ key: "targets", items: node.namedChildren || [] }];
    }

    case "yield_expr":
    case "yield_expression":
    case "yield": {
      // yield [value]
      return [{ key: "value", items: node.namedChildren || [] }];
    }

    case "type_alias":
    case "type_alias_statement": {
      // type Name[Params]? = Value
      const children = node.namedChildren || [];
      const nameNode = children.find(
        (c) => c.type === "identifier" || c.type === "type_identifier"
      );
      const typeParams = children.find(
        (c) =>
          c.type === "type_params" ||
          c.type === "type_parameters" ||
          c.type === "type_parameter_list"
      );
      const value = children
        .filter((c) => c !== nameNode && c !== typeParams)
        .slice(-1)[0];
      return [
        { key: "name", items: nameNode ? [nameNode] : [] },
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "value", items: value ? [value] : [] },
      ];
    }

    case "global_stmt":
    case "global_statement": {
      const names = (node.namedChildren || []).filter(
        (c) => c.type === "identifier"
      );
      return [{ key: "names", items: names }];
    }

    case "nonlocal_stmt":
    case "nonlocal_statement": {
      const names = (node.namedChildren || []).filter(
        (c) => c.type === "identifier"
      );
      return [{ key: "names", items: names }];
    }

    case "conditional_expression":
    case "if_expression": {
      // a if cond else b
      const children = node.namedChildren || [];
      const body = children[0] ? [children[0]] : [];
      const test = children.length > 1 ? [children[1]] : [];
      const orelse = children.length > 2 ? [children[2]] : [];
      return [
        { key: "body", items: body },
        { key: "test", items: test },
        { key: "orelse", items: orelse },
      ];
    }

    case "lambda": {
      // lambda [params]: expr
      const paramsNode =
        firstChildOfType(node, "lambda_parameters") ||
        firstChildOfType(node, "parameters");
      const args = paramsNode ? paramsNode.namedChildren || [] : [];
      const children = node.namedChildren || [];
      const body = children.length > 0 ? [children[children.length - 1]] : [];
      return [
        { key: "args", items: args },
        { key: "body", items: body },
      ];
    }

    case "assignment_expression": {
      // NAME := value
      const children = node.namedChildren || [];
      const target = children[0] ? [children[0]] : [];
      const value = children.length > 1 ? [children[children.length - 1]] : [];
      return [
        { key: "target", items: target },
        { key: "value", items: value },
      ];
    }

    case "dictionary":
    case "dict": {
      // {k: v, **d}
      const keys: TreeSitterAstNode[] = [];
      const values: TreeSitterAstNode[] = [];
      for (const c of node.namedChildren || []) {
        if (c.type === "pair") {
          const [k, v] = c.namedChildren || [];
          if (k) keys.push(k);
          if (v) values.push(v);
        } else if (c.type === "dictionary_splat") {
          // **expr has only a value
          const inner = (c.namedChildren || [])[0];
          if (inner) values.push(inner);
        }
      }
      return [
        { key: "keys", items: keys },
        { key: "values", items: values },
      ];
    }

    case "list":
    case "tuple":
    case "set": {
      // [elts], (elts), {elts}
      return [{ key: "elts", items: node.namedChildren || [] }];
    }

    case "dictionary_comprehension": {
      // {k: v for ... if ...}
      const pair = firstChildOfType(node, "pair");
      const key = pair?.namedChildren?.[0] ? [pair.namedChildren[0]] : [];
      const value = pair?.namedChildren?.[1] ? [pair.namedChildren[1]] : [];
      const generators = (node.namedChildren || []).filter(
        (c) => c.type === "for_in_clause" || c.type === "if_clause"
      );
      return [
        { key: "key", items: key },
        { key: "value", items: value },
        { key: "generators", items: generators },
      ];
    }

    case "set_comprehension":
    case "generator_expression": {
      // {elt for ... if ...} / (elt for ... if ...)
      const children = node.namedChildren || [];
      const elt = children[0] ? [children[0]] : [];
      const generators = children
        .slice(1)
        .filter((c) => c.type === "for_in_clause" || c.type === "if_clause");
      return [
        { key: "elt", items: elt },
        { key: "generators", items: generators },
      ];
    }
    case "import_statement": {
      // import os, sys.path as p
      // Expose the list of imported names/modules (aliased_import or dotted_name)
      const names = (node.namedChildren || []).filter(
        (c) =>
          c.type === "aliased_import" ||
          c.type === "dotted_name" ||
          c.type === "identifier"
      );
      return [{ key: "names", items: names }];
    }

    case "import_from_statement": {
      // from typing import List, Dict
      // Children: source module and the imported names
      const children = node.namedChildren || [];
      const moduleNode = children.find(
        (c) => c.type === "dotted_name" || c.type === "relative_import"
      );
      const rest = children.filter((c) => c !== moduleNode);
      const wildcard = rest.find((c) => c.type === "wildcard_import");
      const names = rest.filter(
        (c) =>
          c.type === "aliased_import" ||
          c.type === "dotted_name" ||
          c.type === "identifier"
      );
      return [
        { key: "module", items: moduleNode ? [moduleNode] : [] },
        ...(wildcard
          ? [{ key: "wildcard", items: [wildcard] as TreeSitterAstNode[] }]
          : []),
        { key: "names", items: names },
      ];
    }

    case "with_statement": {
      // with open("f.txt") as f, manager() as m: <block>
      const block = firstChildOfType(node, "block");
      const body = block ? [block] : [];
      // Items: list of context managers (with_item nodes in tree-sitter)
      const items = (node.namedChildren || []).filter(
        (c) => c.type !== "block"
      );
      return [
        { key: "items", items },
        { key: "body", items: body },
      ];
    }

    case "with_item": {
      // open("f.txt") as f
      const context =
        childByField(node, "value") || (node.namedChildren || [])[0];
      const alias =
        childByField(node, "alias") || (node.namedChildren || [])[1];
      return [
        { key: "context", items: context ? [context] : [] },
        { key: "alias", items: alias ? [alias] : [] },
      ];
    }

    case "binary_operator": {
      // left <op> right — operator token is not a navigable child
      const leftField = childByField(node, "left");
      const rightField = childByField(node, "right");
      const children = node.namedChildren || [];
      const left = leftField ? [leftField] : children[0] ? [children[0]] : [];
      const right = rightField
        ? [rightField]
        : children.length > 1
        ? [children[children.length - 1]]
        : [];
      return [
        { key: "left", items: left },
        { key: "right", items: right },
      ];
    }

    // Unary operators: +x, -x, ~x, not x
    // Tree-sitter typically exposes only the operand as a named child; the operator token is unnamed.
    case "unary_expression":
    case "unary_operator":
    case "not_operator": {
      const operand =
        childByField(node, "argument") ||
        childByField(node, "operand") ||
        (node.namedChildren || [])[0];
      return [
        { key: "op", items: [] },
        { key: "operand", items: operand ? [operand] : [] },
      ];
    }

    case "comparison":
    case "comparison_operator": {
      // 0 < x <= 10 — not nested like binary operators
      const children = node.namedChildren || [];
      const left = children[0] ? [children[0]] : [];
      const comparators = children.slice(1);
      return [
        { key: "left", items: left },
        { key: "comparators", items: comparators },
      ];
    }

    case "list_comprehension": {
      // [x*x for x in xs if cond]
      const children = node.namedChildren || [];
      const fors = children.filter((c) => c.type === "for_in_clause");
      const ifs = children.filter((c) => c.type === "if_clause");
      const output = children.find(
        (c) => c.type !== "for_in_clause" && c.type !== "if_clause"
      );
      return [
        { key: "output", items: output ? [output] : [] },
        { key: "fors", items: fors },
        { key: "ifs", items: ifs },
      ];
    }
    case "decorated_definition": {
      // A decorated definition wraps a function or class definition with one or more decorators
      const decorators = childrenOfType(node, "decorator");
      const definition = (node.namedChildren || []).find(
        (c) => c.type === "class_definition" || c.type === "function_definition"
      );

      // Alternative approach: present an explicit wrapper structure
      // rather than mutating the inner definition's sections.
      return [
        { key: "decorators", items: decorators },
        { key: "definition", items: definition ? [definition] : [] },
      ];
    }

    case "class_definition": {
      // class NAME [(bases...)] : block
      const argList = firstChildOfType(node, "argument_list");
      const block = firstChildOfType(node, "block");
      const typeParams = firstChildOfTypes(node, [
        "type_params",
        "type_parameters",
        "type_parameter_list",
      ]);

      const keywordArgs = argList
        ? (argList.namedChildren || []).filter(
            (c) => c.type === "keyword_argument"
          )
        : [];

      const bases = argList
        ? (argList.namedChildren || []).filter(
            (c) => c.type !== "keyword_argument"
          )
        : [];

      const body = block ? [block] : [];

      return [
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "bases", items: bases },
        { key: "body", items: body },
        { key: "decorators", items: childrenOfType(node, "decorator") },
        { key: "keywords", items: keywordArgs },
      ];
    }

    case "function_definition": {
      // def NAME(parameters): block
      const params = firstChildOfType(node, "parameters");
      const args = params ? params.namedChildren || [] : [];
      const block = firstChildOfType(node, "block");
      const body = block ? [block] : [];
      const typeParams = firstChildOfTypes(node, [
        "type_params",
        "type_parameters",
        "type_parameter_list",
      ]);
      // Return annotation can appear as a child of type 'type' or 'return_type' depending on grammar
      const returnType =
        firstChildOfType(node, "type") || firstChildOfType(node, "return_type");

      return [
        { key: "type_params", items: typeParams ? [typeParams] : [] },
        { key: "args", items: args },
        { key: "body", items: body },
        { key: "decorators", items: childrenOfType(node, "decorator") },
        { key: "returns", items: returnType ? [returnType] : [] },
      ];
    }

    case "if_statement": {
      // if <test>: <body> (elif ...)* (else ...)?
      const blocks = childrenOfType(node, "block");
      const elifs = childrenOfType(node, "elif_clause");
      const elseClause = firstChildOfType(node, "else_clause");

      // Heuristic for test: first non-block/elif/else child
      const test = (node.namedChildren || []).find(
        (c) => !["block", "elif_clause", "else_clause"].includes(c.type)
      );

      const body = blocks[0] ? [blocks[0]] : [];
      const orelseItems: TreeSitterAstNode[] = [];
      if (elifs.length) {
        orelseItems.push(...elifs);
      }
      if (elseClause) {
        const elseBlock = firstChildOfType(elseClause, "block");
        if (elseBlock) orelseItems.push(elseBlock);
      }

      return [
        { key: "test", items: test ? [test] : [] },
        { key: "body", items: body },
        { key: "orelse", items: orelseItems },
      ];
    }

    case "while_statement": {
      const blocks = childrenOfType(node, "block");
      const elseClause = firstChildOfType(node, "else_clause");
      const test = (node.namedChildren || []).find(
        (c) => c.type !== "block" && c.type !== "else_clause"
      );
      const body = blocks[0] ? [blocks[0]] : [];
      return [
        { key: "test", items: test ? [test] : [] },
        { key: "body", items: body },
        {
          key: "orelse",
          items: (() => {
            if (!elseClause) return [];
            const elseBlock = firstChildOfType(elseClause, "block");
            return elseBlock ? [elseBlock] : [];
          })(),
        },
      ];
    }

    case "for_statement": {
      const blocks = childrenOfType(node, "block");
      const elseClause = firstChildOfType(node, "else_clause");

      // Prefer a structured clause if the grammar provides it (some languages)
      const inClause = firstChildOfType(node, "for_in_clause");

      let targetItems: TreeSitterAstNode[] = [];
      let iterItem: TreeSitterAstNode | undefined;

      if (inClause) {
        const clauseChildren = inClause.namedChildren || [];
        if (clauseChildren.length >= 2) {
          // Treat everything before the last item as target (supports unpacking)
          targetItems = clauseChildren.slice(0, -1);
          iterItem = clauseChildren[clauseChildren.length - 1];
        }
      } else {
        // Python: for <target> in <iter>: <block> [else ...]
        // Grab all named children before the body/else, then split: [..targets, iter]
        const head = (node.namedChildren || []).filter(
          (c) => c.type !== "block" && c.type !== "else_clause"
        );
        if (head.length >= 1) {
          if (head.length === 1) {
            // Only an iter or target detected; leave as iter for visibility
            iterItem = head[0];
          } else {
            targetItems = head.slice(0, -1);
            iterItem = head[head.length - 1];
          }
        }
      }

      const body = blocks[0] ? [blocks[0]] : [];
      return [
        { key: "target", items: targetItems },
        { key: "iter", items: iterItem ? [iterItem] : [] },
        { key: "body", items: body },
        {
          key: "orelse",
          items: (() => {
            if (!elseClause) return [];
            const elseBlock = firstChildOfType(elseClause, "block");
            return elseBlock ? [elseBlock] : [];
          })(),
        },
      ];
    }

    case "try_statement": {
      const bodyBlock = firstChildOfType(node, "block");
      const handlers = (node.namedChildren || []).filter((c) =>
        [
          "except_clause",
          "except_star_clause",
          "except_star",
          "except_star_block",
        ].includes(c.type)
      );
      const elseClause = firstChildOfType(node, "else_clause");
      const finallyClause = firstChildOfType(node, "finally_clause");
      const body = bodyBlock ? [bodyBlock] : [];
      const finalBody = (() => {
        if (!finallyClause) return [] as TreeSitterAstNode[];
        const block = firstChildOfType(finallyClause, "block");
        return block ? [block] : [];
      })();
      return [
        { key: "body", items: body },
        { key: "handlers", items: handlers },
        {
          key: "orelse",
          items: (() => {
            if (!elseClause) return [] as TreeSitterAstNode[];
            const elseBlock = firstChildOfType(elseClause, "block");
            return elseBlock ? [elseBlock] : [];
          })(),
        },
        { key: "finalbody", items: finalBody },
      ];
    }

    case "except_clause": {
      // except <type> [as name]: <block>
      const block = firstChildOfType(node, "block");
      const name = (node.namedChildren || []).find(
        (c) => c.type === "identifier"
      );
      const typeNode = (node.namedChildren || []).find(
        (c) => c !== block && c !== name
      );
      return [
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "body", items: block ? [block] : [] },
      ];
    }

    case "except_star_clause": {
      // except* <type> [as name]: <block>
      const block = firstChildOfType(node, "block");
      const name = (node.namedChildren || []).find(
        (c) => c.type === "identifier"
      );
      const typeNode = (node.namedChildren || []).find(
        (c) => c !== block && c !== name
      );
      return [
        { key: "type", items: typeNode ? [typeNode] : [] },
        { key: "name", items: name ? [name] : [] },
        { key: "body", items: block ? [block] : [] },
      ];
    }

    case "assignment": {
      // x = <value>, a, b = c, a = b = 1 (nested on the right)
      // Prefer explicit left/right semantics. Tree-sitter typically places LHS first and RHS last.
      const leftField =
        childByField(node, "left") || childByField(node, "target");
      const rightField =
        childByField(node, "right") || childByField(node, "value");
      const children = node.namedChildren || [];
      const left = leftField ? [leftField] : children[0] ? [children[0]] : [];
      const right = rightField
        ? [rightField]
        : children.length > 1
        ? [children[children.length - 1]]
        : [];
      return [
        { key: "target", items: left },
        { key: "value", items: right },
      ];
    }

    case "augmented_assignment": {
      // e.g., x += <value>
      // Tree-sitter typically exposes two named children: left (target) and right (value).
      // The operator token is not a named child and is treated as an attribute.
      const leftField =
        childByField(node, "left") || childByField(node, "target");
      const rightField =
        childByField(node, "right") || childByField(node, "value");
      const children = node.namedChildren || [];
      const target = leftField ? [leftField] : children[0] ? [children[0]] : [];
      const value = rightField
        ? [rightField]
        : children.length > 1
        ? [children[children.length - 1]]
        : [];
      return [
        { key: "target", items: target },
        { key: "value", items: value },
      ];
    }

    case "return_statement": {
      return [{ key: "value", items: node.namedChildren || [] }];
    }

    case "await_expression":
    case "await": {
      // await <value>
      return [{ key: "value", items: node.namedChildren || [] }];
    }

    case "attribute": {
      const valueNode =
        childByField(node, "object") || (node.namedChildren || [])[0];
      return [{ key: "value", items: valueNode ? [valueNode] : [] }];
    }

    case "call": {
      const func =
        childByField(node, "function") || (node.namedChildren || [])[0];
      // Arguments are in an argument_list node; prefer field when provided
      const argsList =
        childByField(node, "arguments") ||
        firstChildOfType(node, "argument_list");
      const args = argsList ? argsList.namedChildren || [] : [];
      const keywords = args.filter((c) => c.type === "keyword_argument");
      const starargs = args.filter(
        (c) => c.type === "starred_expression" || c.type === "list_splat"
      );
      const kwargs_splat = args.filter((c) => c.type === "dictionary_splat");
      const positionals = args.filter(
        (c) =>
          c.type !== "keyword_argument" &&
          c.type !== "starred_expression" &&
          c.type !== "list_splat" &&
          c.type !== "dictionary_splat"
      );
      return [
        { key: "func", items: func ? [func] : [] },
        { key: "args", items: positionals },
        ...(starargs.length ? [{ key: "starargs", items: starargs }] : []),
        { key: "keywords", items: keywords },
        ...(kwargs_splat.length
          ? [{ key: "kwargs_splat", items: kwargs_splat }]
          : []),
      ];
    }

    case "subscript": {
      const valueNode =
        childByField(node, "value") || (node.namedChildren || [])[0];
      const second =
        childByField(node, "slice") || (node.namedChildren || [])[1];
      const keyLabel = second && second.type === "slice" ? "slice" : "index";
      return [
        { key: "value", items: valueNode ? [valueNode] : [] },
        { key: keyLabel, items: second ? [second] : [] },
      ];
    }

    case "slice": {
      const parts = node.namedChildren || [];
      if (parts.length === 1) {
        return [{ key: "value", items: [parts[0]] }];
      }
      if (parts.length === 2) {
        return [
          { key: "start", items: [parts[0]] },
          { key: "stop", items: [parts[1]] },
        ];
      }
      if (parts.length >= 3) {
        return [
          { key: "start", items: [parts[0]] },
          { key: "stop", items: [parts[1]] },
          { key: "step", items: [parts[2]] },
        ];
      }
      return [{ key: "children", items: parts }];
    }

    case "starred_expression": {
      // *expr — expose the underlying value
      const valueNode = (node.namedChildren || [])[0];
      return [{ key: "value", items: valueNode ? [valueNode] : [] }];
    }

    default: {
      // Generic: expose named children under a single group for basic navigation
      return [{ key: "children", items: node.namedChildren || [] }];
    }
  }
};

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

// Turn curated sections into simple quiz cards
export function cardsFromCuratedSections(
  node: TreeSitterAstNode,
  code: string
): Array<{
  order: number;
  type: string;
  text: string;
  action: "next";
  semanticRole?: string;
  question?: string;
}> {
  const sections = buildCuratedSections(node).filter((s) => s.items.length > 0);
  const inlineHints = sections.filter(
    (s) => s.key === "body" || s.items.every((it) => it.type === "block")
  );
  const flatGroups = sections.filter((s) => !inlineHints.includes(s));

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
    if (nodeType === "function_definition" && key === "args")
      return `What is the name or text of parameter #${idx + 1}?`;
    if (nodeType === "call" && key === "func")
      return "Which function or method is being called?";
    if (nodeType === "call" && key === "args")
      return `What is positional argument #${idx + 1}?`;
    if (key === "keywords") return `Which keyword argument is here?`;
    if (key === "target") return "What is the left-hand side (target)?";
    if (key === "value") return "What is the right-hand side (value)?";
    if (key === "name") return "What is the name?";
    if (key === "class") return "What is the class name?";
    if (key === "returns") return "What is the return type?";
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
