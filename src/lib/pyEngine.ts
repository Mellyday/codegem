import type { TreeSitterAstNode } from "./treeSitter";
import {
  isDocstringNode,
  childrenOfType,
  firstChildOfType,
  childByField,
  buildCuratedSections,
} from "./pyCuration";
import { randomString } from "./utils";

// ============================================================================
// Types
// ============================================================================

export type EngineOptions = {
    profile: "shallow" | "deep";
    grouping: "auto" | boolean;
    includeNames?: boolean;
    // Internal recursion guard
    __noGroup?: boolean;
};

export type QuizQuestion = {
    kind: string;
    stem: string;
    answerLabel: string;
    options: string[];
    sourceRefs: SourceRef[];
    generatorRule: string;
    questionType?: "single" | "multi";
    multiCorrect?: string[];
    revealStart?: number;
    revealEndBeforeChild?: number;
    revealEndAfterChild?: number;
};

export type SourceRef = {
    nodeType: string;
    start: number;
    end: number;
    path: number[];
    preview?: string;
};

export type EngineStep = {
    id: string;
    node: TreeSitterAstNode & { isVirtual?: boolean };

    // Lesson Data
    lesson?: {
        prompt: string;
        semanticRole: string;
        isDigable: boolean;
        childSteps?: EngineStep[];
    };

    // Quiz Data
    quiz?: {
        questions: QuizQuestion[];
    };
};

// ============================================================================
// Helpers (Consolidated)
// ============================================================================

export const textForNode = (node: TreeSitterAstNode, code: string): string => {
    return code.substring(node.startIndex, node.endIndex);
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
    )
        return code.slice(start, end);
    return undefined;
};

export const computeAstPath = (
  root: TreeSitterAstNode,
  target: TreeSitterAstNode
): number[] => {
    const path: number[] = [];
    let found = false;
    const dfs = (n: TreeSitterAstNode, cur: number[]) => {
        if (found) return;
        if (
            n.startIndex === target.startIndex &&
            n.endIndex === target.endIndex &&
            n.type === target.type
        ) {
            path.push(...cur);
            found = true;
            return;
        }
        (n.namedChildren || []).forEach((c, idx) => dfs(c, cur.concat(idx)));
    };
    dfs(root, []);
    return path;
};

const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
  return a;
};

// Global lightweight distractor pool for padding option lists
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
  "error",
  "response",
  "request",
  "config",
  "settings",
];

// ============================================================================
// Deep Drill Logic (Replaces legacy quizRules)
// ============================================================================

type DrillPart = {
    node: TreeSitterAstNode;
    role: string; // "target", "value", "arg", "method", etc.
    context: string; // "assignment", "function_call", etc.
};

function drillDown(node: TreeSitterAstNode, context: string = ""): DrillPart[] {
    const parts: DrillPart[] = [];

    if (node.type === "assignment") {
        // 1. Capture the top-level assignment for Shallow mode
        parts.push({ node, role: "statement", context: "assignment" });

        // 2. Recurse for Deep mode
        const children = node.namedChildren || [];
        const left = childByField(node, "left") || children[0];
        const right = childByField(node, "right") || children[children.length - 1];

        if (left) parts.push(...drillDown(left, "assignment_target"));
        if (right) parts.push(...drillDown(right, "assignment_value"));
    } else if (node.type === "call") {
        const children = node.namedChildren || [];
        const func = childByField(node, "function") || children[0];
        const args =
            childByField(node, "arguments") ||
            children.find((c) => c.type === "argument_list");

        if (func) parts.push(...drillDown(func, "function_call"));

        // Handle arguments
        if (args) {
            (args.namedChildren || []).forEach((arg, i) => {
                parts.push(...drillDown(arg, `argument_${i}`));
            });
        }
    } else if (node.type === "attribute") {
        // duck.sound -> drill 'duck', capture 'sound'
        const children = node.namedChildren || [];
        const obj = childByField(node, "object") || children[0];
        const attr = childByField(node, "attribute") || children[1];

        if (obj) parts.push(...drillDown(obj, "object_access"));
        if (attr)
            parts.push({ node: attr, role: "property", context: "attribute" });
    } else if (node.type === "binary_operator") {
        const children = node.namedChildren || [];
        const left = childByField(node, "left") || children[0];
        const right = childByField(node, "right") || children[children.length - 1];
        if (left) parts.push(...drillDown(left, "binary_left"));
        if (right) parts.push(...drillDown(right, "binary_right"));
    } else if (node.type === "subscript") {
        const children = node.namedChildren || [];
        const value = childByField(node, "value") || children[0];
        const subscript = childByField(node, "subscript") || children[1];
        if (value) parts.push(...drillDown(value, "subscript_base"));
        if (subscript) parts.push(...drillDown(subscript, "subscript_index"));
    } else if (node.type === "dictionary") {
        for (const child of node.namedChildren || []) {
            if (child.type === "pair") {
                const k = child.namedChildren[0];
                const v = child.namedChildren[1];
                if (k) parts.push(...drillDown(k, "dict_key"));
                if (v) parts.push(...drillDown(v, "dict_value"));
            }
        }
    } else if (
        node.type === "list" ||
        node.type === "tuple" ||
        node.type === "set"
    ) {
        (node.namedChildren || []).forEach((child, i) => {
            parts.push(...drillDown(child, `${node.type}_item_${i}`));
        });
    } else if (node.type === "identifier" || node.type === "string" || node.type === "integer" || node.type === "float") {
        // The leaf node (expanded to include numbers)
        parts.push({ node, role: "leaf", context });
    }

    return parts;
}

// ============================================================================
// Grouping Logic (Ported from pyLesson.ts)
// ============================================================================

type PyCategory =
    | "import"
    | "definition"
    | "type"
    | "constants"
    | "configuration"
    | "main"
    | "logic";

function getSemanticCategory(node: TreeSitterAstNode): PyCategory {
    switch (node.type) {
        case "import_statement":
        case "import_from_statement":
            return "import";
        case "type_alias_statement":
        case "type_alias":
            return "type";
        case "class_definition":
        case "function_definition":
        case "decorated_definition":
            return "definition";
        case "if_statement":
            return "logic";
        default:
            return "logic";
    }
}

function generateGroupPrompt(category: PyCategory, count: number): string {
    switch (category) {
        case "import":
            return `This file starts with ${count} import statement(s).`;
        case "definition":
            return `Next, we have a block of ${count} definition(s).`;
        case "type":
            return `There are ${count} type definition(s).`;
        case "constants":
            return `A block of ${count} constant definition(s).`;
        case "configuration":
            return `A configuration block with ${count} statement(s).`;
        case "main":
            return `This is the main execution block.`;
        case "logic":
        default:
            return `Here is a block of application logic consisting of ${count} statement(s).`;
    }
}

function createGroupStep(
    root: TreeSitterAstNode,
    nodes: TreeSitterAstNode[],
    category: PyCategory,
    code: string,
    options: EngineOptions
): EngineStep {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const virtualNode = {
        ...first,
        type: "group",
        startIndex: first.startIndex,
        endIndex: last.endIndex,
        isVirtual: true,
    };

    // Recursively generate steps for children, but disable further grouping
    const childSteps = nodes.flatMap((n) =>
        generateEngineSteps(root, n, code, { ...options, __noGroup: true })
    );

    return {
        id: randomString(8),
        node: virtualNode,
        lesson: {
            semanticRole: `group:${category}`,
            prompt: generateGroupPrompt(category, nodes.length),
            isDigable: childSteps.length > 0,
            childSteps,
        },
    };
}

function groupTopLevelNodes(
    root: TreeSitterAstNode,
    topLevelNodes: TreeSitterAstNode[],
    code: string,
    options: EngineOptions
): EngineStep[] {
    if (!topLevelNodes.length) return [];
    const out: EngineStep[] = [];
    let currentCategory: PyCategory | null = null;
    let currentGroup: TreeSitterAstNode[] = [];

    for (const n of topLevelNodes) {
        const cat = getSemanticCategory(n);
        if (currentCategory && cat === currentCategory) {
            currentGroup.push(n);
        } else {
            if (currentGroup.length) {
                out.push(createGroupStep(root, currentGroup, currentCategory!, code, options));
            }
            currentCategory = cat;
            currentGroup = [n];
        }
    }
    if (currentGroup.length) {
        out.push(createGroupStep(root, currentGroup, currentCategory!, code, options));
    }
    return out;
}

// ============================================================================
// Main Walker
// ============================================================================

export const generateEngineSteps = (
    root: TreeSitterAstNode, // Root of the entire file (for context)
    node: TreeSitterAstNode, // Current node to process
    code: string,
    options: EngineOptions
): EngineStep[] => {
    const steps: EngineStep[] = [];
    const children = (node.namedChildren || []).filter(
        (c) => c.type !== "comment" && !isDocstringNode(c, node)
    );

    // 1. Check for Grouping (Module Level)
    if (node.type === "module" && !options.__noGroup) {
        const enableGrouping = options.grouping === "auto"
            ? (children.length >= 12 || code.length >= 5000)
            : options.grouping;

        if (enableGrouping) {
            return groupTopLevelNodes(root, children, code, options);
        }
    }

    // 2. Generate Quiz Questions
    const questions: QuizQuestion[] = [];

    // If Profile is DEEP, we drill down. If SHALLOW, we only look at the node itself.
    if (options.profile === "deep") {
        const parts = drillDown(node);

        // Filter out the node itself so we don't duplicate the shallow question
        const deepParts = parts.filter(
            (p) => p.node.startIndex !== node.startIndex
        );

        for (const part of deepParts) {
            const txt = textForNode(part.node, code);
            questions.push({
                kind: "deep_drill",
                stem: `What is the ${part.role}?`, // e.g. "What is the assignment_target?"
                answerLabel: txt,
                options: [], // EMPTY options -> Signal to UI to ask LLM
                sourceRefs: [
                    {
                        nodeType: part.node.type,
                        start: part.node.startIndex,
                        end: part.node.endIndex,
                        path: computeAstPath(root, part.node),
                    },
                ],
                generatorRule: "drill_down_generic",
            });
        }
    } else {
        // Shallow: Just ask about this specific node
        const txt = textForNode(node, code);
        questions.push({
            kind: "shallow_ident",
            stem: "What is this code block?",
            answerLabel: txt,
            options: [], // Signal to UI to ask LLM for syntax variations
            sourceRefs: [
                {
                    nodeType: node.type,
                    start: node.startIndex,
                    end: node.endIndex,
                    path: computeAstPath(root, node),
                },
            ],
            generatorRule: "shallow_statement",
        });
    }

    // 3. Generate Lesson Step (if applicable)
    //    We default to creating a step for every node visited, unless it's purely structural
    //    or handled by a parent's custom logic.

    let lessonData: EngineStep["lesson"] | undefined;
    let recurse = true;

    switch (node.type) {
        case "module":
            // Module itself doesn't get a step, just yields children
            break;

        case "class_definition": {
            const name = firstChildOfType(node, "identifier");
            const nameText = name ? textForNode(name, code) : "class";
            lessonData = {
                prompt: `We define a class named: ${nameText}`,
                semanticRole: "class_definition",
                isDigable: true,
            };
            break;
        }

        case "function_definition": {
            const name = firstChildOfType(node, "identifier");
            const nameText = name ? textForNode(name, code) : "function";
            lessonData = {
                prompt: `We define a function named: ${nameText}`,
                semanticRole: "function_definition",
                isDigable: true,
            };
            break;
        }

        case "if_statement": {
            lessonData = {
                prompt: "An if statement checks a condition.",
                semanticRole: "if_statement",
                isDigable: true,
            };
            break;
        }

        case "while_statement": {
            lessonData = {
                prompt: "A while loop runs as long as the condition is true.",
                semanticRole: "while_statement",
                isDigable: true,
            };
            break;
        }

        case "for_statement": {
            lessonData = {
                prompt: "A for loop iterates over a sequence.",
                semanticRole: "for_statement",
                isDigable: true,
            };
            break;
        }

        case "assignment": {
            lessonData = {
                prompt: "An assignment statement stores a value.",
                semanticRole: "assignment",
                isDigable: false, // Usually leaf in lesson view, but quiz digs in
            };
            // For assignments, we might not want to recurse in the *lesson* flow 
            // if we treat it as atomic, but for *quiz* generation we might want to 
            // visit children if we had questions for them. 
            // However, current pyQuiz logic handles assignment children inside the assignment rule.
            break;
        }

        default: {
            // Generic fallback
            if (questions.length > 0) {
                // If it has questions, it's interesting enough to be a step
                lessonData = {
                    prompt: `Analyze this ${node.type}.`,
                    semanticRole: node.type,
                    isDigable: children.length > 0,
                };
            } else if (node.type.endsWith("_statement") || node.type === "expression_statement") {
                lessonData = {
                    prompt: `Next, we have a ${node.type.replace("_statement", "")} statement.`,
                    semanticRole: node.type,
                    isDigable: children.length > 0,
                };
            }
            break;
        }
    }

    // 4. Construct the Step
    if (lessonData || questions.length > 0) {
        const step: EngineStep = {
            id: randomString(8),
            node,
            lesson: lessonData,
            quiz: questions.length > 0 ? { questions } : undefined,
        };
        steps.push(step);
    }

    // 5. Recurse
    if (recurse) {
        children.forEach((child) => {
            // Pass root down
            steps.push(...generateEngineSteps(root, child, code, options));
        });
    }

    return steps;
};

// ============================================================================
// Masking & Payload Helpers (Ported from pyLesson.ts / pyQuiz.ts)
// ============================================================================

export type MaskRange = { start: number; end: number };

function findEnclosingByTypes(
    root: TreeSitterAstNode,
    target: TreeSitterAstNode,
    types: string[]
): TreeSitterAstNode | undefined {
    let found: TreeSitterAstNode | undefined;
    const walk = (n: TreeSitterAstNode) => {
        const kids = n.namedChildren || [];
        for (const c of kids) {
            if (c.startIndex <= target.startIndex && c.endIndex >= target.endIndex) {
                if (types.includes(c.type)) found = c;
                walk(c);
            }
        }
    };
    walk(root);
    return found;
}

function headerMaskAndAnswer(
    stmt: TreeSitterAstNode,
    code: string
): { masks: MaskRange[]; answerText: string } {
    const nonStructural = new Set([
        "block",
        "else_clause",
        "elif_clause",
        "finally_clause",
        "except_clause",
    ]);
    const firstNamed = (stmt.namedChildren || []).find(
        (c) => !nonStructural.has(c.type)
    );
    const maskStart = stmt.startIndex;
    const maskEnd = firstNamed ? firstNamed.startIndex : stmt.startIndex;

    const full = code.substring(stmt.startIndex, stmt.endIndex);
    const colonIdx = full.indexOf(":");
    const answerText = (
        colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]
    ).trimEnd();

    const masks = maskEnd > maskStart ? [{ start: maskStart, end: maskEnd }] : [];
    return { masks, answerText };
}

export function maskAndAnswerForStep(
    step: EngineStep,
    root: TreeSitterAstNode,
    code: string
): { masks: MaskRange[]; answerText: string } {
    if ((step.node as any).isVirtual || step.node.type === "group") {
        return { masks: [], answerText: textForNode(step.node, code) };
    }
    const headerTypes = [
        "if_statement",
        "elif_clause",
        "while_statement",
        "for_statement",
    ];
    const role = step.lesson?.semanticRole;
    const isHeaderNode = headerTypes.includes(step.node.type);

    if (role === "if_condition" || role === "loop_condition" || isHeaderNode) {
        const stmt = isHeaderNode
            ? step.node
            : findEnclosingByTypes(root, step.node, headerTypes);
        if (stmt) {
            return headerMaskAndAnswer(stmt, code);
        }
    }
    return { masks: [], answerText: textForNode(step.node, code) };
}

export type LessonHistoryItem = EngineStep & { action?: "next" | "dig" };

export function buildCustomQuizPayload(params: {
    fileKey?: { kind: "repo" | "project"; id: string; path: string };
    root: TreeSitterAstNode;
    code: string;
    history: LessonHistoryItem[];
    lessonQueue: EngineStep[];
    currentStep: number;
}) {
    const { fileKey, root, code, history, lessonQueue, currentStep } = params;

    const stepToCard = (
        step: EngineStep,
        order: number,
        source: "visited" | "pending",
        action: "next" | "dig" = "next"
    ) => {
        let question = `What is this ${step.node.type}?`;
        if (step.lesson?.semanticRole === "return_type") {
            question = "What is the return type of this function?";
        } else if (
            step.lesson?.semanticRole === "loop_condition" ||
            step.lesson?.semanticRole === "if_condition"
        ) {
            question = "Write the full header line";
        }

        const { masks, answerText } = maskAndAnswerForStep(step, root, code);

        // Compute progressive reveal anchors for this step.
        // Default: reveal nothing of this node before the question,
        // then reveal the full node after it is answered.
        const revealStart = step.node.startIndex;
        let revealEndBeforeChild: number | undefined = step.node.startIndex;
        let revealEndAfterChild: number | undefined = step.node.endIndex;

        // For header-like nodes (if/elif/while/for headers), maskAndAnswerForStep
        // returns a prefix mask. Show that prefix before asking, then reveal the rest.
        if (masks.length > 0) {
            revealEndBeforeChild = masks[0].end;
            revealEndAfterChild = step.node.endIndex;
        }

        const sourceRef = {
            nodeType: step.node.type,
            start: step.node.startIndex,
            end: step.node.endIndex,
            path: computeAstPath(root, step.node),
            preview: textForNode(step.node, code).slice(0, 120),
        };
        return {
            order,
            type: step.node.type,
            text: answerText,
            action,
            semanticRole: step.lesson?.semanticRole,
            question,
            sourceRef,
            source,
            revealStart,
            revealEndBeforeChild,
            revealEndAfterChild,
        };
    };

    const filteredHistory = history.filter((h) => h.action !== "dig");
    const visitedCards = filteredHistory.map((step, idx) =>
        stepToCard(step, idx, "visited", step.action ?? "next")
    );
    const pendingCards = lessonQueue
        .slice(currentStep)
        .map((step, i) => stepToCard(step, filteredHistory.length + i, "pending"));

    const cards = [...visitedCards, ...pendingCards];

    return {
        fileKey,
        name: `Custom quiz ${new Date().toLocaleString()}`,
        type: "CustomQuizV1.1" as const,
        profile: "normal" as const,
        rootNode: {
            type: root.type,
            text: textForNode(root, code),
            start: root.startIndex,
            end: root.endIndex,
            path: [] as number[],
        },
        cards: cards.map((c) => ({
            order: c.order,
            type: c.type,
            text: c.text,
            action: c.action,
            question: c.question,
            semanticRole: c.semanticRole,
            sourceRef: (c as any).sourceRef,
            // progressive reveal anchors used by QuizViewer for custom quizzes
            revealStart: (c as any).revealStart,
            revealEndBeforeChild: (c as any).revealEndBeforeChild,
            revealEndAfterChild: (c as any).revealEndAfterChild,
        })),
    };
}

function headerAnswer(stmt: TreeSitterAstNode, code: string): string {
  const full = code.substring(stmt.startIndex, stmt.endIndex);
  const colonIdx = full.indexOf(":");
  return (
    colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]
  ).trimEnd();
}

export function buildHeuristicQuiz(
  root: TreeSitterAstNode,
  code: string,
  profile: "shallow" | "deep",
  opts?: { maxDeepPerStmt?: number; maxQuestions?: number }
): {
  id: string;
  kind: "custom-quiz";
  createdAt: string;
  typeLabel?: string;
  profile?: "shallow" | "normal" | "deep";
  root: { type: string; start?: number; end?: number };
  totalCards: number;
  cards: Array<{
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    sourceRef?: {
      nodeType: string;
      start: number;
      end: number;
      path: number[];
      preview?: string;
    };
    semanticRole?: string;
    question?: string;
    generatorRule?: string;
    difficulty?: "easy" | "medium" | "hard";
    // optional progressive reveal anchors
    revealEndBeforeChild?: number;
    revealEndAfterChild?: number;
  }>;
} {
  if (profile === "deep") {
    throw new Error("pyEngine.buildHeuristicQuiz: deep profile not implemented");
  }

  const cards: Array<{
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    sourceRef?: {
      nodeType: string;
      start: number;
      end: number;
      path: number[];
      preview?: string;
    };
    semanticRole?: string;
    question?: string;
    generatorRule?: string;
    difficulty?: "easy" | "medium" | "hard";
    revealEndBeforeChild?: number;
    revealEndAfterChild?: number;
  }> = [];
  let order = 0;

  const emitCard = (
    text: string,
    q: string,
    node: TreeSitterAstNode,
    kind?: string,
    semanticRole?: string
  ) => {
    cards.push({
      order: order++,
      type: kind || node.type,
      text,
      action: "next",
      question: q,
      semanticRole,
      sourceRef: {
        nodeType: node.type,
        start: node.startIndex,
        end: node.endIndex,
        path: computeAstPath(root, node),
        preview: code.slice(node.startIndex, node.endIndex).slice(0, 120),
      },
      // progressive reveal anchors for line-by-line shallow/normal quizzes
      revealEndBeforeChild: node.startIndex,
      revealEndAfterChild: node.endIndex,
    });
  };

  const makeIdentifierPool = (spanStart: number, spanEnd: number): string[] => {
    const snippet = code.slice(spanStart, spanEnd);
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(snippet))) out.add(m[0]);
    return Array.from(out);
  };

  const makeStringPool = (spanStart: number, spanEnd: number): string[] => {
    const snippet = code.slice(spanStart, spanEnd);
    const re = /(['"])((?:\\.|(?!\1).)*)\1/g;
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(snippet))) {
      const s = m[2];
      if (s.trim().length > 0) out.add(s);
    }
    return Array.from(out);
  };

  const emitHeader = (stmt: TreeSitterAstNode) => {
    const answerText = headerAnswer(stmt, code);
    emitCard(
      answerText,
      "Write the full header line",
      stmt,
      stmt.type,
      "header"
    );
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    const kids = (block.namedChildren || []).filter(
      (c) => c.type !== "comment" && !isDocstringNode(c, block)
    );
    for (const stmt of kids) walkStmt(stmt);
  };

  const walkStmt = (node: TreeSitterAstNode) => {
    switch (node.type) {
      case "import_from_statement": {
        const groups = buildCuratedSections(node);
        const moduleGroup = groups.find((g) => g.key === "module");
        if (moduleGroup?.items?.[0]) {
          const mod = moduleGroup.items[0];
          const modTxt = code.slice(mod.startIndex, mod.endIndex);
          emitCard(modTxt, "What is the module?", mod, "module");
        }
        const namesGroup = groups.find((g) => g.key === "names");
        const items = namesGroup?.items || [];
        const correct = items
          .map((n) => code.slice(n.startIndex, n.endIndex))
          .filter(Boolean);
        // Build padded option pool (always up to 10)
        const idPool = makeIdentifierPool(
          root.startIndex,
          root.endIndex
        ).filter((s) => !correct.includes(s));
        let pool = Array.from(new Set<string>([...correct, ...idPool]));
        if (pool.length < 10) {
          const needed = 10 - pool.length;
          const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => !pool.includes(d))
            .slice(0, needed);
          pool.push(...pad);
        }
        const MAX = 10;
        const extras = shuffle(pool.filter((p) => !correct.includes(p)));
        const optionPool = shuffle([
          ...correct,
          ...extras.slice(0, Math.max(0, MAX - correct.length)),
        ]).slice(0, MAX);
        const snippet = code.slice(node.startIndex, node.endIndex);
        // Reveal anchors for import-from: show header up to first imported name, then reveal through last name
        const firstStart = items.length
          ? items.reduce((m, it) => Math.min(m, it.startIndex), items[0].startIndex)
          : undefined;
        const lastEnd = items.length
          ? items.reduce((m, it) => Math.max(m, it.endIndex), items[0].endIndex)
          : undefined;
        cards.push({
          order: order++,
          type: "imported_names_multi",
          text: snippet,
          action: "next",
          question: `Which names are imported?`,
          generatorRule: "import_from.names",
          sourceRef: {
            nodeType: node.type,
            start: node.startIndex,
            end: node.endIndex,
            path: computeAstPath(root, node),
            preview: snippet.slice(0, 120),
          },
          questionType: "multi",
          multiCorrect: correct,
          optionPool,
          // progressive reveal anchors
          revealStart: node.startIndex,
          revealEndBeforeChild: firstStart,
          revealEndAfterChild: lastEnd,
        } as any);
        break;
      }
      case "import_statement": {
        const groups = buildCuratedSections(node);
        const namesGroup = groups.find((g) => g.key === "names");
        const items = namesGroup?.items || [];
        const correct = items
          .map((n) => code.slice(n.startIndex, n.endIndex))
          .filter(Boolean);
        const idPool = makeIdentifierPool(
          root.startIndex,
          root.endIndex
        ).filter((s) => !correct.includes(s));
        let pool = Array.from(new Set<string>([...correct, ...idPool]));
        if (pool.length < 10) {
          const needed = 10 - pool.length;
          const pad = shuffle(GENERIC_DISTRACTORS)
            .filter((d) => !pool.includes(d))
            .slice(0, needed);
          pool.push(...pad);
        }
        const MAX = 10;
        const extras = shuffle(pool.filter((p) => !correct.includes(p)));
        const optionPool = shuffle([
          ...correct,
          ...extras.slice(0, Math.max(0, MAX - correct.length)),
        ]).slice(0, MAX);
        const snippet = code.slice(node.startIndex, node.endIndex);
        const namesGroup2 = groups.find((g) => g.key === "names");
        const items2 = namesGroup2?.items || [];
        const firstStart2 = items2.length
          ? items2.reduce((m, it) => Math.min(m, it.startIndex), items2[0].startIndex)
          : undefined;
        const lastEnd2 = items2.length
          ? items2.reduce((m, it) => Math.max(m, it.endIndex), items2[0].endIndex)
          : undefined;
        cards.push({
          order: order++,
          type: "imported_names_multi",
          text: snippet,
          action: "next",
          question: `Which names are imported?`,
          generatorRule: "import.names",
          sourceRef: {
            nodeType: node.type,
            start: node.startIndex,
            end: node.endIndex,
            path: computeAstPath(root, node),
            preview: snippet.slice(0, 120),
          },
          questionType: "multi",
          multiCorrect: correct,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: firstStart2,
          revealEndAfterChild: lastEnd2,
        } as any);
        break;
      }
      case "function_definition": {
        const sections = buildCuratedSections(node);
        const argsGroup = sections.find((s) => s.key === "args");
        const returnsGroup = sections.find((s) => s.key === "returns");

        if (argsGroup) {
          const params = argsGroup.items || [];
          const names: string[] = [];
          for (const p of params) {
            const nameNode = (p.namedChildren || []).find(
              (c) => c.type === "identifier"
            );
            if (nameNode)
              names.push(code.slice(nameNode.startIndex, nameNode.endIndex));
            else names.push(code.slice(p.startIndex, p.endIndex));
          }
          const block = firstChildOfType(node, "block");
          const spanStart = block ? block.startIndex : node.startIndex;
          const spanEnd = block ? block.endIndex : node.endIndex;
          const idPool = makeIdentifierPool(spanStart, spanEnd).filter(
            (s) => !names.includes(s)
          );
          let pool = Array.from(new Set<string>([...names, ...idPool]));
          if (pool.length < 10) {
            const needed = 10 - pool.length;
            const pad = shuffle(GENERIC_DISTRACTORS)
              .filter((d) => !pool.includes(d))
              .slice(0, needed);
            pool.push(...pad);
          }
          const MAX = 10;
          const extras = shuffle(pool.filter((p) => !names.includes(p)));
          const optionPool = shuffle([
            ...names,
            ...extras.slice(0, Math.max(0, MAX - names.length)),
          ]).slice(0, MAX);
          const header = headerAnswer(node, code);
          // Reveal anchors for params: prefix through first param, then through last param
          const firstParamStart = params.length
            ? params.reduce((m, it) => Math.min(m, it.startIndex), params[0].startIndex)
            : undefined;
          const lastParamEnd = params.length
            ? params.reduce((m, it) => Math.max(m, it.endIndex), params[0].endIndex)
            : undefined;
          cards.push({
            order: order++,
            type: "function_params_multi",
            text: header,
            action: "next",
            question: `Which of the following are parameters of this function?`,
            generatorRule: "func.params-multi",
            sourceRef: {
              nodeType: node.type,
              start: node.startIndex,
              end: node.endIndex,
              path: computeAstPath(root, node),
              preview: code
                .slice(node.startIndex, node.endIndex)
                .slice(0, 120),
            },
            questionType: "multi",
            multiCorrect: names,
            optionPool,
            revealStart: node.startIndex,
            revealEndBeforeChild: firstParamStart,
            revealEndAfterChild: lastParamEnd,
          } as any);
        }
        if (returnsGroup) {
          for (let i = 0; i < returnsGroup.items.length; i++) {
            const item = returnsGroup.items[i];
            const text = code.substring(item.startIndex, item.endIndex);
            emitCard(
              text,
              "What is the return type?",
              item,
              item.type,
              "returns"
            );
          }
        }
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        break;
      }
      case "class_definition": {
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        break;
      }
      case "while_statement":
      case "for_statement": {
        emitHeader(node);
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        const elseCl = firstChildOfType(node, "else_clause");
        if (elseCl) {
          emitHeader(elseCl);
          const eb = firstChildOfType(elseCl, "block");
          if (eb) walkBlock(eb);
        }
        break;
      }
      case "if_statement": {
        emitHeader(node);
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        for (const e of childrenOfType(node, "elif_clause")) {
          emitHeader(e);
          const b = firstChildOfType(e, "block");
          if (b) walkBlock(b);
        }
        const elseCl = firstChildOfType(node, "else_clause");
        if (elseCl) {
          emitHeader(elseCl);
          const eb = firstChildOfType(elseCl, "block");
          if (eb) walkBlock(eb);
        }
        break;
      }
      case "with_statement": {
        emitHeader(node);
        const block = firstChildOfType(node, "block");
        if (block) walkBlock(block);
        break;
      }
      case "try_statement": {
        emitHeader(node);
        const body = firstChildOfType(node, "block");
        if (body) walkBlock(body);
        for (const h of (node.namedChildren || []).filter((c) =>
          c.type.includes("except")
        )) {
          emitHeader(h);
          const b = firstChildOfType(h, "block");
          if (b) walkBlock(b);
        }
        const elseCl = firstChildOfType(node, "else_clause");
        if (elseCl) {
          emitHeader(elseCl);
          const eb = firstChildOfType(elseCl, "block");
          if (eb) walkBlock(eb);
        }
        const finCl = firstChildOfType(node, "finally_clause");
        if (finCl) {
          emitHeader(finCl);
          const fb = firstChildOfType(finCl, "block");
          if (fb) walkBlock(fb);
        }
        break;
      }
      default: {
        const text = code.slice(node.startIndex, node.endIndex);
        emitCard(text, "What comes next?", node);
        break;
      }
    }
  };

  {
    const tops = (root.namedChildren || []).filter(
      (c) => c.type !== "comment" && !isDocstringNode(c, root)
    );
    for (const top of tops) walkStmt(top);
  }
  if (typeof opts?.maxQuestions === "number") {
    const n = Math.min(cards.length, opts.maxQuestions);
    cards.length = n;
  }

  return {
    id: "",
    kind: "custom-quiz",
    createdAt: new Date().toISOString(),
    typeLabel: "CustomQuizV1.1",
    profile,
    root: { type: root.type, start: root.startIndex, end: root.endIndex },
    totalCards: cards.length,
    cards,
  };
}
