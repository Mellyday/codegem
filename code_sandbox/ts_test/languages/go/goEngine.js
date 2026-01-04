"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEngineSteps = exports.isAnchorNode = exports.computeAstPath = exports.textForRange = exports.textForNode = void 0;
exports.generateQuestionsV11 = generateQuestionsV11;
exports.maskAndAnswerForStep = maskAndAnswerForStep;
exports.buildCustomQuizPayload = buildCustomQuizPayload;
const goCuration_1 = require("./goCuration");
const utils_1 = require("../../utils");
// ============================================================================
// Helpers
// ============================================================================
const textForNode = (node, code) => {
    return code.substring(node.startIndex, node.endIndex);
};
exports.textForNode = textForNode;
const textForRange = (start, end, code) => {
    if (typeof start === "number" &&
        typeof end === "number" &&
        typeof code === "string") {
        return code.slice(start, end);
    }
    return undefined;
};
exports.textForRange = textForRange;
const stripQuotes = (raw) => {
    const trimmed = raw.trim();
    const m = trimmed.match(/^(["'`])([\s\S]*)\1$/);
    return m ? m[2] : trimmed;
};
const headerSpanByAst = (node) => {
    const { headerEnd } = (0, goCuration_1.getRevealAnchors)(node);
    return { start: node.startIndex, end: headerEnd };
};
const headerAnswer = (node, code) => {
    if (!code)
        return node.type;
    const span = headerSpanByAst(node);
    const raw = code.substring(span.start, span.end);
    return raw.replace(/\{\s*$/, "").trimEnd();
};
const displaySpanForNode = (node) => {
    const span = headerSpanByAst(node);
    if (span.end <= span.start) {
        return { start: node.startIndex, end: node.endIndex };
    }
    return span;
};
const pathCache = new WeakMap();
const computeAstPath = (root, target) => {
    let rootCache = pathCache.get(root);
    if (!rootCache) {
        rootCache = new WeakMap();
        pathCache.set(root, rootCache);
    }
    const cached = rootCache.get(target);
    if (cached !== undefined)
        return cached;
    const path = [];
    let found = false;
    const dfs = (n, cur) => {
        if (found)
            return;
        if (n.startIndex === target.startIndex &&
            n.endIndex === target.endIndex &&
            n.type === target.type) {
            path.push(...cur);
            found = true;
            return;
        }
        (n.namedChildren || []).forEach((c, idx) => dfs(c, cur.concat(idx)));
    };
    dfs(root, []);
    rootCache.set(target, path);
    return path;
};
exports.computeAstPath = computeAstPath;
const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
    return a;
};
const GENERIC_DISTRACTORS = [
    "i",
    "j",
    "k",
    "x",
    "y",
    "z",
    "val",
    "item",
    "result",
    "data",
    "temp",
    "count",
    "index",
    "key",
    "value",
    "err",
    "ctx",
    "req",
    "resp",
    "ok",
];
const MODULE_DISTRACTORS = [
    "fmt",
    "os",
    "io",
    "bufio",
    "strings",
    "strconv",
    "bytes",
    "time",
    "context",
    "sync",
    "sync/atomic",
    "net/http",
    "net/url",
    "math",
    "encoding/json",
    "encoding/csv",
    "path/filepath",
    "database/sql",
    "testing",
];
const NAME_DISTRACTORS = [
    "err",
    "ctx",
    "req",
    "resp",
    "cfg",
    "client",
    "server",
    "handler",
    "result",
    "value",
    "index",
    "count",
    "total",
    "items",
    "data",
    "ok",
    "next",
];
const extractOperatorBetween = (code, leftEnd, rightStart) => {
    if (!code)
        return undefined;
    const raw = code.slice(leftEnd, rightStart).trim();
    return raw.replace(/\s+/g, " ");
};
const buildDistractors = (correct) => {
    if (!correct || !correct.trim()) {
        return shuffle(GENERIC_DISTRACTORS).slice(0, 3);
    }
    const out = new Set();
    let attempts = 0;
    while (out.size < 3 && attempts < 6) {
        attempts += 1;
        const variation = correct.length <= 3
            ? correct.toUpperCase() !== correct
                ? correct.toUpperCase()
                : correct.toLowerCase()
            : correct.replace(/[a-zA-Z]/, (c) => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
        if (variation !== correct)
            out.add(variation);
        if (out.size < 3)
            out.add(correct + "_");
        if (out.size < 3)
            out.add(correct.slice(0, Math.max(1, Math.floor(correct.length * 0.8))));
    }
    if (out.size < 3) {
        const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => d !== correct && !out.has(d))
            .slice(0, 3 - out.size);
        pad.forEach((d) => out.add(d));
    }
    return Array.from(out);
};
const buildMultiSelectOptionPool = (correct, code, spanStart, spanEnd) => {
    const idPool = [];
    const strPool = [];
    try {
        const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
        const reStr = /(["'`])((?:\\.|(?!\1).)*)\1/g;
        const snippet = (code || "").slice(spanStart, spanEnd);
        let m;
        while ((m = reId.exec(snippet)))
            idPool.push(m[0]);
        while ((m = reStr.exec(snippet)))
            if (m[2].trim())
                strPool.push(m[2]);
    }
    catch { }
    let pool = Array.from(new Set([...correct, ...idPool, ...strPool]));
    if (pool.length < 10) {
        const needed = 10 - pool.length;
        const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => !pool.includes(d))
            .slice(0, needed);
        pool.push(...pad);
    }
    const MAX = 10;
    const extras = shuffle(pool.filter((p) => !correct.includes(p)));
    return shuffle([
        ...correct,
        ...extras.slice(0, Math.max(0, MAX - correct.length)),
    ]).slice(0, MAX);
};
const buildKeyGroupOptionPool = (correct, allKeys, code, spanStart, spanEnd) => {
    const idPool = [];
    const strPool = [];
    try {
        const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
        const reStr = /(["'`])((?:\\.|(?!\1).)*)\1/g;
        const snippet = (code || "").slice(spanStart, spanEnd);
        let m;
        while ((m = reId.exec(snippet)))
            idPool.push(m[0]);
        while ((m = reStr.exec(snippet)))
            if (m[0].trim())
                strPool.push(m[0]);
    }
    catch { }
    const correctSet = new Set(correct);
    const candidates = [...idPool, ...strPool].filter((c) => !allKeys.has(c));
    let pool = Array.from(new Set([...correct, ...candidates]));
    if (pool.length < 10) {
        const needed = 10 - pool.length;
        const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => !pool.includes(d) && !allKeys.has(d))
            .slice(0, needed);
        pool.push(...pad);
    }
    if (pool.length < 10) {
        let idx = 1;
        while (pool.length < 10) {
            const candidate = `key${idx++}`;
            if (!pool.includes(candidate) && !allKeys.has(candidate)) {
                pool.push(candidate);
            }
        }
    }
    const extras = shuffle(pool.filter((p) => !correctSet.has(p)));
    return shuffle([
        ...correct,
        ...extras.slice(0, Math.max(0, 10 - correct.length)),
    ]).slice(0, 10);
};
const buildImportOptionPool = (correct, aliases, code, span) => {
    const pool = new Set();
    try {
        const snippetStart = Math.max(0, span.start - 500);
        const snippetEnd = span.end + 500;
        const snippet = (code || "").slice(snippetStart, snippetEnd);
        const reStr = /(["'`])((?:\\.|(?!\1).)*)\1/g;
        let m;
        while ((m = reStr.exec(snippet))) {
            const candidate = m[2];
            if (!candidate || aliases.has(candidate))
                continue;
            pool.add(candidate);
        }
    }
    catch { }
    const distractors = Array.from(pool);
    if (distractors.length < 10 - correct.length) {
        const needed = 10 - correct.length - distractors.length;
        const pad = shuffle(MODULE_DISTRACTORS)
            .filter((d) => !correct.includes(d) && !distractors.includes(d) && !aliases.has(d))
            .slice(0, needed);
        distractors.push(...pad);
    }
    const shuffledDistractors = shuffle(distractors);
    const neededDistractors = Math.max(0, 10 - correct.length);
    return shuffle([...correct, ...shuffledDistractors.slice(0, neededDistractors)]).slice(0, 10);
};
const splitCorrectIntoCards = (correct) => {
    const unique = [...new Set(correct)];
    if (unique.length <= 6)
        return [unique];
    const shuffled = shuffle(unique);
    const numCards = Math.ceil(unique.length / 6);
    const baseSize = Math.floor(unique.length / numCards);
    const remainder = unique.length % numCards;
    const cardIndices = [...Array(numCards).keys()];
    const shuffledIndices = shuffle(cardIndices);
    const extraSlots = new Set(shuffledIndices.slice(0, remainder));
    const cards = [];
    let idx = 0;
    for (let c = 0; c < numCards; c++) {
        const size = baseSize + (extraSlots.has(c) ? 1 : 0);
        cards.push(shuffled.slice(idx, idx + size));
        idx += size;
    }
    return shuffle(cards);
};
const getExpressionListItems = (node) => {
    if (!node)
        return [];
    if (node.type === "expression_list")
        return node.namedChildren || [];
    return node.namedChildren || [];
};
const getExpressionListTexts = (node, code) => {
    const items = getExpressionListItems(node);
    return items
        .map((n) => (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
};
const getParamListItems = (node) => (node?.namedChildren || []).filter((c) => c.type === "parameter_declaration" || c.type === "variadic_parameter_declaration");
const collectParamNames = (node, code) => {
    const names = [];
    let variadicName;
    let hasVariadic = false;
    for (const param of getParamListItems(node)) {
        const paramNames = (0, goCuration_1.childrenByField)(param, "name");
        if (paramNames.length > 0) {
            for (const n of paramNames) {
                const text = (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type;
                names.push(text);
            }
        }
        else {
            const typeNode = (0, goCuration_1.childByField)(param, "type");
            if (typeNode) {
                const text = (0, exports.textForRange)(typeNode.startIndex, typeNode.endIndex, code) || typeNode.type;
                names.push(text);
            }
        }
        if (param.type === "variadic_parameter_declaration") {
            hasVariadic = true;
            const nameNode = (0, goCuration_1.childrenByField)(param, "name")[0];
            if (nameNode) {
                variadicName = (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
            }
        }
    }
    return { names, variadicName, hasVariadic };
};
const collectResultInfo = (node, code) => {
    const names = [];
    const types = [];
    if (!node)
        return { names, types };
    if (node.type === "parameter_list") {
        for (const param of getParamListItems(node)) {
            const paramNames = (0, goCuration_1.childrenByField)(param, "name");
            for (const n of paramNames) {
                const text = (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type;
                names.push(text);
            }
            const typeNode = (0, goCuration_1.childByField)(param, "type") || (0, goCuration_1.firstChildOfType)(param, "type_identifier");
            if (typeNode) {
                const text = (0, exports.textForRange)(typeNode.startIndex, typeNode.endIndex, code) || typeNode.type;
                types.push(text);
            }
        }
        return { names, types };
    }
    const text = (0, exports.textForRange)(node.startIndex, node.endIndex, code);
    if (text)
        types.push(text);
    return { names, types };
};
const collectTypeParamNames = (node, code) => {
    if (!node)
        return [];
    const decls = (0, goCuration_1.getSectionItems)(node, "params");
    const out = [];
    for (const decl of decls) {
        const names = (0, goCuration_1.childrenByField)(decl, "name");
        for (const n of names) {
            const text = (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type;
            out.push(text);
        }
    }
    return out;
};
const findFuncLiteralNodes = (node, stopAtCompositeLiteral = false) => {
    const out = [];
    const stack = [node];
    while (stack.length) {
        const cur = stack.pop();
        if (stopAtCompositeLiteral && cur.type === "composite_literal")
            continue;
        if (cur.type === "func_literal")
            out.push(cur);
        (cur.namedChildren || []).forEach((c) => stack.push(c));
    }
    return out;
};
const unaryOperatorText = (node, operand, code) => {
    if (!code)
        return undefined;
    if (operand.startIndex <= node.startIndex)
        return undefined;
    return code.slice(node.startIndex, operand.startIndex).trim() || undefined;
};
const findCompositeLiteralConstructorNodes = (node, code) => {
    const out = [];
    const stack = [node];
    while (stack.length) {
        const cur = stack.pop();
        if (cur.type === "unary_expression") {
            const operand = (0, goCuration_1.childByField)(cur, "operand") || (cur.namedChildren || [])[0];
            if (operand?.type === "composite_literal") {
                const op = unaryOperatorText(cur, operand, code);
                if (op === "&") {
                    out.push(cur);
                    continue;
                }
            }
        }
        if (cur.type === "composite_literal") {
            out.push(cur);
            continue;
        }
        (cur.namedChildren || []).forEach((c) => stack.push(c));
    }
    return out;
};
const importSpecInfo = (spec, code) => {
    const pathNode = (0, goCuration_1.getSectionFirstItem)(spec, "path");
    if (!pathNode)
        return undefined;
    const rawPath = (0, exports.textForRange)(pathNode.startIndex, pathNode.endIndex, code) || "";
    const path = stripQuotes(rawPath);
    const nameNode = (0, goCuration_1.getSectionFirstItem)(spec, "name");
    const name = nameNode
        ? (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
        : undefined;
    return { path, name };
};
const extractImportRunData = (run, code) => {
    const paths = new Set();
    const aliases = new Map();
    const first = run[0];
    const last = run[run.length - 1];
    const span = { start: first.startIndex, end: last.endIndex };
    for (const stmt of run) {
        const specs = (0, goCuration_1.getSectionItems)(stmt, "specs");
        for (const spec of specs) {
            const info = importSpecInfo(spec, code);
            if (!info)
                continue;
            if (info.path)
                paths.add(info.path);
            if (info.name)
                aliases.set(info.path, info.name);
        }
    }
    return { paths, aliases, span };
};
function generateImportRunQuestions(root, run, code, profile) {
    if (!run.length)
        return [];
    const { paths, aliases, span } = extractImportRunData(run, code);
    const qs = [];
    const firstNode = run[0];
    const baseSourceRef = {
        nodeType: "import_group",
        start: span.start,
        end: span.end,
        path: (0, exports.computeAstPath)(root, firstNode),
        preview: (code || "").slice(span.start, Math.min(span.end, span.start + 120)),
    };
    const modules = Array.from(paths);
    const moduleCards = splitCorrectIntoCards(modules);
    for (const card of moduleCards) {
        const optionPool = buildImportOptionPool(card, new Set(Array.from(aliases.values())), code, span);
        qs.push({
            kind: "import_run.modules",
            stem: "Which packages are imported here? (use import paths; ignore local names)",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: card,
            multiSelectHint: card.length,
            sourceRefs: [baseSourceRef],
            generatorRule: "import_run.modules",
            revealEndBeforeChild: span.start,
            revealEndAfterChild: span.end,
        });
    }
    if (profile === "deep") {
        for (const [path, alias] of aliases.entries()) {
            if (!alias)
                continue;
            const opts = buildDistractors(alias);
            qs.push({
                kind: "import_run.alias",
                stem: `What local name is used for import \"${path}\"?`,
                answerLabel: alias,
                options: shuffle([alias, ...opts]),
                sourceRefs: [baseSourceRef],
                generatorRule: "import_run.alias",
            });
        }
    }
    return qs;
}
const headerRule = ({ node, code, sourceRef }) => {
    const answerText = headerAnswer(node, code);
    const span = headerSpanByAst(node);
    return [
        {
            kind: node.type,
            stem: "Write the full header line",
            answerLabel: answerText,
            options: [],
            sourceRefs: [sourceRef],
            generatorRule: "header.line",
            revealEndBeforeChild: span.start,
            revealEndAfterChild: span.end,
        },
    ];
};
const compositeLiteralLabel = (typeNode) => {
    if (typeNode?.type === "map_type") {
        return { keyPlural: "keys", keySingular: "key", literalNoun: "map" };
    }
    return { keyPlural: "fields", keySingular: "field", literalNoun: "struct" };
};
const collectQuestionsFromSteps = (steps) => {
    const out = [];
    const collect = (step) => {
        if (step.quiz?.questions?.length)
            out.push(...step.quiz.questions);
        const children = step.lesson?.childSteps || [];
        if (children.length)
            children.forEach(collect);
    };
    steps.forEach(collect);
    return out;
};
const collectQuestionsForBlock = (root, block, profile, code) => {
    if (!code)
        return [];
    const steps = (0, exports.generateEngineSteps)(root, block, code, { profile });
    return collectQuestionsFromSteps(steps);
};
const rulePackageClause = ({ root, node, code, sourceRef }) => {
    const nameNode = (0, goCuration_1.getSectionFirstItem)(node, "name");
    if (!nameNode)
        return;
    const nameText = (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
    return [
        {
            kind: "package_clause",
            stem: "What package is declared in this file?",
            answerLabel: nameText,
            options: buildDistractors(nameText),
            sourceRefs: [
                sourceRef,
                {
                    nodeType: nameNode.type,
                    start: nameNode.startIndex,
                    end: nameNode.endIndex,
                    path: (0, exports.computeAstPath)(root, nameNode),
                },
            ],
            generatorRule: "package.name",
        },
    ];
};
const ruleFunctionDecl = ({ root, node, code, sourceRef, profile }) => {
    const qs = [];
    const nameNode = (0, goCuration_1.getSectionFirstItem)(node, "name");
    if (nameNode) {
        const nameText = (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
        qs.push({
            kind: "function.name",
            stem: "What is the function name?",
            answerLabel: nameText,
            options: buildDistractors(nameText),
            sourceRefs: [
                sourceRef,
                {
                    nodeType: nameNode.type,
                    start: nameNode.startIndex,
                    end: nameNode.endIndex,
                    path: (0, exports.computeAstPath)(root, nameNode),
                },
            ],
            generatorRule: "function.name",
        });
    }
    const paramsNode = (0, goCuration_1.getSectionFirstItem)(node, "params");
    const { names: paramNames, variadicName, hasVariadic } = collectParamNames(paramsNode, code);
    if (paramNames.length > 0) {
        const span = (0, goCuration_1.getSectionSpan)(node, "params");
        const optionPool = buildMultiSelectOptionPool(paramNames, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "function.params",
            stem: "Which parameters does this function take?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: paramNames,
            multiSelectHint: paramNames.length,
            sourceRefs: [sourceRef],
            generatorRule: "function.params",
            revealEndBeforeChild: span?.start,
            revealEndAfterChild: span?.end,
        });
    }
    const resultsNode = (0, goCuration_1.getSectionFirstItem)(node, "results");
    const resultInfo = collectResultInfo(resultsNode, code);
    if (resultInfo.types.length > 0) {
        const span = (0, goCuration_1.getSectionSpan)(node, "results");
        const optionPool = buildMultiSelectOptionPool(resultInfo.types, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "function.results",
            stem: "What are the return result types?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: resultInfo.types,
            multiSelectHint: resultInfo.types.length,
            sourceRefs: [sourceRef],
            generatorRule: "function.results",
            revealEndBeforeChild: span?.start,
            revealEndAfterChild: span?.end,
        });
    }
    if (resultInfo.names.length > 0) {
        const optionPool = buildMultiSelectOptionPool(resultInfo.names, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "function.result_names",
            stem: "Which named return values are declared?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: resultInfo.names,
            multiSelectHint: resultInfo.names.length,
            sourceRefs: [sourceRef],
            generatorRule: "function.result_names",
        });
    }
    if (profile === "deep") {
        const answer = hasVariadic ? "Yes" : "No";
        qs.push({
            kind: "function.variadic",
            stem: "Is this function variadic?",
            answerLabel: answer,
            options: shuffle(["Yes", "No"]),
            sourceRefs: [sourceRef],
            generatorRule: "function.variadic",
        });
        if (hasVariadic && variadicName) {
            qs.push({
                kind: "function.variadic_name",
                stem: "What is the variadic parameter name?",
                answerLabel: variadicName,
                options: buildDistractors(variadicName),
                sourceRefs: [sourceRef],
                generatorRule: "function.variadic_name",
            });
        }
        const typeParamsNode = (0, goCuration_1.getSectionFirstItem)(node, "type_params");
        const typeParamNames = collectTypeParamNames(typeParamsNode, code);
        if (typeParamNames.length > 0) {
            const optionPool = buildMultiSelectOptionPool(typeParamNames, code, node.startIndex, node.endIndex);
            qs.push({
                kind: "function.type_params",
                stem: "Which type parameters are declared?",
                answerLabel: "",
                options: optionPool,
                questionType: "multi",
                multiCorrect: typeParamNames,
                multiSelectHint: typeParamNames.length,
                sourceRefs: [sourceRef],
                generatorRule: "function.type_params",
            });
        }
    }
    return qs;
};
const ruleMethodDecl = ({ root, node, code, sourceRef, profile }) => {
    const qs = [];
    const receiverNode = (0, goCuration_1.getSectionFirstItem)(node, "receiver");
    const receiverParam = receiverNode ? getParamListItems(receiverNode)[0] : undefined;
    const receiverNameNode = receiverParam ? (0, goCuration_1.childrenByField)(receiverParam, "name")[0] : undefined;
    const receiverTypeNode = receiverParam ? (0, goCuration_1.childByField)(receiverParam, "type") : undefined;
    if (receiverNameNode) {
        const text = (0, exports.textForRange)(receiverNameNode.startIndex, receiverNameNode.endIndex, code) || receiverNameNode.type;
        qs.push({
            kind: "method.receiver_name",
            stem: "What is the receiver name?",
            answerLabel: text,
            options: buildDistractors(text),
            sourceRefs: [
                sourceRef,
                {
                    nodeType: receiverNameNode.type,
                    start: receiverNameNode.startIndex,
                    end: receiverNameNode.endIndex,
                    path: (0, exports.computeAstPath)(root, receiverNameNode),
                },
            ],
            generatorRule: "method.receiver_name",
        });
    }
    if (receiverTypeNode) {
        const text = (0, exports.textForRange)(receiverTypeNode.startIndex, receiverTypeNode.endIndex, code) || receiverTypeNode.type;
        qs.push({
            kind: "method.receiver_type",
            stem: "What is the receiver type?",
            answerLabel: text,
            options: buildDistractors(text),
            sourceRefs: [
                sourceRef,
                {
                    nodeType: receiverTypeNode.type,
                    start: receiverTypeNode.startIndex,
                    end: receiverTypeNode.endIndex,
                    path: (0, exports.computeAstPath)(root, receiverTypeNode),
                },
            ],
            generatorRule: "method.receiver_type",
        });
    }
    const nameNode = (0, goCuration_1.getSectionFirstItem)(node, "name");
    if (nameNode) {
        const nameText = (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
        qs.push({
            kind: "method.name",
            stem: "What is the method name?",
            answerLabel: nameText,
            options: buildDistractors(nameText),
            sourceRefs: [
                sourceRef,
                {
                    nodeType: nameNode.type,
                    start: nameNode.startIndex,
                    end: nameNode.endIndex,
                    path: (0, exports.computeAstPath)(root, nameNode),
                },
            ],
            generatorRule: "method.name",
        });
    }
    const paramsNode = (0, goCuration_1.getSectionFirstItem)(node, "params");
    const { names: paramNames } = collectParamNames(paramsNode, code);
    if (paramNames.length > 0) {
        const optionPool = buildMultiSelectOptionPool(paramNames, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "method.params",
            stem: "Which parameters does this method take?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: paramNames,
            multiSelectHint: paramNames.length,
            sourceRefs: [sourceRef],
            generatorRule: "method.params",
        });
    }
    const resultsNode = (0, goCuration_1.getSectionFirstItem)(node, "results");
    const resultInfo = collectResultInfo(resultsNode, code);
    if (resultInfo.types.length > 0) {
        const optionPool = buildMultiSelectOptionPool(resultInfo.types, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "method.results",
            stem: "What are the return result types?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: resultInfo.types,
            multiSelectHint: resultInfo.types.length,
            sourceRefs: [sourceRef],
            generatorRule: "method.results",
        });
    }
    if (profile === "deep") {
        const typeParamsNode = (0, goCuration_1.getSectionFirstItem)(node, "type_params");
        const typeParamNames = collectTypeParamNames(typeParamsNode, code);
        if (typeParamNames.length > 0) {
            const optionPool = buildMultiSelectOptionPool(typeParamNames, code, node.startIndex, node.endIndex);
            qs.push({
                kind: "method.type_params",
                stem: "Which type parameters are declared?",
                answerLabel: "",
                options: optionPool,
                questionType: "multi",
                multiCorrect: typeParamNames,
                multiSelectHint: typeParamNames.length,
                sourceRefs: [sourceRef],
                generatorRule: "method.type_params",
            });
        }
    }
    return qs;
};
const ruleTypeDeclaration = ({ root, node, code, sourceRef, profile }) => {
    const specs = (0, goCuration_1.getSectionItems)(node, "specs");
    if (specs.length === 0)
        return;
    const names = [];
    for (const spec of specs) {
        const nameNode = (0, goCuration_1.getSectionFirstItem)(spec, "name") || (0, goCuration_1.firstChildOfType)(spec, "type_identifier");
        if (nameNode) {
            const text = (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
            names.push(text);
        }
    }
    const qs = [];
    if (names.length > 0) {
        const optionPool = buildMultiSelectOptionPool(names, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "type.names",
            stem: "Which type names are declared here?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: names,
            multiSelectHint: names.length,
            sourceRefs: [sourceRef],
            generatorRule: "type.names",
        });
    }
    const shouldDetail = profile === "deep" || specs.length === 1;
    if (shouldDetail) {
        for (const spec of specs) {
            const nameNode = (0, goCuration_1.getSectionFirstItem)(spec, "name") || (0, goCuration_1.firstChildOfType)(spec, "type_identifier");
            const valueNode = (0, goCuration_1.getSectionFirstItem)(spec, "value") || (0, goCuration_1.childByField)(spec, "type");
            const nameText = nameNode
                ? (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
                : "this type";
            if (valueNode) {
                const valueText = (0, exports.textForRange)(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
                qs.push({
                    kind: "type.underlying",
                    stem: `What is the underlying type of ${nameText}?`,
                    answerLabel: valueText,
                    options: buildDistractors(valueText),
                    sourceRefs: [
                        sourceRef,
                        {
                            nodeType: valueNode.type,
                            start: valueNode.startIndex,
                            end: valueNode.endIndex,
                            path: (0, exports.computeAstPath)(root, valueNode),
                        },
                    ],
                    generatorRule: "type.underlying",
                });
            }
            if (valueNode?.type === "struct_type") {
                const fields = (0, goCuration_1.getSectionItems)(valueNode, "fields");
                const fieldNames = [];
                for (const field of fields) {
                    const namesNodes = (0, goCuration_1.childrenByField)(field, "name");
                    if (namesNodes.length > 0) {
                        for (const n of namesNodes) {
                            const text = (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type;
                            fieldNames.push(text);
                        }
                    }
                    else {
                        const typeNode = (0, goCuration_1.childByField)(field, "type");
                        if (typeNode) {
                            const text = (0, exports.textForRange)(typeNode.startIndex, typeNode.endIndex, code) || typeNode.type;
                            fieldNames.push(text);
                        }
                    }
                }
                if (fieldNames.length > 0) {
                    const optionPool = buildMultiSelectOptionPool(fieldNames, code, valueNode.startIndex, valueNode.endIndex);
                    qs.push({
                        kind: "struct.fields",
                        stem: "Which fields are declared on this struct?",
                        answerLabel: "",
                        options: optionPool,
                        questionType: "multi",
                        multiCorrect: fieldNames,
                        multiSelectHint: fieldNames.length,
                        sourceRefs: [sourceRef],
                        generatorRule: "struct.fields",
                    });
                }
                if (profile === "deep") {
                    for (const field of fields) {
                        const tagNode = (0, goCuration_1.childByField)(field, "tag");
                        if (!tagNode)
                            continue;
                        const tagText = (0, exports.textForRange)(tagNode.startIndex, tagNode.endIndex, code) || tagNode.type;
                        const nameNode = (0, goCuration_1.childrenByField)(field, "name")[0] || (0, goCuration_1.childByField)(field, "type");
                        const fieldText = nameNode
                            ? (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type
                            : "field";
                        qs.push({
                            kind: "struct.field_tag",
                            stem: `What is the tag for field ${fieldText}?`,
                            answerLabel: tagText,
                            options: buildDistractors(tagText),
                            sourceRefs: [
                                sourceRef,
                                {
                                    nodeType: tagNode.type,
                                    start: tagNode.startIndex,
                                    end: tagNode.endIndex,
                                    path: (0, exports.computeAstPath)(root, tagNode),
                                },
                            ],
                            generatorRule: "struct.field_tag",
                        });
                    }
                }
            }
            if (valueNode?.type === "interface_type") {
                const methods = (0, goCuration_1.getSectionItems)(valueNode, "methods");
                const methodNames = [];
                for (const method of methods) {
                    if (method.type === "method_elem") {
                        const nameNode = (0, goCuration_1.childByField)(method, "name");
                        if (nameNode) {
                            const text = (0, exports.textForRange)(nameNode.startIndex, nameNode.endIndex, code) || nameNode.type;
                            methodNames.push(text);
                        }
                    }
                    else {
                        const text = (0, exports.textForRange)(method.startIndex, method.endIndex, code) || method.type;
                        methodNames.push(text);
                    }
                }
                if (methodNames.length > 0) {
                    const optionPool = buildMultiSelectOptionPool(methodNames, code, valueNode.startIndex, valueNode.endIndex);
                    qs.push({
                        kind: "interface.methods",
                        stem: "Which methods are declared on this interface?",
                        answerLabel: "",
                        options: optionPool,
                        questionType: "multi",
                        multiCorrect: methodNames,
                        multiSelectHint: methodNames.length,
                        sourceRefs: [sourceRef],
                        generatorRule: "interface.methods",
                    });
                }
            }
        }
    }
    return qs;
};
const ruleConstVarDecl = ({ root, node, code, sourceRef, profile }) => {
    const specs = (0, goCuration_1.getSectionItems)(node, "specs");
    if (specs.length === 0)
        return;
    const names = [];
    for (const spec of specs) {
        const nameNodes = (0, goCuration_1.getSectionItems)(spec, "names");
        for (const n of nameNodes) {
            const text = (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type;
            names.push(text);
        }
    }
    const qs = [];
    if (names.length > 0) {
        const optionPool = buildMultiSelectOptionPool(names, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "decl.names",
            stem: "Which names are declared here?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: names,
            multiSelectHint: names.length,
            sourceRefs: [sourceRef],
            generatorRule: "decl.names",
        });
    }
    if (profile === "deep") {
        for (const spec of specs) {
            const nameNodes = (0, goCuration_1.getSectionItems)(spec, "names");
            const valueNode = (0, goCuration_1.getSectionFirstItem)(spec, "values");
            const typeNode = (0, goCuration_1.getSectionFirstItem)(spec, "type");
            const values = valueNode ? getExpressionListTexts(valueNode, code) : [];
            if (values.length > 0 && nameNodes.length > 0) {
                if (values.length === 1 && nameNodes.length > 1) {
                    const valueText = values[0];
                    qs.push({
                        kind: "decl.values",
                        stem: "What value initializes these bindings?",
                        answerLabel: valueText,
                        options: buildDistractors(valueText),
                        sourceRefs: [sourceRef],
                        generatorRule: "decl.values",
                    });
                }
                else {
                    const limit = Math.min(nameNodes.length, values.length, 3);
                    for (let i = 0; i < limit; i++) {
                        const nameText = (0, exports.textForRange)(nameNodes[i].startIndex, nameNodes[i].endIndex, code) || nameNodes[i].type;
                        const valueText = values[i];
                        qs.push({
                            kind: "decl.value",
                            stem: `What value initializes ${nameText}?`,
                            answerLabel: valueText,
                            options: buildDistractors(valueText),
                            sourceRefs: [sourceRef],
                            generatorRule: "decl.value",
                        });
                    }
                }
            }
            if (typeNode) {
                const typeText = (0, exports.textForRange)(typeNode.startIndex, typeNode.endIndex, code) || typeNode.type;
                qs.push({
                    kind: "decl.type",
                    stem: "What is the declared type?",
                    answerLabel: typeText,
                    options: buildDistractors(typeText),
                    sourceRefs: [
                        sourceRef,
                        {
                            nodeType: typeNode.type,
                            start: typeNode.startIndex,
                            end: typeNode.endIndex,
                            path: (0, exports.computeAstPath)(root, typeNode),
                        },
                    ],
                    generatorRule: "decl.type",
                });
            }
        }
    }
    for (const spec of specs) {
        const valueNode = (0, goCuration_1.getSectionFirstItem)(spec, "values");
        if (!valueNode)
            continue;
        const composites = findCompositeLiteralConstructorNodes(valueNode, code);
        for (const ctor of composites) {
            qs.push(...generateQuestionsV11(root, ctor, profile, code));
        }
    }
    return qs;
};
const compositeLiteralKeyedEntries = (node, code) => {
    const elements = (0, goCuration_1.getSectionItems)(node, "elements");
    if (elements.length === 0)
        return [];
    const keyed = [];
    for (const elem of elements) {
        if (elem.type !== "keyed_element")
            continue;
        const keyNode = (0, goCuration_1.getSectionFirstItem)(elem, "key");
        if (!keyNode)
            continue;
        const valueNode = (0, goCuration_1.getSectionFirstItem)(elem, "value");
        const keyText = (0, exports.textForRange)(keyNode.startIndex, keyNode.endIndex, code) || keyNode.type;
        if (!keyText)
            continue;
        keyed.push({ keyNode, valueNode, keyText });
    }
    return keyed;
};
const compositeLiteralTypeInfo = (node, code, wrapper) => {
    if (!code)
        return undefined;
    const typeNode = (0, goCuration_1.getSectionFirstItem)(node, "type");
    if (!typeNode)
        return undefined;
    const typeText = (0, exports.textForRange)(typeNode.startIndex, typeNode.endIndex, code) || typeNode.type;
    if (!typeText)
        return undefined;
    const answer = wrapper?.operator ? `${wrapper.operator}${typeText}` : typeText;
    const start = wrapper?.operator ? wrapper.node.startIndex : typeNode.startIndex;
    const end = typeNode.endIndex;
    return { answer, span: { start, end }, typeNode };
};
const conciseValueLabel = (valueNode, code) => {
    if (!code)
        return valueNode.type;
    if (valueNode.type === "func_literal") {
        return headerAnswer(valueNode, code);
    }
    if (valueNode.type === "unary_expression") {
        const operand = (0, goCuration_1.childByField)(valueNode, "operand") || (valueNode.namedChildren || [])[0];
        if (operand?.type === "composite_literal") {
            const op = unaryOperatorText(valueNode, operand, code);
            if (op === "&") {
                const info = compositeLiteralTypeInfo(operand, code, { node: valueNode, operator: op });
                if (info)
                    return info.answer;
            }
        }
    }
    if (valueNode.type === "composite_literal") {
        const info = compositeLiteralTypeInfo(valueNode, code);
        if (info)
            return info.answer;
    }
    return (0, exports.textForRange)(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
};
const generateCompositeLiteralQuestions = (params) => {
    const { root, node, code, sourceRef, profile, wrapper } = params;
    const keyed = compositeLiteralKeyedEntries(node, code);
    if (keyed.length === 0)
        return;
    const typeNode = (0, goCuration_1.getSectionFirstItem)(node, "type");
    const label = compositeLiteralLabel(typeNode);
    const allKeys = keyed.map((k) => k.keyText).filter(Boolean);
    if (allKeys.length === 0)
        return;
    const keyNodeByText = new Map();
    for (const entry of keyed) {
        if (!keyNodeByText.has(entry.keyText))
            keyNodeByText.set(entry.keyText, entry.keyNode);
    }
    const qs = [];
    const typeInfo = compositeLiteralTypeInfo(node, code, wrapper);
    if (typeInfo) {
        const typeStem = `What is the type of this ${label.literalNoun} literal?`;
        qs.push({
            kind: "composite.type",
            stem: typeStem,
            answerLabel: typeInfo.answer,
            options: buildDistractors(typeInfo.answer),
            sourceRefs: [
                {
                    nodeType: typeInfo.typeNode.type,
                    start: typeInfo.typeNode.startIndex,
                    end: typeInfo.typeNode.endIndex,
                    path: (0, exports.computeAstPath)(root, typeInfo.typeNode),
                },
                sourceRef,
            ],
            generatorRule: "composite.type",
            revealEndBeforeChild: typeInfo.span.start,
            revealEndAfterChild: typeInfo.span.end,
        });
    }
    const keyGroups = splitCorrectIntoCards(allKeys);
    const keySet = new Set(allKeys);
    const keyStem = `Which ${label.keyPlural} are present in this ${label.literalNoun} literal?`;
    for (const group of keyGroups) {
        if (group.length === 0)
            continue;
        const optionPool = buildKeyGroupOptionPool(group, keySet, code, node.startIndex, node.endIndex);
        const keyNode = keyNodeByText.get(group[0]);
        const keyRef = keyNode
            ? {
                nodeType: keyNode.type,
                start: keyNode.startIndex,
                end: keyNode.endIndex,
                path: (0, exports.computeAstPath)(root, keyNode),
            }
            : undefined;
        qs.push({
            kind: "composite.keys",
            stem: keyStem,
            answerLabel: "",
            options: optionPool,
            optionPool,
            questionType: "multi",
            multiCorrect: group,
            multiSelectHint: group.length,
            sourceRefs: keyRef ? [keyRef, sourceRef] : [sourceRef],
            generatorRule: "composite.keys",
        });
    }
    // Per-key value questions and value-node drilling in source order.
    for (const entry of keyed) {
        const valueNode = entry.valueNode;
        if (!valueNode)
            continue;
        const valueLabel = conciseValueLabel(valueNode, code);
        qs.push({
            kind: "composite.value",
            stem: `What is the value for ${label.keySingular} ${entry.keyText}?`,
            answerLabel: valueLabel,
            options: buildDistractors(valueLabel),
            sourceRefs: [
                {
                    nodeType: entry.keyNode.type,
                    start: entry.keyNode.startIndex,
                    end: entry.keyNode.endIndex,
                    path: (0, exports.computeAstPath)(root, entry.keyNode),
                },
                {
                    nodeType: valueNode.type,
                    start: valueNode.startIndex,
                    end: valueNode.endIndex,
                    path: (0, exports.computeAstPath)(root, valueNode),
                },
                sourceRef,
            ],
            generatorRule: "composite.value",
        });
        const valueQuestions = generateQuestionsV11(root, valueNode, profile, code);
        if (valueQuestions.length > 0)
            qs.push(...valueQuestions);
        if (valueNode.type === "func_literal") {
            const body = (0, goCuration_1.childByField)(valueNode, "body") || (0, goCuration_1.firstChildOfType)(valueNode, "block");
            if (body)
                qs.push(...collectQuestionsForBlock(root, body, profile, code));
        }
    }
    return qs;
};
const ruleCompositeLiteral = ({ root, node, code, sourceRef, profile }) => {
    return generateCompositeLiteralQuestions({ root, node, code, sourceRef, profile });
};
const ruleUnaryExpression = ({ root, node, code, sourceRef, profile }) => {
    if (node.type !== "unary_expression")
        return;
    const operand = (0, goCuration_1.childByField)(node, "operand") || (node.namedChildren || [])[0];
    if (!operand || operand.type !== "composite_literal")
        return;
    const op = unaryOperatorText(node, operand, code);
    if (op !== "&")
        return;
    return generateCompositeLiteralQuestions({
        root,
        node: operand,
        code,
        sourceRef,
        profile,
        wrapper: { node, operator: op },
    });
};
const ruleShortVarDecl = ({ root, node, code, sourceRef, profile }) => {
    const leftNode = (0, goCuration_1.getSectionFirstItem)(node, "left");
    const rightNode = (0, goCuration_1.getSectionFirstItem)(node, "right");
    const leftItems = getExpressionListItems(leftNode);
    const rightItems = getExpressionListItems(rightNode);
    const leftTexts = leftItems
        .map((n) => (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
    const rightTexts = rightItems
        .map((n) => (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
    const qs = [];
    if (leftTexts.length > 0) {
        const optionPool = buildMultiSelectOptionPool(leftTexts, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "short_var.names",
            stem: "Which names are bound by this short declaration?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: leftTexts,
            multiSelectHint: leftTexts.length,
            sourceRefs: [sourceRef],
            generatorRule: "short_var.names",
        });
    }
    if (rightTexts.length > 0) {
        if (rightTexts.length === 1) {
            qs.push({
                kind: "short_var.value",
                stem: "What is the right-hand expression?",
                answerLabel: rightTexts[0],
                options: buildDistractors(rightTexts[0]),
                sourceRefs: [sourceRef],
                generatorRule: "short_var.value",
            });
        }
        else {
            const optionPool = buildMultiSelectOptionPool(rightTexts, code, node.startIndex, node.endIndex);
            qs.push({
                kind: "short_var.values",
                stem: "What are the right-hand expressions?",
                answerLabel: "",
                options: optionPool,
                questionType: "multi",
                multiCorrect: rightTexts,
                multiSelectHint: rightTexts.length,
                sourceRefs: [sourceRef],
                generatorRule: "short_var.values",
            });
        }
    }
    if (rightNode) {
        const composites = findCompositeLiteralConstructorNodes(rightNode, code);
        for (const ctor of composites) {
            qs.push(...generateQuestionsV11(root, ctor, profile, code));
        }
    }
    if (profile === "deep" && rightNode) {
        const funcLits = findFuncLiteralNodes(rightNode, true);
        for (const lit of funcLits) {
            qs.push(...generateQuestionsV11(root, lit, profile, code));
        }
    }
    return qs;
};
const ruleAssignment = ({ root, node, code, sourceRef, profile }) => {
    const leftNode = (0, goCuration_1.getSectionFirstItem)(node, "left");
    const rightNode = (0, goCuration_1.getSectionFirstItem)(node, "right");
    const leftTexts = getExpressionListTexts(leftNode, code);
    const rightTexts = getExpressionListTexts(rightNode, code);
    const qs = [];
    if (leftTexts.length > 0) {
        const optionPool = buildMultiSelectOptionPool(leftTexts, code, node.startIndex, node.endIndex);
        qs.push({
            kind: "assign.left",
            stem: "What is the left-hand target(s)?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: leftTexts,
            multiSelectHint: leftTexts.length,
            sourceRefs: [sourceRef],
            generatorRule: "assign.left",
        });
    }
    if (rightTexts.length > 0) {
        if (rightTexts.length === 1) {
            qs.push({
                kind: "assign.right",
                stem: "What is the right-hand value?",
                answerLabel: rightTexts[0],
                options: buildDistractors(rightTexts[0]),
                sourceRefs: [sourceRef],
                generatorRule: "assign.right",
            });
        }
        else {
            const optionPool = buildMultiSelectOptionPool(rightTexts, code, node.startIndex, node.endIndex);
            qs.push({
                kind: "assign.rights",
                stem: "What are the right-hand values?",
                answerLabel: "",
                options: optionPool,
                questionType: "multi",
                multiCorrect: rightTexts,
                multiSelectHint: rightTexts.length,
                sourceRefs: [sourceRef],
                generatorRule: "assign.rights",
            });
        }
    }
    if (leftNode && rightNode && code) {
        const op = extractOperatorBetween(code, leftNode.endIndex, rightNode.startIndex);
        if (op && op !== "=") {
            qs.push({
                kind: "assign.operator",
                stem: "What is the operator?",
                answerLabel: op,
                options: buildDistractors(op),
                sourceRefs: [sourceRef],
                generatorRule: "assign.operator",
            });
        }
    }
    if (rightNode) {
        const composites = findCompositeLiteralConstructorNodes(rightNode, code);
        for (const ctor of composites) {
            qs.push(...generateQuestionsV11(root, ctor, profile, code));
        }
    }
    return qs;
};
const ruleIncDec = ({ node, code, sourceRef }) => {
    const operand = (0, goCuration_1.getSectionFirstItem)(node, "operand") || (node.namedChildren || [])[0];
    if (!operand)
        return;
    const opText = node.type === "dec_statement" ? "--" : "++";
    const operandText = (0, exports.textForRange)(operand.startIndex, operand.endIndex, code) || operand.type;
    return [
        {
            kind: "incdec.op",
            stem: "Is this an increment or decrement?",
            answerLabel: opText,
            options: shuffle(["++", "--"]),
            sourceRefs: [sourceRef],
            generatorRule: "incdec.op",
        },
        {
            kind: "incdec.target",
            stem: "What variable is being updated?",
            answerLabel: operandText,
            options: buildDistractors(operandText),
            sourceRefs: [sourceRef],
            generatorRule: "incdec.target",
        },
    ];
};
const ruleIfStatement = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const condNode = (0, goCuration_1.getSectionFirstItem)(node, "condition");
    if (!condNode)
        return [];
    const condText = (0, exports.textForRange)(condNode.startIndex, condNode.endIndex, code) || condNode.type;
    return [
        {
            kind: "if.condition",
            stem: "What is the if condition?",
            answerLabel: condText,
            options: buildDistractors(condText),
            sourceRefs: [sourceRef],
            generatorRule: "if.condition",
        },
    ];
};
const ruleForStatement = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const clause = (0, goCuration_1.firstChildOfType)(node, "for_clause");
    const rangeClause = (0, goCuration_1.firstChildOfType)(node, "range_clause");
    const qs = [];
    if (rangeClause) {
        const leftNode = (0, goCuration_1.childByField)(rangeClause, "left");
        const rightNode = (0, goCuration_1.childByField)(rangeClause, "right");
        const leftTexts = getExpressionListTexts(leftNode, code);
        const rightText = rightNode ? (0, exports.textForRange)(rightNode.startIndex, rightNode.endIndex, code) || rightNode.type : undefined;
        if (rightText) {
            qs.push({
                kind: "for.range_expr",
                stem: "What is being ranged over?",
                answerLabel: rightText,
                options: buildDistractors(rightText),
                sourceRefs: [sourceRef],
                generatorRule: "for.range_expr",
            });
        }
        if (leftTexts.length > 0) {
            const optionPool = buildMultiSelectOptionPool(leftTexts, code, rangeClause.startIndex, rangeClause.endIndex);
            qs.push({
                kind: "for.range_bindings",
                stem: "Which loop bindings are used?",
                answerLabel: "",
                options: optionPool,
                questionType: "multi",
                multiCorrect: leftTexts,
                multiSelectHint: leftTexts.length,
                sourceRefs: [sourceRef],
                generatorRule: "for.range_bindings",
            });
        }
        return qs;
    }
    if (clause) {
        const init = (0, goCuration_1.childByField)(clause, "initializer");
        const condition = (0, goCuration_1.childByField)(clause, "condition");
        const update = (0, goCuration_1.childByField)(clause, "update");
        if (init) {
            const initText = (0, exports.textForRange)(init.startIndex, init.endIndex, code) || init.type;
            qs.push({
                kind: "for.init",
                stem: "What is the initializer?",
                answerLabel: initText,
                options: buildDistractors(initText),
                sourceRefs: [sourceRef],
                generatorRule: "for.init",
            });
        }
        if (condition) {
            const condText = (0, exports.textForRange)(condition.startIndex, condition.endIndex, code) || condition.type;
            qs.push({
                kind: "for.condition",
                stem: "What is the loop condition?",
                answerLabel: condText,
                options: buildDistractors(condText),
                sourceRefs: [sourceRef],
                generatorRule: "for.condition",
            });
        }
        if (update) {
            const updateText = (0, exports.textForRange)(update.startIndex, update.endIndex, code) || update.type;
            qs.push({
                kind: "for.update",
                stem: "What is the update expression?",
                answerLabel: updateText,
                options: buildDistractors(updateText),
                sourceRefs: [sourceRef],
                generatorRule: "for.update",
            });
        }
        return qs;
    }
    const conditionExpr = (node.namedChildren || []).find((c) => c.type !== "block");
    if (conditionExpr) {
        const condText = (0, exports.textForRange)(conditionExpr.startIndex, conditionExpr.endIndex, code) || conditionExpr.type;
        qs.push({
            kind: "for.condition",
            stem: "What is the loop condition?",
            answerLabel: condText,
            options: buildDistractors(condText),
            sourceRefs: [sourceRef],
            generatorRule: "for.condition",
        });
    }
    else {
        qs.push({
            kind: "for.infinite",
            stem: "Is this an infinite loop?",
            answerLabel: "Yes",
            options: shuffle(["Yes", "No"]),
            sourceRefs: [sourceRef],
            generatorRule: "for.infinite",
        });
    }
    return qs;
};
const ruleExpressionSwitch = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const valueNode = (0, goCuration_1.getSectionFirstItem)(node, "value");
    if (!valueNode)
        return [];
    const valueText = (0, exports.textForRange)(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
    return [
        {
            kind: "switch.value",
            stem: "What value is being switched on?",
            answerLabel: valueText,
            options: buildDistractors(valueText),
            sourceRefs: [sourceRef],
            generatorRule: "switch.value",
        },
    ];
};
const ruleTypeSwitch = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const valueNode = (0, goCuration_1.getSectionFirstItem)(node, "value");
    if (!valueNode)
        return [];
    const valueText = (0, exports.textForRange)(valueNode.startIndex, valueNode.endIndex, code) || valueNode.type;
    return [
        {
            kind: "type_switch.value",
            stem: "What expression is type-switched on?",
            answerLabel: valueText,
            options: buildDistractors(valueText),
            sourceRefs: [sourceRef],
            generatorRule: "type_switch.value",
        },
    ];
};
const ruleExpressionCase = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const valuesNode = (0, goCuration_1.getSectionFirstItem)(node, "values");
    if (!valuesNode)
        return [];
    const values = getExpressionListTexts(valuesNode, code);
    if (values.length === 0)
        return [];
    const optionPool = buildMultiSelectOptionPool(values, code, node.startIndex, node.endIndex);
    return [
        {
            kind: "case.values",
            stem: "What are the case expressions?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: values,
            multiSelectHint: values.length,
            sourceRefs: [sourceRef],
            generatorRule: "case.values",
        },
    ];
};
const ruleTypeCase = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const typeNodes = (0, goCuration_1.getSectionItems)(node, "types");
    const types = typeNodes
        .map((t) => (0, exports.textForRange)(t.startIndex, t.endIndex, code) || t.type)
        .filter(Boolean);
    if (types.length === 0)
        return [];
    const optionPool = buildMultiSelectOptionPool(types, code, node.startIndex, node.endIndex);
    return [
        {
            kind: "case.types",
            stem: "What are the case types?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: types,
            multiSelectHint: types.length,
            sourceRefs: [sourceRef],
            generatorRule: "case.types",
        },
    ];
};
const ruleCommunicationCase = ({ node, code, sourceRef, profile }) => {
    if (profile !== "deep")
        return [];
    const comm = (0, goCuration_1.getSectionFirstItem)(node, "communication");
    if (!comm)
        return [];
    const qs = [];
    if (comm.type === "send_statement") {
        const channel = (0, goCuration_1.childByField)(comm, "channel");
        const value = (0, goCuration_1.childByField)(comm, "value");
        if (channel) {
            const text = (0, exports.textForRange)(channel.startIndex, channel.endIndex, code) || channel.type;
            qs.push({
                kind: "select.channel",
                stem: "What channel is communicated on?",
                answerLabel: text,
                options: buildDistractors(text),
                sourceRefs: [sourceRef],
                generatorRule: "select.channel",
            });
        }
        if (value) {
            const text = (0, exports.textForRange)(value.startIndex, value.endIndex, code) || value.type;
            qs.push({
                kind: "select.value",
                stem: "What value is sent?",
                answerLabel: text,
                options: buildDistractors(text),
                sourceRefs: [sourceRef],
                generatorRule: "select.value",
            });
        }
    }
    if (comm.type === "receive_statement") {
        const left = (0, goCuration_1.childByField)(comm, "left");
        const right = (0, goCuration_1.childByField)(comm, "right");
        if (right) {
            const text = (0, exports.textForRange)(right.startIndex, right.endIndex, code) || right.type;
            qs.push({
                kind: "select.receive",
                stem: "What channel is received from?",
                answerLabel: text,
                options: buildDistractors(text),
                sourceRefs: [sourceRef],
                generatorRule: "select.receive",
            });
        }
        const leftTexts = left ? getExpressionListTexts(left, code) : [];
        if (leftTexts.length > 0) {
            const optionPool = buildMultiSelectOptionPool(leftTexts, code, comm.startIndex, comm.endIndex);
            qs.push({
                kind: "select.bindings",
                stem: "Which bindings capture the received value?",
                answerLabel: "",
                options: optionPool,
                questionType: "multi",
                multiCorrect: leftTexts,
                multiSelectHint: leftTexts.length,
                sourceRefs: [sourceRef],
                generatorRule: "select.bindings",
            });
        }
    }
    return qs;
};
const ruleReturnStatement = ({ root, node, code, sourceRef, profile }) => {
    const valueNode = (0, goCuration_1.firstChildOfType)(node, "expression_list");
    if (!valueNode)
        return [];
    const values = getExpressionListTexts(valueNode, code);
    if (values.length === 0)
        return [];
    const compositeQs = [];
    const composites = findCompositeLiteralConstructorNodes(valueNode, code);
    for (const ctor of composites) {
        compositeQs.push(...generateQuestionsV11(root, ctor, profile, code));
    }
    if (values.length === 1) {
        return [
            {
                kind: "return.value",
                stem: "What value is returned?",
                answerLabel: values[0],
                options: buildDistractors(values[0]),
                sourceRefs: [sourceRef],
                generatorRule: "return.value",
            },
            ...compositeQs,
        ];
    }
    const optionPool = buildMultiSelectOptionPool(values, code, node.startIndex, node.endIndex);
    return [
        {
            kind: "return.values",
            stem: "What values are returned?",
            answerLabel: "",
            options: optionPool,
            questionType: "multi",
            multiCorrect: values,
            multiSelectHint: values.length,
            sourceRefs: [sourceRef],
            generatorRule: "return.values",
        },
        ...compositeQs,
    ];
};
/**
 * Decompose a chain of selector/call expressions into individual segments.
 * For example: `a.foo().bar(x).baz` => ["a", "foo", "()", "bar", "(x)", "baz"]
 * Returns an array of { text, type, node } where type is 'base' | 'field' | 'call' | 'args'
 */
const decomposeChain = (node, code) => {
    const segments = [];
    const walk = (n) => {
        if (n.type === "call_expression") {
            // First process the function/operand part
            const funcNode = (0, goCuration_1.childByField)(n, "function") || (n.namedChildren || [])[0];
            if (funcNode)
                walk(funcNode);
            // Then add the arguments as a segment
            const argsNode = (0, goCuration_1.childByField)(n, "arguments");
            if (argsNode) {
                const argsText = (0, exports.textForRange)(argsNode.startIndex, argsNode.endIndex, code) || "()";
                segments.push({ text: argsText, segmentType: "args", node: argsNode });
            }
        }
        else if (n.type === "selector_expression") {
            // Process the operand first (left side)
            const operand = (0, goCuration_1.childByField)(n, "operand") || (n.namedChildren || [])[0];
            if (operand)
                walk(operand);
            // Then add the field (right side after the dot)
            const field = (0, goCuration_1.childByField)(n, "field") || (n.namedChildren || [])[1];
            if (field) {
                const fieldText = (0, exports.textForRange)(field.startIndex, field.endIndex, code) || field.type;
                segments.push({ text: fieldText, segmentType: "field", node: field });
            }
        }
        else {
            // Base case: identifier, literal, or other atomic expression
            const text = (0, exports.textForRange)(n.startIndex, n.endIndex, code) || n.type;
            segments.push({ text, segmentType: "base", node: n });
        }
    };
    walk(node);
    return segments;
};
const buildCallQuestions = (callNode, code, sourceRef, profile, stem) => {
    const qs = [];
    // SHALLOW MODE: Answer is the FULL call expression text as an MCQ
    if (profile === "shallow") {
        const fullCallText = (0, exports.textForRange)(callNode.startIndex, callNode.endIndex, code) || callNode.type;
        qs.push({
            kind: "call.full",
            stem,
            answerLabel: fullCallText,
            options: shuffle([fullCallText, ...buildDistractors(fullCallText)]),
            sourceRefs: [sourceRef],
            generatorRule: "call.full",
        });
        return qs;
    }
    // DEEP MODE: Decompose into chain segments, ask about each step
    const segments = decomposeChain(callNode, code);
    // If we have a simple call (e.g., foo(a, b)), just ask callee + args
    // If we have a chain (e.g., a.foo().bar(x) or a.b.c()), ask step-by-step
    const fieldCount = segments.reduce((count, seg) => count + (seg.segmentType === "field" ? 1 : 0), 0);
    const argsCount = segments.reduce((count, seg) => count + (seg.segmentType === "args" ? 1 : 0), 0);
    const hasChain = fieldCount > 1 || argsCount > 1;
    if (hasChain) {
        // Ask about each segment in order
        let stepNum = 1;
        for (const seg of segments) {
            if (seg.segmentType === "base") {
                qs.push({
                    kind: "call.chain.base",
                    stem: `Step ${stepNum}: What is the base/starting expression?`,
                    answerLabel: seg.text,
                    options: shuffle([seg.text, ...buildDistractors(seg.text)]),
                    sourceRefs: [sourceRef],
                    generatorRule: "call.chain.base",
                });
                stepNum++;
            }
            else if (seg.segmentType === "field") {
                qs.push({
                    kind: "call.chain.field",
                    stem: `Step ${stepNum}: What field/method is accessed next?`,
                    answerLabel: seg.text,
                    options: shuffle([seg.text, ...buildDistractors(seg.text)]),
                    sourceRefs: [sourceRef],
                    generatorRule: "call.chain.field",
                });
                stepNum++;
            }
            else if (seg.segmentType === "args") {
                // Extract individual arguments from the args node
                const argsChildren = seg.node.namedChildren || [];
                if (argsChildren.length > 0) {
                    const argTexts = argsChildren.map(a => (0, exports.textForRange)(a.startIndex, a.endIndex, code) || a.type);
                    const optionPool = buildMultiSelectOptionPool(argTexts, code, callNode.startIndex, callNode.endIndex);
                    qs.push({
                        kind: "call.chain.args",
                        stem: `Step ${stepNum}: Select the arguments in order`,
                        answerLabel: "",
                        options: optionPool,
                        optionPool,
                        questionType: "orderedMulti",
                        multiCorrect: argTexts,
                        multiSelectHint: argTexts.length,
                        sourceRefs: [sourceRef],
                        generatorRule: "call.chain.args",
                    });
                    stepNum++;
                }
            }
        }
    }
    else {
        // Simple call: callee + ordered args
        const callee = (0, goCuration_1.childByField)(callNode, "function") || (callNode.namedChildren || [])[0];
        if (callee) {
            const calleeText = (0, exports.textForRange)(callee.startIndex, callee.endIndex, code) || callee.type;
            qs.push({
                kind: "call.callee",
                stem,
                answerLabel: calleeText,
                options: shuffle([calleeText, ...buildDistractors(calleeText)]),
                sourceRefs: [sourceRef],
                generatorRule: "call.callee",
            });
        }
        // Arguments as orderedMulti
        const argsNode = (0, goCuration_1.childByField)(callNode, "arguments");
        const args = argsNode ? argsNode.namedChildren || [] : [];
        if (args.length > 0) {
            const argTexts = args.map(a => (0, exports.textForRange)(a.startIndex, a.endIndex, code) || a.type);
            const optionPool = buildMultiSelectOptionPool(argTexts, code, callNode.startIndex, callNode.endIndex);
            qs.push({
                kind: "call.args",
                stem: "Select the arguments in order",
                answerLabel: "",
                options: optionPool,
                optionPool,
                questionType: "orderedMulti",
                multiCorrect: argTexts,
                multiSelectHint: argTexts.length,
                sourceRefs: [sourceRef],
                generatorRule: "call.args",
            });
        }
    }
    return qs;
};
const ruleGoDeferStatement = ({ root, node, code, sourceRef, profile }) => {
    const expr = (node.namedChildren || [])[0];
    if (!expr)
        return [];
    let qs = [];
    if (expr.type === "call_expression") {
        qs = buildCallQuestions(expr, code, sourceRef, profile, "What function is invoked?");
    }
    else {
        const exprText = (0, exports.textForRange)(expr.startIndex, expr.endIndex, code) || expr.type;
        qs = [
            {
                kind: "go_defer.expr",
                stem: "What function is invoked?",
                answerLabel: exprText,
                options: buildDistractors(exprText),
                sourceRefs: [sourceRef],
                generatorRule: "go_defer.expr",
            },
        ];
    }
    const composites = findCompositeLiteralConstructorNodes(expr, code);
    for (const ctor of composites) {
        qs.push(...generateQuestionsV11(root, ctor, profile, code));
    }
    return qs;
};
const ruleBranchStatement = ({ node, code, sourceRef }) => {
    const keyword = node.type.replace("_statement", "");
    const qs = [
        {
            kind: "branch.keyword",
            stem: "Which branch keyword is used?",
            answerLabel: keyword,
            options: shuffle(["break", "continue", "goto", "fallthrough"]),
            sourceRefs: [sourceRef],
            generatorRule: "branch.keyword",
        },
    ];
    if (node.type === "break_statement" || node.type === "continue_statement" || node.type === "goto_statement") {
        const label = (0, goCuration_1.firstChildOfType)(node, "label_name") || (0, goCuration_1.firstChildOfType)(node, "identifier");
        if (label) {
            const text = (0, exports.textForRange)(label.startIndex, label.endIndex, code) || label.type;
            qs.push({
                kind: "branch.label",
                stem: "What label is targeted?",
                answerLabel: text,
                options: buildDistractors(text),
                sourceRefs: [sourceRef],
                generatorRule: "branch.label",
            });
        }
    }
    return qs;
};
const ruleExpressionStatement = ({ root, node, code, sourceRef, profile }) => {
    const expr = (node.namedChildren || [])[0];
    if (!expr)
        return [];
    if (expr.type !== "call_expression")
        return [];
    const qs = buildCallQuestions(expr, code, sourceRef, profile, "What function is called?");
    const composites = findCompositeLiteralConstructorNodes(expr, code);
    for (const ctor of composites) {
        qs.push(...generateQuestionsV11(root, ctor, profile, code));
    }
    return qs;
};
const rules = {
    package_clause: [rulePackageClause],
    function_declaration: [headerRule, ruleFunctionDecl],
    method_declaration: [headerRule, ruleMethodDecl],
    func_literal: [ruleFunctionDecl],
    unary_expression: [ruleUnaryExpression],
    composite_literal: [ruleCompositeLiteral],
    type_declaration: [ruleTypeDeclaration],
    const_declaration: [ruleConstVarDecl],
    var_declaration: [ruleConstVarDecl],
    short_var_declaration: [ruleShortVarDecl],
    assignment_statement: [ruleAssignment],
    inc_statement: [ruleIncDec],
    dec_statement: [ruleIncDec],
    if_statement: [headerRule, ruleIfStatement],
    for_statement: [headerRule, ruleForStatement],
    expression_switch_statement: [headerRule, ruleExpressionSwitch],
    type_switch_statement: [headerRule, ruleTypeSwitch],
    select_statement: [headerRule],
    expression_case: [headerRule, ruleExpressionCase],
    type_case: [headerRule, ruleTypeCase],
    communication_case: [headerRule, ruleCommunicationCase],
    default_case: [headerRule],
    return_statement: [ruleReturnStatement],
    go_statement: [ruleGoDeferStatement],
    defer_statement: [ruleGoDeferStatement],
    break_statement: [ruleBranchStatement],
    continue_statement: [ruleBranchStatement],
    goto_statement: [ruleBranchStatement],
    fallthrough_statement: [ruleBranchStatement],
    expression_statement: [ruleExpressionStatement],
};
function generateQuestionsV11(root, node, profile, code) {
    const src = {
        nodeType: node.type,
        start: node.startIndex,
        end: node.endIndex,
        path: (0, exports.computeAstPath)(root, node),
        preview: (0, exports.textForRange)(node.startIndex, node.endIndex, code)?.slice(0, 120),
    };
    const applyRules = rules[node.type] || [];
    const all = [];
    for (const rule of applyRules) {
        const qs = rule({ root, node, code, sourceRef: src, profile });
        if (qs && qs.length)
            all.push(...qs);
    }
    return all;
}
// ============================================================================
// Statement Anchors
// ============================================================================
const ANCHOR_NODE_TYPES = new Set([
    "package_clause",
    "import_declaration",
    "const_declaration",
    "var_declaration",
    "type_declaration",
    "function_declaration",
    "method_declaration",
    "short_var_declaration",
    "assignment_statement",
    "inc_statement",
    "dec_statement",
    "if_statement",
    "for_statement",
    "expression_switch_statement",
    "type_switch_statement",
    "select_statement",
    "expression_case",
    "type_case",
    "communication_case",
    "default_case",
    "return_statement",
    "go_statement",
    "defer_statement",
    "break_statement",
    "continue_statement",
    "goto_statement",
    "fallthrough_statement",
    "expression_statement",
]);
const isAnchorNode = (node) => {
    if (ANCHOR_NODE_TYPES.has(node.type))
        return true;
    return false;
};
exports.isAnchorNode = isAnchorNode;
const BODY_NODE_TYPES = new Set(["block"]);
const CASE_NODE_TYPES = new Set([
    "expression_case",
    "type_case",
    "communication_case",
    "default_case",
]);
const getStatementChildren = (node) => {
    if (CASE_NODE_TYPES.has(node.type)) {
        return (node.namedChildren || []).filter((c) => !["value", "type", "communication"].includes(c.fieldName || ""));
    }
    return (node.namedChildren || []).filter((c) => c.type !== "comment" && c.type !== "empty_statement");
};
const statementHasAnchor = (node) => {
    const stack = (node.namedChildren || []).slice();
    while (stack.length) {
        const cur = stack.pop();
        if (!cur)
            continue;
        if (BODY_NODE_TYPES.has(cur.type))
            continue;
        if ((0, exports.isAnchorNode)(cur))
            return true;
        if (cur.namedChildren && cur.namedChildren.length) {
            stack.push(...cur.namedChildren);
        }
    }
    return false;
};
const hasQuizChildren = (node) => {
    const stack = (node.namedChildren || []).slice();
    while (stack.length) {
        const cur = stack.pop();
        if (!cur)
            continue;
        if (BODY_NODE_TYPES.has(cur.type)) {
            const statements = getStatementChildren(cur);
            for (const stmt of statements) {
                if ((0, exports.isAnchorNode)(stmt) || statementHasAnchor(stmt))
                    return true;
            }
            continue;
        }
        if (cur.namedChildren && cur.namedChildren.length) {
            stack.push(...cur.namedChildren);
        }
    }
    return false;
};
const isHeaderQuestion = (q) => q.stem === "Write the full header line" || q.generatorRule === "header.line";
const spanForQuestion = (q) => {
    if (typeof q.revealEndBeforeChild === "number" &&
        typeof q.revealEndAfterChild === "number" &&
        Number.isFinite(q.revealEndBeforeChild) &&
        Number.isFinite(q.revealEndAfterChild)) {
        return { start: q.revealEndBeforeChild, end: q.revealEndAfterChild };
    }
    if (Array.isArray(q.sourceRefs) && q.sourceRefs.length > 0) {
        const ref = q.sourceRefs[0];
        if (Number.isFinite(ref.start) && Number.isFinite(ref.end)) {
            return { start: ref.start, end: ref.end };
        }
    }
    return undefined;
};
const applyQuestionOverlapGuard = (steps) => {
    const entries = [];
    const collect = (step) => {
        const qs = step.quiz?.questions || [];
        for (const q of qs) {
            const span = spanForQuestion(q);
            if (!span)
                continue;
            entries.push({
                question: q,
                span,
                isHeader: isHeaderQuestion(q),
            });
        }
        (step.lesson?.childSteps || []).forEach(collect);
    };
    steps.forEach(collect);
    const sorted = entries.slice().sort((a, b) => {
        const lenA = a.span.end - a.span.start;
        const lenB = b.span.end - b.span.start;
        if (lenA !== lenB)
            return lenA - lenB;
        if (a.span.start !== b.span.start)
            return a.span.start - b.span.start;
        return a.span.end - b.span.end;
    });
    const seenKeys = new Set();
    const kept = [];
    const drop = new Set();
    const makeDuplicateKey = (q) => {
        const span = spanForQuestion(q);
        return `${q.stem}::${q.answerLabel}::${span?.start}-${span?.end}`;
    };
    for (const entry of sorted) {
        const dupKey = makeDuplicateKey(entry.question);
        if (seenKeys.has(dupKey)) {
            drop.add(entry.question);
            continue;
        }
        if (!entry.isHeader && kept.length > 0) {
            const entryLen = entry.span.end - entry.span.start;
            const smallestKeptLen = kept[0].span.end - kept[0].span.start;
            if (entryLen > smallestKeptLen) {
                const containsKept = kept.some((k) => entry.span.start <= k.span.start &&
                    entry.span.end >= k.span.end &&
                    (entry.span.start < k.span.start || entry.span.end > k.span.end));
                if (containsKept) {
                    drop.add(entry.question);
                    continue;
                }
            }
        }
        seenKeys.add(dupKey);
        kept.push(entry);
    }
    const filter = (step) => {
        if (step.quiz?.questions?.length) {
            step.quiz.questions = step.quiz.questions.filter((q) => !drop.has(q));
            if (step.quiz.questions.length === 0)
                step.quiz = undefined;
        }
        const children = step.lesson?.childSteps || [];
        if (children.length)
            children.forEach(filter);
    };
    steps.forEach(filter);
};
const NO_FALLBACK_QUIZ_NODE_TYPES = new Set([
    "import_declaration",
    "function_declaration",
    "method_declaration",
    "type_declaration",
    "if_statement",
    "for_statement",
    "expression_switch_statement",
    "type_switch_statement",
    "select_statement",
    "expression_case",
    "type_case",
    "communication_case",
    "default_case",
]);
// ============================================================================
// Main Walker
// ============================================================================
const generateEngineSteps = (root, node, code, options) => {
    const steps = [];
    const mappedProfile = options.profile === "deep" ? "deep" : "shallow";
    const buildQuestionsForAnchor = (anchor) => {
        if (options.generateQuiz === false)
            return [];
        const ruleQuestions = generateQuestionsV11(root, anchor, mappedProfile, code);
        if (ruleQuestions.length)
            return ruleQuestions;
        if (NO_FALLBACK_QUIZ_NODE_TYPES.has(anchor.type))
            return [];
        if (hasQuizChildren(anchor))
            return [];
        const txt = (0, exports.textForNode)(anchor, code);
        return [
            {
                kind: "shallow_ident",
                stem: "What comes next?",
                answerLabel: txt,
                options: [],
                sourceRefs: [
                    {
                        nodeType: anchor.type,
                        start: anchor.startIndex,
                        end: anchor.endIndex,
                        path: (0, exports.computeAstPath)(root, anchor),
                        preview: txt.slice(0, 120),
                    },
                ],
                generatorRule: "shallow_statement",
            },
        ];
    };
    const buildLessonDataForAnchor = (anchor, hasChildStatements, hasQuestions) => {
        switch (anchor.type) {
            case "package_clause": {
                const name = (0, goCuration_1.getSectionFirstItem)(anchor, "name");
                const nameText = name ? (0, exports.textForNode)(name, code) : "package";
                return {
                    prompt: `We declare the package ${nameText}.`,
                    semanticRole: "package_clause",
                    isDigable: false,
                };
            }
            case "function_declaration": {
                const name = (0, goCuration_1.getSectionFirstItem)(anchor, "name");
                const nameText = name ? (0, exports.textForNode)(name, code) : "function";
                return {
                    prompt: `We define a function named: ${nameText}`,
                    semanticRole: "function_declaration",
                    isDigable: hasChildStatements,
                };
            }
            case "method_declaration": {
                const name = (0, goCuration_1.getSectionFirstItem)(anchor, "name");
                const nameText = name ? (0, exports.textForNode)(name, code) : "method";
                return {
                    prompt: `We define a method named: ${nameText}`,
                    semanticRole: "method_declaration",
                    isDigable: hasChildStatements,
                };
            }
            case "type_declaration": {
                return {
                    prompt: "We declare one or more types.",
                    semanticRole: "type_declaration",
                    isDigable: false,
                };
            }
            case "const_declaration": {
                return {
                    prompt: "We declare constants.",
                    semanticRole: "const_declaration",
                    isDigable: false,
                };
            }
            case "var_declaration": {
                return {
                    prompt: "We declare variables.",
                    semanticRole: "var_declaration",
                    isDigable: false,
                };
            }
            case "if_statement":
                return {
                    prompt: "An if statement checks a condition.",
                    semanticRole: "if_statement",
                    isDigable: hasChildStatements,
                };
            case "for_statement":
                return {
                    prompt: "A for loop repeats a block of code.",
                    semanticRole: "for_statement",
                    isDigable: hasChildStatements,
                };
            default: {
                const label = anchor.type.replace(/_/g, " ");
                if (hasQuestions) {
                    return {
                        prompt: `Analyze this ${label}.`,
                        semanticRole: anchor.type,
                        isDigable: hasChildStatements,
                    };
                }
                return {
                    prompt: `Next, we have a ${label}.`,
                    semanticRole: anchor.type,
                    isDigable: hasChildStatements,
                };
            }
        }
    };
    const emitAnchorStep = (anchor, hasChildStatements) => {
        const questions = buildQuestionsForAnchor(anchor);
        const lessonData = buildLessonDataForAnchor(anchor, hasChildStatements, questions.length > 0);
        if (lessonData || questions.length > 0) {
            steps.push({
                id: (0, utils_1.randomString)(8),
                node: anchor,
                displaySpan: displaySpanForNode(anchor),
                lesson: lessonData,
                quiz: questions.length > 0 ? { questions } : undefined,
            });
        }
    };
    const blockHasStatements = (block) => Boolean(block && getStatementChildren(block).some(exports.isAnchorNode));
    const caseHasStatements = (clause) => Boolean(clause && getStatementChildren(clause).some(exports.isAnchorNode));
    const walkModule = (mod) => {
        const children = getStatementChildren(mod);
        let i = 0;
        while (i < children.length) {
            const stmt = children[i];
            if (stmt.type === "import_declaration") {
                const { run, nextIndex } = collectImportRun(children, i);
                emitImportRunStep(run);
                i = nextIndex;
            }
            else if ((0, exports.isAnchorNode)(stmt)) {
                walkStmt(stmt);
                i++;
            }
            else {
                i++;
            }
        }
    };
    const walkBlock = (block) => {
        const children = getStatementChildren(block);
        let i = 0;
        while (i < children.length) {
            const stmt = children[i];
            if (stmt.type === "import_declaration") {
                const { run, nextIndex } = collectImportRun(children, i);
                emitImportRunStep(run);
                i = nextIndex;
            }
            else if ((0, exports.isAnchorNode)(stmt)) {
                walkStmt(stmt);
                i++;
            }
            else {
                i++;
            }
        }
    };
    const collectImportRun = (stmts, startIdx) => {
        const run = [];
        let i = startIdx;
        while (i < stmts.length && stmts[i].type === "import_declaration") {
            run.push(stmts[i]);
            i++;
        }
        return { run, nextIndex: i };
    };
    const emitImportRunStep = (run) => {
        if (!run.length)
            return;
        const first = run[0];
        const last = run[run.length - 1];
        const span = { start: first.startIndex, end: last.endIndex };
        const virtualNode = {
            ...first,
            type: "import_group",
            startIndex: span.start,
            endIndex: span.end,
            isVirtual: true,
        };
        const questions = options.generateQuiz !== false
            ? generateImportRunQuestions(root, run, code, mappedProfile)
            : [];
        const childSteps = run.map((importNode) => ({
            id: (0, utils_1.randomString)(8),
            node: importNode,
            displaySpan: { start: importNode.startIndex, end: importNode.endIndex },
            lesson: {
                semanticRole: importNode.type,
                prompt: "Import declaration.",
                isDigable: false,
            },
        }));
        const declCount = run.length;
        const lessonPrompt = declCount === 1
            ? "We import dependencies for this file."
            : `This block imports dependencies from ${declCount} import declaration(s).`;
        steps.push({
            id: (0, utils_1.randomString)(8),
            node: virtualNode,
            displaySpan: span,
            lesson: {
                semanticRole: "import_group",
                prompt: lessonPrompt,
                isDigable: childSteps.length > 0,
                childSteps,
            },
            quiz: questions.length > 0 ? { questions } : undefined,
        });
    };
    const walkStmt = (stmt) => {
        if (!(0, exports.isAnchorNode)(stmt))
            return;
        switch (stmt.type) {
            case "function_declaration":
            case "method_declaration": {
                const block = (0, goCuration_1.childByField)(stmt, "body") || (0, goCuration_1.firstChildOfType)(stmt, "block");
                const hasChildStatements = blockHasStatements(block);
                emitAnchorStep(stmt, hasChildStatements);
                if (block)
                    walkBlock(block);
                break;
            }
            case "if_statement": {
                const block = (0, goCuration_1.childByField)(stmt, "consequence") || (0, goCuration_1.firstChildOfType)(stmt, "block");
                const alt = (0, goCuration_1.childByField)(stmt, "alternative");
                const hasChildStatements = blockHasStatements(block) ||
                    (alt
                        ? alt.type === "block"
                            ? blockHasStatements(alt)
                            : statementHasAnchor(alt)
                        : false);
                emitAnchorStep(stmt, hasChildStatements);
                if (block)
                    walkBlock(block);
                if (alt) {
                    if (alt.type === "block")
                        walkBlock(alt);
                    else
                        walkStmt(alt);
                }
                break;
            }
            case "for_statement": {
                const block = (0, goCuration_1.childByField)(stmt, "body") || (0, goCuration_1.firstChildOfType)(stmt, "block");
                const hasChildStatements = blockHasStatements(block);
                emitAnchorStep(stmt, hasChildStatements);
                if (block)
                    walkBlock(block);
                break;
            }
            case "expression_switch_statement":
            case "type_switch_statement": {
                const cases = (stmt.namedChildren || []).filter((c) => CASE_NODE_TYPES.has(c.type));
                const hasChildStatements = cases.some((c) => caseHasStatements(c));
                emitAnchorStep(stmt, hasChildStatements);
                cases.forEach((c) => walkStmt(c));
                break;
            }
            case "select_statement": {
                const cases = (stmt.namedChildren || []).filter((c) => CASE_NODE_TYPES.has(c.type));
                const hasChildStatements = cases.some((c) => caseHasStatements(c));
                emitAnchorStep(stmt, hasChildStatements);
                cases.forEach((c) => walkStmt(c));
                break;
            }
            case "expression_case":
            case "type_case":
            case "communication_case":
            case "default_case": {
                const children = getStatementChildren(stmt);
                const hasChildStatements = children.some(exports.isAnchorNode);
                emitAnchorStep(stmt, hasChildStatements);
                children.forEach((c) => walkStmt(c));
                break;
            }
            default: {
                emitAnchorStep(stmt, false);
                break;
            }
        }
    };
    const finalizeSteps = (out) => {
        if (options.generateQuiz !== false)
            applyQuestionOverlapGuard(out);
        return out;
    };
    if (node.type === "source_file") {
        walkModule(node);
        return finalizeSteps(steps);
    }
    if (node.type === "block") {
        walkBlock(node);
        return finalizeSteps(steps);
    }
    walkStmt(node);
    return finalizeSteps(steps);
};
exports.generateEngineSteps = generateEngineSteps;
const headerMaskAndAnswer = (stmt, code) => {
    const { headerEnd } = (0, goCuration_1.getRevealAnchors)(stmt);
    const answerText = headerAnswer(stmt, code);
    const masks = headerEnd > stmt.startIndex
        ? [{ start: stmt.startIndex, end: headerEnd }]
        : [];
    return { masks, answerText };
};
function maskAndAnswerForStep(step, root, code) {
    if (step.node.isVirtual || step.node.type === "import_group") {
        return { masks: [], answerText: (0, exports.textForNode)(step.node, code) };
    }
    const headerTypes = [
        "function_declaration",
        "method_declaration",
        "if_statement",
        "for_statement",
        "expression_switch_statement",
        "type_switch_statement",
        "select_statement",
        "expression_case",
        "type_case",
        "communication_case",
        "default_case",
    ];
    const isHeaderNode = headerTypes.includes(step.node.type);
    if (isHeaderNode)
        return headerMaskAndAnswer(step.node, code);
    return { masks: [], answerText: (0, exports.textForNode)(step.node, code) };
}
function buildCustomQuizPayload(params) {
    const { fileKey, root, code, history, lessonQueue, currentStep } = params;
    const bestSourceRef = (q) => {
        if (!Array.isArray(q.sourceRefs) || q.sourceRefs.length === 0)
            return undefined;
        let best = q.sourceRefs[0];
        for (const ref of q.sourceRefs) {
            if (ref.end - ref.start < best.end - best.start)
                best = ref;
        }
        const preview = (0, exports.textForRange)(best.start, best.end, code)?.slice(0, 120);
        return preview ? { ...best, preview } : best;
    };
    const revealSpanForCard = (q, fallback) => {
        const start = typeof q.revealStart === "number" ? q.revealStart : fallback?.start;
        const end = typeof q.revealEndAfterChild === "number"
            ? q.revealEndAfterChild
            : typeof q.revealEndBeforeChild === "number"
                ? q.revealEndBeforeChild
                : fallback?.end;
        if (typeof start === "number" && typeof end === "number" && end >= start) {
            return { start, end };
        }
        return undefined;
    };
    const questionToCard = (step, q, order, action) => {
        const isOrderedMulti = q.questionType === "orderedMulti";
        const isMulti = isOrderedMulti ||
            q.questionType === "multi" ||
            (Array.isArray(q.multiCorrect) && q.multiCorrect.length > 0);
        const resolvedQuestionType = isOrderedMulti ? "orderedMulti" : "multi";
        const span = step.displaySpan ?? {
            start: step.node.startIndex,
            end: step.node.endIndex,
        };
        const snippet = code.slice(span.start, span.end).trimEnd();
        const baseRef = bestSourceRef(q);
        const revealSpan = revealSpanForCard(q, baseRef);
        const cardRef = baseRef && revealSpan
            ? {
                ...baseRef,
                start: revealSpan.start,
                end: revealSpan.end,
                preview: (0, exports.textForRange)(revealSpan.start, revealSpan.end, code)?.slice(0, 120),
            }
            : baseRef;
        return {
            order,
            type: q.kind,
            text: isMulti ? snippet : q.answerLabel,
            action,
            question: q.stem,
            semanticRole: step.lesson?.semanticRole,
            generatorRule: q.generatorRule,
            difficulty: q.difficulty,
            questionType: isMulti ? resolvedQuestionType : undefined,
            multiCorrect: q.multiCorrect,
            multiSelectHint: q.multiSelectHint,
            optionPool: q.optionPool,
            sourceRef: cardRef,
            revealStart: q.revealStart,
            revealEndBeforeChild: q.revealEndBeforeChild,
            revealEndAfterChild: q.revealEndAfterChild,
            distractorPoolSize: q.distractorPoolSize,
        };
    };
    const cards = [];
    let order = 0;
    const appendStepCards = (step, action) => {
        const questions = step.quiz?.questions || [];
        for (const q of questions) {
            cards.push(questionToCard(step, q, order++, action));
        }
        const children = step.lesson?.childSteps || [];
        for (const child of children)
            appendStepCards(child, action);
    };
    const filteredHistory = history.filter((h) => h.action !== "dig");
    for (const step of filteredHistory) {
        appendStepCards(step, step.action ?? "next");
    }
    for (const step of lessonQueue.slice(currentStep)) {
        appendStepCards(step, "next");
    }
    return {
        fileKey,
        name: `Custom quiz ${new Date().toLocaleString()}`,
        type: "CustomQuizV1.1",
        profile: "shallow",
        rootNode: {
            type: root.type,
            text: (0, exports.textForNode)(root, code),
            start: root.startIndex,
            end: root.endIndex,
            path: [],
        },
        cards,
    };
}
