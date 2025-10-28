import type { TreeSitterAstNode } from "./treeSitter";
import { randomString } from "./utils";

export type LessonStep = {
  id: string;
  node: TreeSitterAstNode;
  semanticRole: string;
  prompt: string;
  isDigable: boolean;
};

export type LessonPlanOptions = {
  includeNames?: boolean;
};

export type MaskRange = { start: number; end: number };

const firstChildByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).find((c) => (c as any).fieldName === field);

const childrenByField = (node: TreeSitterAstNode, field: string) =>
  (node.namedChildren || []).filter((c) => (c as any).fieldName === field);

const childrenOfType = (node: TreeSitterAstNode, type: string) =>
  (node.namedChildren || []).filter((c) => c.type === type);

export const generateLessonPlan = (
  node: TreeSitterAstNode,
  options: LessonPlanOptions = {}
): LessonStep[] => {
  const includeNames = options.includeNames ?? true;
  const steps: LessonStep[] = [];
  const children = node.namedChildren || [];

  switch (node.type) {
    case "File":
    case "Program": {
      children.forEach((c) => steps.push(...generateLessonPlan(c, options)));
      break;
    }

    case "ClassDeclaration":
    case "ClassExpression": {
      const name = firstChildByField(node, "id");
      const superCls = firstChildByField(node, "superClass");
      const body = firstChildByField(node, "body");
      if (name && includeNames) {
        steps.push({
          id: randomString(8),
          node: name,
          semanticRole: "class_name",
          prompt: "We define a class named:",
          isDigable: false,
        });
      }
      if (superCls) {
        steps.push({
          id: randomString(8),
          node: superCls,
          semanticRole: "class_extends",
          prompt: "This class extends:",
          isDigable: false,
        });
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: "class_body",
          prompt: "Now, let's look inside the class body.",
          isDigable: true,
        });
      }
      break;
    }

    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const id = firstChildByField(node, "id");
      const params = childrenByField(node, "params");
      const body = firstChildByField(node, "body");
      if (id && includeNames) {
        steps.push({
          id: randomString(8),
          node: id,
          semanticRole: "function_name",
          prompt: "We define a function named:",
          isDigable: false,
        });
      }
      if (params.length) {
        steps.push({
          id: randomString(8),
          node: params[0],
          semanticRole: "parameters",
          prompt: "These are the parameters:",
          isDigable: params.length > 1 || (params[0].namedChildren || []).length > 0,
        });
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: "function_body",
          prompt: "Now, let's explore the function body.",
          isDigable: true,
        });
      }
      break;
    }

    case "IfStatement": {
      const test = firstChildByField(node, "test");
      const cons = firstChildByField(node, "consequent");
      const alt = firstChildByField(node, "alternate");
      if (test) {
        steps.push({
          id: randomString(8),
          node: test,
          semanticRole: "if_condition",
          prompt: "The if condition is:",
          isDigable: (test.namedChildren || []).length > 0,
        });
      }
      if (cons) {
        steps.push({
          id: randomString(8),
          node: cons,
          semanticRole: "if_body",
          prompt: "If true, this block runs:",
          isDigable: true,
        });
      }
      if (alt) {
        steps.push({
          id: randomString(8),
          node: alt,
          semanticRole: "if_alternate",
          prompt: "Else branch:",
          isDigable: true,
        });
      }
      break;
    }

    case "WhileStatement": {
      const test = firstChildByField(node, "test");
      const body = firstChildByField(node, "body");
      if (test) {
        steps.push({
          id: randomString(8),
          node: test,
          semanticRole: "loop_condition",
          prompt: "The loop continues while this is true:",
          isDigable: (test.namedChildren || []).length > 0,
        });
      }
      if (body) {
        steps.push({
          id: randomString(8),
          node: body,
          semanticRole: "loop_body",
          prompt: "While true, this block executes:",
          isDigable: true,
        });
      }
      break;
    }

    case "ForStatement": {
      const init = firstChildByField(node, "init");
      const test = firstChildByField(node, "test");
      const update = firstChildByField(node, "update");
      const body = firstChildByField(node, "body");
      if (init) {
        steps.push({ id: randomString(8), node: init, semanticRole: "for_init", prompt: "For-loop init:", isDigable: true });
      }
      if (test) {
        steps.push({ id: randomString(8), node: test, semanticRole: "for_test", prompt: "For-loop condition:", isDigable: true });
      }
      if (update) {
        steps.push({ id: randomString(8), node: update, semanticRole: "for_update", prompt: "For-loop update:", isDigable: true });
      }
      if (body) {
        steps.push({ id: randomString(8), node: body, semanticRole: "for_body", prompt: "Loop body:", isDigable: true });
      }
      break;
    }

    case "ForOfStatement":
    case "ForInStatement": {
      const left = firstChildByField(node, "left");
      const right = firstChildByField(node, "right");
      const body = firstChildByField(node, "body");
      if (left) steps.push({ id: randomString(8), node: left, semanticRole: "for_left", prompt: "Loop variable(s):", isDigable: true });
      if (right) steps.push({ id: randomString(8), node: right, semanticRole: "for_right", prompt: "Iterating over:", isDigable: true });
      if (body) steps.push({ id: randomString(8), node: body, semanticRole: "for_body", prompt: "Loop body:", isDigable: true });
      break;
    }

    default: {
      children.forEach((child) => {
        steps.push({
          id: randomString(8),
          node: child,
          semanticRole: "child",
          prompt: `The next piece is a '${child.type}':`,
          isDigable: (child.namedChildren || []).length > 0,
        });
      });
      break;
    }
  }

  return steps;
};

export function maskAndAnswerForStep(
  step: LessonStep,
  root: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  const headerTypes = new Set([
    "IfStatement",
    "WhileStatement",
    "ForStatement",
    "ForOfStatement",
    "ForInStatement",
  ]);
  const isHeaderNode = headerTypes.has(step.node.type);
  if (isHeaderNode || step.semanticRole === "if_condition" || step.semanticRole === "loop_condition") {
    return headerMaskAndAnswer(step.node, code);
  }
  return { masks: [], answerText: textForNode(step.node, code) };
}

function headerMaskAndAnswer(
  stmt: TreeSitterAstNode,
  code: string
): { masks: MaskRange[]; answerText: string } {
  const firstNamed = (stmt.namedChildren || [])[0];
  const maskStart = stmt.startIndex;
  const maskEnd = firstNamed ? firstNamed.startIndex : stmt.startIndex;
  const full = code.substring(stmt.startIndex, stmt.endIndex);
  const line = full.split("\n")[0];
  const answerText = line.trimEnd();
  const masks = maskEnd > maskStart ? [{ start: maskStart, end: maskEnd }] : [];
  return { masks, answerText };
}

export const textForNode = (node: TreeSitterAstNode, code: string): string =>
  code.substring(node.startIndex, node.endIndex);

export function computeAstPath(
  root: TreeSitterAstNode,
  target: TreeSitterAstNode
): number[] {
  const path: number[] = [];
  let found = false;
  const dfs = (n: TreeSitterAstNode, cur: number[]) => {
    if (found) return;
    if (n.startIndex === target.startIndex && n.endIndex === target.endIndex && n.type === target.type) {
      path.push(...cur);
      found = true;
      return;
    }
    (n.namedChildren || []).forEach((c, idx) => dfs(c, cur.concat(idx)));
  };
  dfs(root, []);
  return path;
}

export type LessonHistoryItem = LessonStep & { action?: "next" | "dig" };

export function buildCustomQuizPayload(params: {
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  root: TreeSitterAstNode;
  code: string;
  history: LessonHistoryItem[];
  lessonQueue: LessonStep[];
  currentStep: number;
}) {
  const { fileKey, root, code, history, lessonQueue, currentStep } = params;
  const stepToCard = (
    step: LessonStep,
    order: number,
    source: "visited" | "pending",
    action: "next" | "dig" = "next"
  ) => {
    let question = `What is this ${step.node.type}?`;
    if (step.semanticRole === "loop_condition" || step.semanticRole === "if_condition") {
      question = "Write the full header line";
    }
    const answerText = textForNode(step.node, code);
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
      semanticRole: step.semanticRole,
      question,
      sourceRef,
      source,
    } as const;
  };

  const filteredHistory = history.filter((h) => h.action !== "dig");
  const visitedCards = filteredHistory.map((step, idx) => stepToCard(step, idx, "visited", step.action ?? "next"));
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
    })),
  };
}

