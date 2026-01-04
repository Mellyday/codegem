"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCuratedSections = exports.getSectionFirstItem = exports.getSectionItems = exports.collectDescendants = exports.firstChildOfTypes = exports.childByField = exports.childrenByField = exports.firstChildOfType = exports.childrenOfType = void 0;
exports.getRevealAnchors = getRevealAnchors;
exports.getSectionSpan = getSectionSpan;
exports.findDeepestNodeCoveringSpan = findDeepestNodeCoveringSpan;
exports.findNodeBySpan = findNodeBySpan;
exports.findNearestAnchorCoveringSpan = findNearestAnchorCoveringSpan;
exports.cardsFromCuratedSections = cardsFromCuratedSections;
const childrenOfType = (node, type) => (node.namedChildren || []).filter((c) => c.type === type);
exports.childrenOfType = childrenOfType;
const firstChildOfType = (node, type) => (0, exports.childrenOfType)(node, type)[0];
exports.firstChildOfType = firstChildOfType;
const childrenByField = (node, field) => (node.namedChildren || []).filter((c) => c.fieldName === field);
exports.childrenByField = childrenByField;
const childByField = (node, field) => (0, exports.childrenByField)(node, field)[0];
exports.childByField = childByField;
const firstChildOfTypes = (node, types) => (node.namedChildren || []).find((c) => types.includes(c.type));
exports.firstChildOfTypes = firstChildOfTypes;
const collectDescendants = (node, predicate, out = []) => {
    for (const child of node.namedChildren || []) {
        if (predicate(child))
            out.push(child);
        (0, exports.collectDescendants)(child, predicate, out);
    }
    return out;
};
exports.collectDescendants = collectDescendants;
const getSectionItems = (node, key) => {
    const sections = (0, exports.buildCuratedSections)(node);
    return sections.find((s) => s.key === key)?.items || [];
};
exports.getSectionItems = getSectionItems;
const getSectionFirstItem = (node, key) => (0, exports.getSectionItems)(node, key)[0];
exports.getSectionFirstItem = getSectionFirstItem;
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
const filterParamNodes = (node) => (node.namedChildren || []).filter((c) => PARAM_TYPES.has(c.type));
const filterCaseBodyNodes = (node) => (node.namedChildren || []).filter((c) => {
    if (!c.fieldName)
        return true;
    return !["value", "type", "communication"].includes(c.fieldName);
});
const buildCuratedSections = (node) => {
    switch (node.type) {
        case "package_clause": {
            const name = (0, exports.firstChildOfType)(node, "package_identifier") ||
                (0, exports.firstChildOfType)(node, "identifier");
            return [{ key: "name", items: name ? [name] : [] }];
        }
        case "import_declaration": {
            const specs = (0, exports.collectDescendants)(node, (n) => IMPORT_SPEC_TYPES.has(n.type));
            return [{ key: "specs", items: specs }];
        }
        case "import_spec": {
            const name = (0, exports.childByField)(node, "name");
            const path = (0, exports.childByField)(node, "path");
            return [
                { key: "path", items: path ? [path] : [] },
                { key: "name", items: name ? [name] : [] },
            ];
        }
        case "const_declaration": {
            const specs = (0, exports.collectDescendants)(node, (n) => CONST_SPEC_TYPES.has(n.type));
            return [{ key: "specs", items: specs }];
        }
        case "var_declaration": {
            const specs = (0, exports.collectDescendants)(node, (n) => VAR_SPEC_TYPES.has(n.type));
            return [{ key: "specs", items: specs }];
        }
        case "const_spec":
        case "var_spec": {
            const names = (0, exports.childrenByField)(node, "name");
            const typeNode = (0, exports.childByField)(node, "type");
            const values = (0, exports.childrenByField)(node, "value");
            return [
                { key: "names", items: names },
                { key: "type", items: typeNode ? [typeNode] : [] },
                { key: "values", items: values },
            ];
        }
        case "type_declaration": {
            const specs = (0, exports.collectDescendants)(node, (n) => TYPE_SPEC_TYPES.has(n.type));
            return [{ key: "specs", items: specs }];
        }
        case "type_spec": {
            const name = (0, exports.childByField)(node, "name");
            const typeParams = (0, exports.childByField)(node, "type_parameters");
            const value = (0, exports.childByField)(node, "type");
            return [
                { key: "name", items: name ? [name] : [] },
                { key: "type_params", items: typeParams ? [typeParams] : [] },
                { key: "value", items: value ? [value] : [] },
            ];
        }
        case "type_alias": {
            const name = (0, exports.childByField)(node, "name");
            const value = (0, exports.childByField)(node, "type");
            return [
                { key: "name", items: name ? [name] : [] },
                { key: "value", items: value ? [value] : [] },
            ];
        }
        case "type_parameter_list": {
            const params = (0, exports.collectDescendants)(node, (n) => n.type === "type_parameter_declaration");
            return [{ key: "params", items: params }];
        }
        case "type_parameter_declaration": {
            const names = (0, exports.childrenByField)(node, "name");
            const typeNode = (0, exports.childByField)(node, "type");
            return [
                { key: "names", items: names },
                { key: "type", items: typeNode ? [typeNode] : [] },
            ];
        }
        case "function_declaration": {
            const name = (0, exports.childByField)(node, "name");
            const typeParams = (0, exports.childByField)(node, "type_parameters");
            const params = (0, exports.childByField)(node, "parameters");
            const results = (0, exports.childByField)(node, "result");
            const body = (0, exports.childByField)(node, "body") || (0, exports.firstChildOfType)(node, "block");
            return [
                { key: "name", items: name ? [name] : [] },
                { key: "type_params", items: typeParams ? [typeParams] : [] },
                { key: "params", items: params ? [params] : [] },
                { key: "results", items: results ? [results] : [] },
                { key: "body", items: body ? [body] : [] },
            ];
        }
        case "method_declaration": {
            const receiver = (0, exports.childByField)(node, "receiver");
            const name = (0, exports.childByField)(node, "name") || (0, exports.firstChildOfType)(node, "field_identifier");
            const params = (0, exports.childByField)(node, "parameters");
            const results = (0, exports.childByField)(node, "result");
            const body = (0, exports.childByField)(node, "body") || (0, exports.firstChildOfType)(node, "block");
            return [
                { key: "receiver", items: receiver ? [receiver] : [] },
                { key: "name", items: name ? [name] : [] },
                { key: "params", items: params ? [params] : [] },
                { key: "results", items: results ? [results] : [] },
                { key: "body", items: body ? [body] : [] },
            ];
        }
        case "func_literal": {
            const params = (0, exports.childByField)(node, "parameters");
            const results = (0, exports.childByField)(node, "result");
            const body = (0, exports.childByField)(node, "body") || (0, exports.firstChildOfType)(node, "block");
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
            const names = (0, exports.childrenByField)(node, "name");
            const typeNode = (0, exports.childByField)(node, "type");
            return [
                { key: "names", items: names },
                { key: "type", items: typeNode ? [typeNode] : [] },
            ];
        }
        case "struct_type": {
            const fields = (0, exports.collectDescendants)(node, (n) => FIELD_DECL_TYPES.has(n.type));
            return [{ key: "fields", items: fields }];
        }
        case "field_declaration": {
            const names = (0, exports.childrenByField)(node, "name");
            const typeNode = (0, exports.childByField)(node, "type");
            const tag = (0, exports.childByField)(node, "tag");
            return [
                { key: "names", items: names },
                { key: "type", items: typeNode ? [typeNode] : [] },
                { key: "tag", items: tag ? [tag] : [] },
            ];
        }
        case "interface_type": {
            const methods = (0, exports.collectDescendants)(node, (n) => INTERFACE_ELEM_TYPES.has(n.type));
            return [{ key: "methods", items: methods }];
        }
        case "method_elem": {
            const name = (0, exports.childByField)(node, "name");
            const params = (0, exports.childByField)(node, "parameters");
            const results = (0, exports.childByField)(node, "result");
            return [
                { key: "name", items: name ? [name] : [] },
                { key: "params", items: params ? [params] : [] },
                { key: "results", items: results ? [results] : [] },
            ];
        }
        case "if_statement": {
            const condition = (0, exports.childByField)(node, "condition");
            const body = (0, exports.childByField)(node, "consequence");
            const alt = (0, exports.childByField)(node, "alternative");
            return [
                { key: "condition", items: condition ? [condition] : [] },
                { key: "body", items: body ? [body] : [] },
                { key: "else", items: alt ? [alt] : [] },
            ];
        }
        case "for_statement": {
            const body = (0, exports.childByField)(node, "body") || (0, exports.firstChildOfType)(node, "block");
            const clause = (0, exports.firstChildOfTypes)(node, ["for_clause", "range_clause"]);
            const condition = (0, exports.firstChildOfTypes)(node, ["binary_expression", "unary_expression", "identifier", "call_expression"]);
            return [
                { key: "clause", items: clause ? [clause] : [] },
                { key: "condition", items: condition ? [condition] : [] },
                { key: "body", items: body ? [body] : [] },
            ];
        }
        case "for_clause": {
            const init = (0, exports.childByField)(node, "initializer");
            const condition = (0, exports.childByField)(node, "condition");
            const update = (0, exports.childByField)(node, "update");
            return [
                { key: "init", items: init ? [init] : [] },
                { key: "condition", items: condition ? [condition] : [] },
                { key: "update", items: update ? [update] : [] },
            ];
        }
        case "range_clause": {
            const left = (0, exports.childByField)(node, "left");
            const right = (0, exports.childByField)(node, "right");
            return [
                { key: "left", items: left ? [left] : [] },
                { key: "right", items: right ? [right] : [] },
            ];
        }
        case "expression_switch_statement": {
            const value = (0, exports.childByField)(node, "value");
            return [{ key: "value", items: value ? [value] : [] }];
        }
        case "type_switch_statement": {
            const alias = (0, exports.childByField)(node, "alias");
            const value = (0, exports.childByField)(node, "value");
            return [
                { key: "alias", items: alias ? [alias] : [] },
                { key: "value", items: value ? [value] : [] },
            ];
        }
        case "expression_case": {
            const values = (0, exports.childByField)(node, "value");
            const body = filterCaseBodyNodes(node);
            return [
                { key: "values", items: values ? [values] : [] },
                { key: "body", items: body },
            ];
        }
        case "type_case": {
            const types = (0, exports.childrenByField)(node, "type");
            const body = filterCaseBodyNodes(node);
            return [
                { key: "types", items: types },
                { key: "body", items: body },
            ];
        }
        case "communication_case": {
            const comm = (0, exports.childByField)(node, "communication");
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
            const left = (0, exports.childByField)(node, "left");
            const right = (0, exports.childByField)(node, "right");
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
            const callee = (0, exports.childByField)(node, "function") || (node.namedChildren || [])[0];
            const argsNode = (0, exports.childByField)(node, "arguments");
            const args = argsNode ? argsNode.namedChildren || [] : [];
            return [
                { key: "callee", items: callee ? [callee] : [] },
                { key: "args", items: args },
            ];
        }
        case "selector_expression": {
            const obj = (0, exports.childByField)(node, "operand");
            const prop = (0, exports.childByField)(node, "field");
            return [
                { key: "object", items: obj ? [obj] : [] },
                { key: "property", items: prop ? [prop] : [] },
            ];
        }
        case "index_expression": {
            const obj = (0, exports.childByField)(node, "operand");
            const idx = (0, exports.childByField)(node, "index");
            return [
                { key: "object", items: obj ? [obj] : [] },
                { key: "index", items: idx ? [idx] : [] },
            ];
        }
        case "slice_expression": {
            const obj = (0, exports.childByField)(node, "operand");
            const start = (0, exports.childByField)(node, "start");
            const end = (0, exports.childByField)(node, "end");
            const capacity = (0, exports.childByField)(node, "capacity");
            return [
                { key: "object", items: obj ? [obj] : [] },
                { key: "start", items: start ? [start] : [] },
                { key: "end", items: end ? [end] : [] },
                { key: "capacity", items: capacity ? [capacity] : [] },
            ];
        }
        case "composite_literal": {
            const typeNode = (0, exports.childByField)(node, "type");
            const body = (0, exports.childByField)(node, "body") || (0, exports.firstChildOfType)(node, "literal_value");
            const elements = body ? body.namedChildren || [] : [];
            return [
                { key: "type", items: typeNode ? [typeNode] : [] },
                { key: "elements", items: elements },
            ];
        }
        case "keyed_element": {
            const kids = node.namedChildren || [];
            const keyRaw = kids[0];
            const valueRaw = kids[1];
            const unwrapLiteralElement = (n) => {
                if (!n)
                    return undefined;
                if (n.type === "literal_element")
                    return (n.namedChildren || [])[0] || n;
                return n;
            };
            const key = unwrapLiteralElement(keyRaw);
            const value = unwrapLiteralElement(valueRaw);
            return [
                { key: "key", items: key ? [key] : [] },
                { key: "value", items: value ? [value] : [] },
            ];
        }
        default:
            return [{ key: "children", items: node.namedChildren || [] }];
    }
};
exports.buildCuratedSections = buildCuratedSections;
const getCaseBodyStart = (node) => {
    const bodyNodes = filterCaseBodyNodes(node).filter((c) => !CASE_TYPES.has(c.type));
    if (bodyNodes.length === 0)
        return undefined;
    return bodyNodes[0].startIndex;
};
function getRevealAnchors(node) {
    const sections = (0, exports.buildCuratedSections)(node);
    const bodySection = sections.find((s) => s.key === "body");
    const body = bodySection?.items?.[0];
    let headerEnd = body?.startIndex ?? node.endIndex;
    if (node.type === "expression_switch_statement" || node.type === "type_switch_statement" || node.type === "select_statement") {
        const cases = (node.namedChildren || []).filter((c) => CASE_TYPES.has(c.type));
        if (cases[0])
            headerEnd = cases[0].startIndex;
    }
    if (CASE_TYPES.has(node.type)) {
        const bodyStart = getCaseBodyStart(node);
        if (typeof bodyStart === "number")
            headerEnd = bodyStart;
    }
    const contentSections = sections.filter((s) => s.key !== "body" && s.items.length > 0);
    const allContentItems = contentSections.flatMap((s) => s.items);
    let contentStart;
    let contentEnd;
    if (allContentItems.length > 0) {
        contentStart = Math.min(...allContentItems.map((n) => n.startIndex));
        contentEnd = Math.max(...allContentItems.map((n) => n.endIndex));
    }
    return { headerEnd, contentStart, contentEnd };
}
function getSectionSpan(node, sectionKey) {
    const items = (0, exports.getSectionItems)(node, sectionKey);
    if (items.length === 0)
        return undefined;
    const start = Math.min(...items.map((n) => n.startIndex));
    const end = Math.max(...items.map((n) => n.endIndex));
    return { start, end };
}
function findDeepestNodeCoveringSpan(root, start, end) {
    let best;
    const dfs = (n) => {
        if (n.startIndex <= start && n.endIndex >= end) {
            best = n;
            for (const c of n.namedChildren || [])
                dfs(c);
        }
    };
    dfs(root);
    return best;
}
function findNodeBySpan(root, start, end) {
    let found;
    const dfs = (n) => {
        if (found)
            return;
        if (n.startIndex === start && n.endIndex === end) {
            found = n;
            return;
        }
        for (const c of n.namedChildren || []) {
            if (c.startIndex <= start && c.endIndex >= end)
                dfs(c);
            if (found)
                return;
        }
    };
    dfs(root);
    return found;
}
function findNearestAnchorCoveringSpan(root, start, end, types) {
    let best;
    const dfs = (n) => {
        if (n.startIndex <= start && n.endIndex >= end) {
            if (types.has(n.type))
                best = n;
            for (const c of n.namedChildren || [])
                dfs(c);
        }
    };
    dfs(root);
    return best;
}
function cardsFromCuratedSections(node, code, opts = {}) {
    const sections = (0, exports.buildCuratedSections)(node).filter((s) => s.items.length > 0);
    const includeBody = opts.includeBody ?? false;
    const inlineHints = sections.filter((s) => {
        if (s.items.length === 0)
            return false;
        if (s.key === "body")
            return !includeBody;
        return s.items.every((it) => it.type === "block");
    });
    let flatGroups = sections.filter((s) => !inlineHints.includes(s));
    if (opts.groupOrder && opts.groupOrder.length) {
        const priority = new Map();
        opts.groupOrder.forEach((k, i) => priority.set(k, i));
        const sectionIndex = new Map();
        sections.forEach((s, i) => sectionIndex.set(s, i));
        flatGroups = [...flatGroups].sort((a, b) => {
            const pa = priority.has(a.key) ? priority.get(a.key) : Number.MAX_SAFE_INTEGER;
            const pb = priority.has(b.key) ? priority.get(b.key) : Number.MAX_SAFE_INTEGER;
            if (pa !== pb)
                return pa - pb;
            const ia = sectionIndex.get(a);
            const ib = sectionIndex.get(b);
            return ia - ib;
        });
    }
    let order = 0;
    const out = [];
    const qFor = (nodeType, key, idx) => {
        if (nodeType === "function_declaration" && key === "params")
            return `What is parameter #${idx + 1}?`;
        if (nodeType === "method_declaration" && key === "params")
            return `What is parameter #${idx + 1}?`;
        if (key === "body")
            return "What is the body?";
        if (nodeType === "call_expression" && key === "callee")
            return "Which function is being called?";
        if (nodeType === "call_expression" && key === "args")
            return `What is argument #${idx + 1}?`;
        if (key === "name")
            return "What is the name?";
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
