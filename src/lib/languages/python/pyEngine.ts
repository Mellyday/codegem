import type { TreeSitterAstNode } from "../../treeSitter";
import {
  isDocstringNode,
  childrenOfType,
  firstChildOfType,
  childByField,
  buildCuratedSections,
  getSectionItems,
  getSectionFirstItem,
  getRevealAnchors,
  getSectionSpan,
  isYieldFrom,
} from "./pyCuration";
import { randomString } from "../../utils";

// ============================================================================
// Types
// ============================================================================

export type EngineOptions = {
  profile: "shallow" | "deep";
  includeNames?: boolean;
  // Skip quiz generation when only lesson output is needed (e.g., Teach Me flow)
  generateQuiz?: boolean;
};

export type SourceRef = {
  nodeType: string;
  start: number;
  end: number;
  path: number[];
  fieldName?: string;
  textHash?: string;
  preview?: string;
};

export type QuizQuestion = {
  kind: string;
  stem: string;
  answerLabel: string;
  options: string[];
  sourceRefs: SourceRef[];
  generatorRule: string;
  difficulty?: "easy" | "medium" | "hard";
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  optionPool?: string[];
  multiSelectHint?: number;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
  /** For grouped imports: request more distractors from LLM (default 10) */
  distractorPoolSize?: number;
};


export type EngineStep = {
  id: string;
  node: TreeSitterAstNode & { isVirtual?: boolean };
  displaySpan?: { start: number; end: number };

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

const headerAnswer = (stmt: TreeSitterAstNode, code?: string): string => {
  if (!code) return stmt.type;
  const full = code.substring(stmt.startIndex, stmt.endIndex);
  const colonIdx = full.indexOf(":");
  return (colonIdx >= 0 ? full.slice(0, colonIdx) : full.split("\n")[0]).trimEnd();
};

const headerSpanByAst = (
  node: TreeSitterAstNode
): { start: number; end: number } => {
  const { headerEnd } = getRevealAnchors(node);
  return { start: node.startIndex, end: headerEnd };
};

const displaySpanForNode = (
  node: TreeSitterAstNode
): { start: number; end: number } => {
  const span = headerSpanByAst(node);
  if (span.end <= span.start) {
    return { start: node.startIndex, end: node.endIndex };
  }
  return span;
};

// Path cache: WeakMap keyed by root node, then by target node object.
// Using WeakMap<node, path> is more robust than string keys (type:start:end)
// because it avoids potential collisions with identical spans/types.
const pathCache = new WeakMap<TreeSitterAstNode, WeakMap<TreeSitterAstNode, number[]>>();

export const computeAstPath = (
  root: TreeSitterAstNode,
  target: TreeSitterAstNode
): number[] => {
  // Check cache first
  let rootCache = pathCache.get(root);
  if (!rootCache) {
    rootCache = new WeakMap<TreeSitterAstNode, number[]>();
    pathCache.set(root, rootCache);
  }

  const cached = rootCache.get(target);
  if (cached !== undefined) {
    return cached;
  }

  // DFS to find path
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

  // Cache result
  rootCache.set(target, path);
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

// Curated module-ish distractors for "Which modules are used?" questions
const MODULE_DISTRACTORS = [
  "sys",
  "os",
  "re",
  "json",
  "math",
  "pathlib",
  "collections",
  "itertools",
  "functools",
  "dataclasses",
  "datetime",
  "logging",
  "asyncio",
  "subprocess",
  "typing",
  "enum",
  "random",
  "socket",
  "http",
  "urllib",
  "csv",
  "io",
  "shutil",
  "contextlib",
  "abc",
  // Common third-party
  "numpy",
  "pandas",
  "requests",
  "flask",
  "django",
  "pytest",
  "sqlalchemy",
  "pydantic",
  "aiohttp",
  "boto3",
];

// Curated importable object distractors for "What do we import from X?" questions
const NAME_DISTRACTORS = [
  // typing
  "Any",
  "Optional",
  "Union",
  "Callable",
  "Iterable",
  "Iterator",
  "Sequence",
  "Mapping",
  "TypeVar",
  "Protocol",
  "Generic",
  "List",
  "Dict",
  "Set",
  "Tuple",
  // collections
  "defaultdict",
  "Counter",
  "OrderedDict",
  "namedtuple",
  "deque",
  "ChainMap",
  // pathlib
  "Path",
  "PurePath",
  "PosixPath",
  "WindowsPath",
  // dataclasses
  "dataclass",
  "field",
  "asdict",
  "astuple",
  // functools
  "partial",
  "lru_cache",
  "reduce",
  "wraps",
  "singledispatch",
  // contextlib
  "contextmanager",
  "suppress",
  "closing",
  // abc
  "ABC",
  "abstractmethod",
  // enum
  "Enum",
  "IntEnum",
  "auto",
  // common patterns
  "datetime",
  "timedelta",
  "timezone",
  "date",
  "time",
];


const extractOperatorBetween = (
  code: string | undefined,
  leftEnd: number,
  rightStart: number
): string | undefined => {
  if (!code) return undefined;
  const raw = code.slice(leftEnd, rightStart).trim();
  return raw.replace(/\s+/g, " ");
};

type ChainLink = {
  kind: "attr" | "call";
  name?: string;
  args?: TreeSitterAstNode[];
};
const extractCallChain = (
  node: TreeSitterAstNode,
  code?: string
): ChainLink[] => {
  const links: ChainLink[] = [];
  let cur: TreeSitterAstNode | undefined = node;

  const getFuncNode = (n: TreeSitterAstNode) =>
    childByField(n, "function") || (n.namedChildren || [])[0];

  const pushAttr = (n: TreeSitterAstNode) => {
    const kids = n.namedChildren || [];
    const nameNode = kids[kids.length - 1];
    const name = nameNode
      ? textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
      nameNode.type
      : undefined;
    links.push({ kind: "attr", name });
  };

  const pushCall = (n: TreeSitterAstNode) => {
    const fn = getFuncNode(n);
    let name: string | undefined;
    if (fn?.type === "identifier") {
      name = textForRange(fn.startIndex, fn.endIndex, code) || fn.type;
    } else if (fn?.type === "attribute") {
      const kids = fn.namedChildren || [];
      const leaf = kids[kids.length - 1];
      if (leaf?.type === "identifier") {
        name = textForRange(leaf.startIndex, leaf.endIndex, code) || leaf.type;
      }
    }
    const argsList =
      childByField(n, "arguments") ||
      (n.namedChildren || []).find((c) => c.type === "argument_list");
    const args = argsList?.namedChildren || [];
    links.push({ kind: "call", name, args });
  };

  while (cur) {
    if (cur.type === "call") {
      pushCall(cur);
      const fn = getFuncNode(cur);
      cur = fn;
    } else if (cur.type === "attribute") {
      pushAttr(cur);
      cur = (cur.namedChildren || [])[0];
    } else {
      break;
    }
  }
  return links.reverse();
};

function buildDistractors(correct: string, _ctx?: { code?: string }): string[] {
  if (!correct || !correct.trim()) {
    return shuffle(GENERIC_DISTRACTORS).slice(0, 3);
  }
  const out = new Set<string>();
  let attempts = 0;
  while (out.size < 3 && attempts < 6) {
    attempts += 1;
    const variation =
      correct.length <= 3
        ? correct.toUpperCase() !== correct
          ? correct.toUpperCase()
          : correct.toLowerCase()
        : correct.replace(/[a-zA-Z]/, (c) =>
          c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()
        );
    if (variation !== correct) out.add(variation);
    if (out.size < 3) out.add(correct + "_");
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
}

const buildMultiSelectOptionPool = (
  correct: string[],
  code: string | undefined,
  spanStart: number,
  spanEnd: number
): string[] => {
  const idPool: string[] = [];
  const strPool: string[] = [];
  try {
    const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
    const reStr = /(['"])((?:\\.|(?!\1).)*)\1/g;
    const snippet = (code || "").slice(spanStart, spanEnd);
    let m: RegExpExecArray | null;
    while ((m = reId.exec(snippet))) idPool.push(m[0]);
    while ((m = reStr.exec(snippet))) if (m[2].trim()) strPool.push(m[2]);
  } catch { }
  let pool = Array.from(new Set<string>([...correct, ...idPool, ...strPool]));
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

const buildModuleOptionPool = (
  correct: string,
  code: string | undefined,
  spanStart: number,
  spanEnd: number
): string[] => {
  const pool = new Set<string>();
  try {
    const reModule = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
    const snippet = (code || "").slice(spanStart, spanEnd);
    let m: RegExpExecArray | null;
    while ((m = reModule.exec(snippet))) {
      if (m[0] !== correct) pool.add(m[0]);
    }
  } catch { }
  let options = Array.from(pool);
  if (options.length + 1 < 10) {
    const needed = 10 - (options.length + 1);
    const pad = shuffle(GENERIC_DISTRACTORS)
      .filter((d) => d !== correct && !options.includes(d))
      .slice(0, needed);
    options.push(...pad);
  }
  const MAX = 10;
  const extras = shuffle(options);
  return shuffle([correct, ...extras.slice(0, Math.max(0, MAX - 1))]).slice(
    0,
    MAX
  );
};

// Helper: find all lambda nodes under a given node (for bubbling lambda questions)
const findLambdaNodes = (n: TreeSitterAstNode): TreeSitterAstNode[] => {
  const out: TreeSitterAstNode[] = [];
  const stack: TreeSitterAstNode[] = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur.type === "lambda") out.push(cur);
    (cur.namedChildren || []).forEach((c) => stack.push(c));
  }
  return out;
};

// Boundary node types where we should NOT descend when looking for yield/await/etc.
// These create new scopes where a yield would belong to the inner function, not the outer one.
const SCOPE_BOUNDARY_TYPES = new Set([
  "function_definition",
  "async_function_definition",
  "class_definition",
  "lambda",
  // Generator expressions create their own scope too
  "generator_expression",
]);

/**
 * Collect descendants matching a predicate, but stop descending at scope boundary nodes.
 * Used by generator detection to avoid false positives from nested functions.
 * 
 * @param node - Node to search from
 * @param predicate - Function to test each node
 * @param stopAtBoundaries - If true, don't descend into function_definition, class_definition, lambda, etc.
 */
const collectDescendantsWithinScope = (
  node: TreeSitterAstNode,
  predicate: (n: TreeSitterAstNode) => boolean,
  stopAtBoundaries: boolean = true
): TreeSitterAstNode[] => {
  const out: TreeSitterAstNode[] = [];
  const stack: TreeSitterAstNode[] = [...(node.namedChildren || [])];

  while (stack.length) {
    const cur = stack.pop()!;

    // Check if this node matches the predicate
    if (predicate(cur)) {
      out.push(cur);
    }

    // If this is a boundary node and we're stopping at boundaries, don't descend further
    if (stopAtBoundaries && SCOPE_BOUNDARY_TYPES.has(cur.type)) {
      continue;
    }

    // Otherwise, add children to stack
    for (const child of cur.namedChildren || []) {
      stack.push(child);
    }
  }

  return out;
};

// ============================================================================
// Import Run Grouping
// ============================================================================

/**
 * Check if a node is an import statement
 */
const isImportStmt = (n: TreeSitterAstNode): boolean =>
  n.type === "import_statement" || n.type === "import_from_statement";

/**
 * Collect contiguous import statements starting at index
 */
function collectImportRun(
  stmts: TreeSitterAstNode[],
  startIdx: number
): { run: TreeSitterAstNode[]; nextIndex: number } {
  const run: TreeSitterAstNode[] = [];
  let i = startIdx;
  while (i < stmts.length && isImportStmt(stmts[i])) {
    run.push(stmts[i]);
    i++;
  }
  return { run, nextIndex: i };
}

/**
 * Split "import x as y" into original and alias.
 * Returns the original name (not the alias).
 */
function splitAs(raw: string): { original: string; alias?: string } {
  const parts = raw.split(/\s+as\s+/);
  const original = (parts[0] ?? "").trim();
  const alias = parts[1]?.trim();
  return { original, alias };
}

/**
 * Extract module names and imported names from an import run.
 * Uses original names (not aliases) per user requirement.
 * 
 * - modules: all modules referenced (from both import and import_from)
 * - importedByModule: for import_from, maps module name to imported names
 * - aliases: all aliases (for distractor filtering)
 */
function extractImportRunData(
  run: TreeSitterAstNode[],
  code: string | undefined
): {
  modules: Set<string>;
  importedByModule: Map<string, Set<string>>;
  aliases: Set<string>;
  span: { start: number; end: number };
} {
  const modules = new Set<string>();
  const importedByModule = new Map<string, Set<string>>();
  const aliases = new Set<string>();

  const first = run[0];
  const last = run[run.length - 1];
  const span = { start: first.startIndex, end: last.endIndex };

  const addImported = (mod: string, name: string) => {
    if (!mod || !name) return;
    let set = importedByModule.get(mod);
    if (!set) importedByModule.set(mod, (set = new Set()));
    set.add(name);
  };

  for (const stmt of run) {
    if (stmt.type === "import_from_statement") {
      const sections = buildCuratedSections(stmt);
      const moduleNode = sections.find((g) => g.key === "module")?.items?.[0];
      const moduleText = moduleNode
        ? (textForRange(moduleNode.startIndex, moduleNode.endIndex, code) ?? "").trim()
        : "";
      if (moduleText) modules.add(moduleText);

      const names = sections.find((g) => g.key === "names")?.items ?? [];
      for (const n of names) {
        const raw = (textForRange(n.startIndex, n.endIndex, code) ?? "").trim();
        if (!raw) continue;
        // Skip star imports (from x import *)
        if (raw === "*") continue;
        const { original, alias } = splitAs(raw);
        if (original) addImported(moduleText, original);
        if (alias) aliases.add(alias);
      }
    }

    if (stmt.type === "import_statement") {
      const sections = buildCuratedSections(stmt);
      const names = sections.find((g) => g.key === "names")?.items ?? [];
      for (const n of names) {
        const raw = (textForRange(n.startIndex, n.endIndex, code) ?? "").trim();
        if (!raw) continue;
        const { original, alias } = splitAs(raw);
        // For plain `import x`, add to modules but NOT to importedByModule
        if (original) modules.add(original);
        if (alias) aliases.add(alias);
      }
    }
  }

  return { modules, importedByModule, aliases, span };
}


/**
 * Split a list of correct answers into cards with 3-6 each.
 * Randomizes distribution to avoid "last card smallest" pattern.
 */
function splitCorrectIntoCards(correct: string[]): string[][] {
  const unique = [...new Set(correct)];
  // If <=6, single card is fine
  if (unique.length <= 6) return [unique];

  const shuffled = shuffle(unique);
  const numCards = Math.ceil(unique.length / 6);
  const baseSize = Math.floor(unique.length / numCards);
  const remainder = unique.length % numCards;

  // Randomly assign extra items to cards
  const cardIndices = [...Array(numCards).keys()];
  const shuffledIndices = shuffle(cardIndices);
  const extraSlots = new Set(shuffledIndices.slice(0, remainder));

  const cards: string[][] = [];
  let idx = 0;

  for (let c = 0; c < numCards; c++) {
    const size = baseSize + (extraSlots.has(c) ? 1 : 0);
    cards.push(shuffled.slice(idx, idx + size));
    idx += size;
  }

  // Shuffle card order so extras aren't always first
  return shuffle(cards);
}

/**
 * Build an option pool for import questions.
 * Includes correct answers + distractors, excluding aliases.
 * 
 * @param mode - "module" uses dotted identifiers, "name" uses simple identifiers
 * @param importedNames - for module mode, exclude these (they're imported objects, not modules)
 */
function buildImportOptionPool(
  correct: string[],
  allCorrectInFamily: string[],
  aliases: Set<string>,
  code: string | undefined,
  span: { start: number; end: number },
  targetOptions: number = 10,
  mode: "module" | "name" = "module",
  importedNames?: Set<string>
): string[] {
  // Collect identifiers from surrounding code as potential distractors
  const idPool: string[] = [];
  try {
    // Use dotted pattern for modules, simple identifiers for names
    const re = mode === "module"
      ? /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g
      : /[A-Za-z_][A-Za-z0-9_]*/g;
    const snippetStart = Math.max(0, span.start - 500);
    const snippetEnd = span.end + 500;
    const snippet = (code || "").slice(snippetStart, snippetEnd);
    let m: RegExpExecArray | null;
    while ((m = re.exec(snippet))) {
      const candidate = m[0];
      // Exclude: correct answers from entire family, aliases, keywords
      if (allCorrectInFamily.includes(candidate)) continue;
      if (aliases.has(candidate)) continue;
      if (["import", "from", "as", "None", "True", "False", "def", "class", "return"].includes(candidate)) continue;
      // For module mode: exclude uppercase-starting identifiers (likely classes/types, not modules)
      // and exclude imported names (they're objects, not modules)
      if (mode === "module") {
        if (/^[A-Z]/.test(candidate)) continue; // Avoid Path, List, OrderedDict
        if (importedNames?.has(candidate)) continue;
      }
      idPool.push(candidate);
    }
  } catch { }

  // Dedupe
  const distractors = Array.from(new Set(idPool));

  // Pad with curated distractors if needed (use mode-appropriate list)
  if (distractors.length < targetOptions - correct.length) {
    const needed = targetOptions - correct.length - distractors.length;
    const fallbackList = mode === "module" ? MODULE_DISTRACTORS : NAME_DISTRACTORS;
    const pad = shuffle(fallbackList)
      .filter((d) => !correct.includes(d) && !distractors.includes(d) && !aliases.has(d) && !allCorrectInFamily.includes(d))
      .slice(0, needed);
    distractors.push(...pad);
  }

  // Build final pool: correct + enough distractors to reach targetOptions
  const shuffledDistractors = shuffle(distractors);
  const neededDistractors = Math.max(0, targetOptions - correct.length);
  const pool = [...correct, ...shuffledDistractors.slice(0, neededDistractors)];

  return shuffle(pool).slice(0, targetOptions);
}


/**
 * Generate questions for a contiguous import run.
 * Creates two types of multi-select cards:
 * - "Which modules are used?" (across whole run)
 * - "What do we import from X?" (per-module)
 * 
 * Splits into multiple cards if >6 correct, aiming for 3-6 correct each.
 */
function generateImportRunQuestions(
  root: TreeSitterAstNode,
  run: TreeSitterAstNode[],
  code: string | undefined
): QuizQuestion[] {
  if (!run.length) return [];

  const { modules, importedByModule, aliases, span } = extractImportRunData(run, code);
  const qs: QuizQuestion[] = [];

  // Use the first node for SourceRef path (virtual spans use this)
  const firstNode = run[0];
  const baseSourceRef: SourceRef = {
    nodeType: "import_group",
    start: span.start,
    end: span.end,
    path: computeAstPath(root, firstNode),
    preview: (code || "").slice(span.start, Math.min(span.end, span.start + 120)),
  };

  // === Module Questions (across whole run) ===
  // Collect all imported names to exclude from module distractors
  const allImportedNames = new Set<string>();
  for (const set of importedByModule.values()) {
    for (const n of set) allImportedNames.add(n);
  }

  const moduleList = Array.from(modules);
  if (moduleList.length > 0) {
    const moduleCards = splitCorrectIntoCards(moduleList);
    const totalModuleCards = moduleCards.length;

    moduleCards.forEach((cardCorrect, cardIdx) => {
      const partLabel = totalModuleCards > 1 ? ` (Part ${cardIdx + 1} of ${totalModuleCards})` : "";
      const optionPool = buildImportOptionPool(
        cardCorrect,
        moduleList,  // All correct from this family
        aliases,
        code,
        span,
        10,
        "module",  // Use dotted identifier pattern
        allImportedNames  // Exclude imported names from module distractors
      );

      qs.push({
        kind: "import_modules_multi",
        stem: `Which modules are used here?${partLabel} (use original names, ignore aliases)`,
        answerLabel: cardCorrect[0] ?? "module",
        options: optionPool,
        sourceRefs: [baseSourceRef],
        generatorRule: "import_run.modules",
        questionType: "multi",
        multiCorrect: cardCorrect,
        optionPool,
        revealStart: span.start,
        revealEndBeforeChild: span.start,
        revealEndAfterChild: span.end,
        // No distractorPoolSize needed - curated MODULE_DISTRACTORS list is sufficient
      });
    });
  }

  // === Imported Names Questions (per module) ===
  for (const [moduleName, namesSet] of importedByModule.entries()) {
    const namesList = Array.from(namesSet);
    if (namesList.length === 0) continue;

    const nameCards = splitCorrectIntoCards(namesList);
    const totalNameCards = nameCards.length;
    // No distractorPoolSize for names cards - 10 options is enough per card

    nameCards.forEach((cardCorrect, cardIdx) => {
      const partLabel = totalNameCards > 1 ? ` (Part ${cardIdx + 1} of ${totalNameCards})` : "";
      const optionPool = buildImportOptionPool(
        cardCorrect,
        namesList,  // All correct from THIS module's family
        aliases,
        code,
        span,
        10,
        "name"  // Use simple identifier pattern
      );

      // Handle relative imports with clearer stem
      const stemModuleName = moduleName.startsWith(".")
        ? "this relative module"
        : moduleName;

      qs.push({
        kind: "imported_names_multi",
        stem: `What do we import from ${stemModuleName}?${partLabel} (use original names, ignore aliases)`,
        answerLabel: cardCorrect[0] ?? "import",
        options: optionPool,
        sourceRefs: [baseSourceRef],
        generatorRule: `import_run.names:${moduleName}`,
        questionType: "multi",
        multiCorrect: cardCorrect,
        optionPool,
        revealStart: span.start,
        revealEndBeforeChild: span.start,
        revealEndAfterChild: span.end,
        // No distractorPoolSize for names - 10 options per card is sufficient
      });
    });
  }

  return qs;
}


// ============================================================================
// Quiz rules (copied from pyQuiz)

// ============================================================================
//
// NOTE: Tree-sitter node type names can vary across grammar versions/forks.
// Known variations to watch for:
// - yield: yield, yield_expression, yield_expr, yield_statement
// - f-strings: f_string, formatted_string
// - comparison: comparison, comparison_operator
// - patterns: as_pattern, class_pattern, etc. (may not exist in all grammars)
// - annotated assignments: annotated_assignment (may be represented differently)
//
// If a rule never fires, check the actual AST output for your grammar version.
// Consider adding a dev-only utility to dump encountered node types for coverage testing.

type DecompositionLevel = "shallow" | "deep";

type RuleCtx = {
  root: TreeSitterAstNode;
  node: TreeSitterAstNode;
  code?: string;
  sourceRef: SourceRef;
  profile: DecompositionLevel;
};

type Q11 = QuizQuestion;

type Rule = (ctx: RuleCtx) => Q11[] | undefined;

const headerRule: Rule = ({ node, code, sourceRef }) => {
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

const rules: Record<string, Rule[]> = {
  assignment: [
    ({ root, node, code, sourceRef, profile }) => {
      const left = getSectionFirstItem(node, "target");
      const right = getSectionFirstItem(node, "value");
      if (!left || !right) return;
      const leftText =
        textForRange(left.startIndex, left.endIndex, code) || left.type;

      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the left-hand side (target) of this assignment?",
          answerLabel: leftText,
          options: buildDistractors(leftText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: left.type,
              start: left.startIndex,
              end: left.endIndex,
              path: computeAstPath(root, left),
            },
          ],
          generatorRule: "assignment.lhs",
        },
      ];

      // Bubble up lambda questions if RHS contains lambda(s)
      const lambdas = findLambdaNodes(right);
      if (lambdas.length > 0) {
        let added = 0;
        for (const lam of lambdas) {
          const lambdaQs = generateQuestionsV11(root, lam, profile, code);
          added += lambdaQs.length;
          qs.push(...lambdaQs);
        }
        // Only skip generic RHS question if we actually added lambda questions
        if (added > 0) return qs;
      }

      // Standard RHS question
      const rightText =
        textForRange(right.startIndex, right.endIndex, code) || right.type;
      qs.push({
        kind: "identify-field",
        stem: "What is the right-hand side (value) of this assignment?",
        answerLabel: rightText,
        options: buildDistractors(rightText, { code }),
        sourceRefs: [
          sourceRef,
          {
            nodeType: right.type,
            start: right.startIndex,
            end: right.endIndex,
            path: computeAstPath(root, right),
          },
        ],
        generatorRule: "assignment.rhs",
      });
      return qs;
    },
  ],
  comparison_operator: [
    ({ root, node, code, sourceRef }) => {
      const left = getSectionFirstItem(node, "left");
      const comparators = getSectionItems(node, "comparators");
      if (!left || comparators.length === 0) return;
      const qs: Q11[] = [];
      const leftText =
        textForRange(left.startIndex, left.endIndex, code) || left.type;
      qs.push({
        kind: "identify-field",
        stem: "What is the left operand?",
        answerLabel: leftText,
        options: buildDistractors(leftText, { code }),
        sourceRefs: [
          sourceRef,
          {
            nodeType: left.type,
            start: left.startIndex,
            end: left.endIndex,
            path: computeAstPath(root, left),
          },
        ],
        generatorRule: "comparison.left",
      });
      // Track previous node for operator extraction
      let prev = left;
      for (let i = 0; i < comparators.length; i++) {
        const comp = comparators[i];
        const compText =
          textForRange(comp.startIndex, comp.endIndex, code) || comp.type;
        const op = extractOperatorBetween(code, prev.endIndex, comp.startIndex);
        if (op && op.length <= 6) {
          qs.push({
            kind: "operator",
            stem: `What is the operator #${i + 1}?`,
            answerLabel: op,
            options: buildDistractors(op, { code }),
            sourceRefs: [sourceRef],
            generatorRule: "comparison.op",
          });
        }
        qs.push({
          kind: "identify-field",
          stem: `What is comparator #${i + 1}?`,
          answerLabel: compText,
          options: buildDistractors(compText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: comp.type,
              start: comp.startIndex,
              end: comp.endIndex,
              path: computeAstPath(root, comp),
            },
          ],
          generatorRule: "comparison.comparator",
        });
        prev = comp;
      }
      return qs;
    },
  ],
  import_from_statement: [
    ({ root, node, code, sourceRef }) => {
      const sections = buildCuratedSections(node);
      const moduleGroup = sections.find((g) => g.key === "module");
      const moduleNode = moduleGroup?.items?.[0];
      const moduleText =
        moduleNode &&
        (textForRange(moduleNode.startIndex, moduleNode.endIndex, code) ||
          moduleNode.type);
      const namesGroup = sections.find((g) => g.key === "names");
      const items = namesGroup?.items || [];
      const correct = items
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const qs: Q11[] = [];
      if (moduleText && moduleNode) {
        const moduleRef: SourceRef = {
          nodeType: moduleNode.type,
          start: moduleNode.startIndex,
          end: moduleNode.endIndex,
          path: computeAstPath(root, moduleNode),
        };
        const moduleSpan = getSectionSpan(node, "module");
        qs.push({
          kind: "import_from_module",
          stem: "What module is this import from?",
          answerLabel: moduleText,
          options: buildModuleOptionPool(moduleText, code, spanStart, spanEnd),
          sourceRefs: [sourceRef, moduleRef],
          generatorRule: "import_from.module",
          revealStart: node.startIndex,
          revealEndBeforeChild: moduleSpan?.start,
          revealEndAfterChild: moduleSpan?.end,
        });
      }

      // Option pool mirrors the old pyQuiz multi-select behavior for imports.
      const optionPool = buildMultiSelectOptionPool(
        correct,
        code,
        spanStart,
        spanEnd
      );
      const namesSpan = getSectionSpan(node, "names");
      qs.push({
        kind: "imported_names_multi",
        stem: "Which names are imported?",
        answerLabel: correct[0] ?? "import",
        options: optionPool,
        sourceRefs: [sourceRef],
        generatorRule: "import_from.names",
        questionType: "multi",
        multiCorrect: correct,
        optionPool,
        revealStart: node.startIndex,
        revealEndBeforeChild: namesSpan?.start,
        revealEndAfterChild: namesSpan?.end,
      });
      return qs;
    },
  ],
  import_statement: [
    ({ node, code, sourceRef }) => {
      const sections = buildCuratedSections(node);
      const namesGroup = sections.find((g) => g.key === "names");
      const items = namesGroup?.items || [];
      const correct = items
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      // Option pool mirrors the old pyQuiz multi-select behavior for imports.
      const optionPool = buildMultiSelectOptionPool(
        correct,
        code,
        spanStart,
        spanEnd
      );
      const namesSpan = getSectionSpan(node, "names");
      return [
        {
          kind: "imported_names_multi",
          stem: "Which names are imported?",
          answerLabel: correct[0] ?? "import",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "import.names",
          questionType: "multi",
          multiCorrect: correct,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: namesSpan?.start,
          revealEndAfterChild: namesSpan?.end,
        },
      ];
    },
  ],
  dictionary: [
    ({ node, code, sourceRef }) => {
      const keyItems = getSectionItems(node, "keys");
      const keys: string[] = [];
      for (const k of keyItems) {
        keys.push(textForRange(k.startIndex, k.endIndex, code) || k.type);
      }
      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const idPool: string[] = [];
      const strPool: string[] = [];
      try {
        const reId = /[A-Za-z_][A-Za-z0-9_]*/g;
        const reStr = /(['"])((?:\\.|(?!\1).)*)\1/g;
        const snippet = (code || "").slice(spanStart, spanEnd);
        let m: RegExpExecArray | null;
        while ((m = reId.exec(snippet))) idPool.push(m[0]);
        while ((m = reStr.exec(snippet))) if (m[2].trim()) strPool.push(m[2]);
      } catch { }
      let pool = Array.from(new Set<string>([...keys, ...idPool, ...strPool]));
      if (pool.length < 10) {
        const needed = 10 - pool.length;
        const pad = shuffle(GENERIC_DISTRACTORS)
          .filter((d) => !pool.includes(d))
          .slice(0, needed);
        pool.push(...pad);
      }
      const MAX = 10;
      const extras = shuffle(pool.filter((p) => !keys.includes(p)));
      const optionPool = shuffle([
        ...keys,
        ...extras.slice(0, Math.max(0, MAX - keys.length)),
      ]).slice(0, MAX);
      const keysSpan = getSectionSpan(node, "keys");

      return [
        {
          kind: "dict-keys",
          stem: `Which keys are present in this dict?`,
          answerLabel: keys[0] ?? "dict",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "dict.keys",
          questionType: "multi",
          multiCorrect: keys,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: keysSpan?.start,
          revealEndAfterChild: keysSpan?.end,
        },
      ];
    },
  ],
  call: [
    ({ root, node, code, sourceRef, profile }) => {
      const fnNode = getSectionFirstItem(node, "func");
      const args = getSectionItems(node, "args");
      const keywords = getSectionItems(node, "keywords");
      const fnText = fnNode
        ? textForRange(fnNode.startIndex, fnNode.endIndex, code) || fnNode.type
        : "call";
      const qs: Q11[] = [
        {
          kind: "call-func",
          stem: "Which function or method is being called here?",
          answerLabel: fnText,
          options: buildDistractors(fnText, { code }),
          sourceRefs: [sourceRef],
          generatorRule: "call.func",
        },
      ];
      if (profile !== "shallow") {
        // Positional arguments
        args.forEach((a, idx) => {
          const argText =
            textForRange(a.startIndex, a.endIndex, code) || a.type;
          qs.push({
            kind: "call-arg-positional",
            stem: `What is positional argument #${idx + 1}?`,
            answerLabel: argText,
            options: buildDistractors(argText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: a.type,
                start: a.startIndex,
                end: a.endIndex,
                path: computeAstPath(root, a),
              },
            ],
            generatorRule: "call.pos-arg",
          });
        });
        // Keyword arguments
        for (const kw of keywords) {
          // Use proper field access for robustness
          const keyNode =
            getSectionFirstItem(kw, "name") ||
            (kw.namedChildren || []).find((c) => c.type === "identifier");
          const nameText =
            keyNode &&
            textForRange(keyNode.startIndex, keyNode.endIndex, code);
          if (nameText) {
            qs.push({
              kind: "call-arg-keyword",
              stem: `What is this keyword argument name?`,
              answerLabel: nameText,
              options: buildDistractors(nameText, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: kw.type,
                  start: kw.startIndex,
                  end: kw.endIndex,
                  path: computeAstPath(root, kw),
                },
              ],
              generatorRule: "call.kwarg-name",
            });
          }
        }
      }

      // Bubble up lambda questions from args/keywords (in all modes, including shallow)
      const allArgNodes = [...args, ...keywords];
      for (const argNode of allArgNodes) {
        const lambdas = findLambdaNodes(argNode);
        for (const lam of lambdas) {
          const lambdaQs = generateQuestionsV11(root, lam, profile, code);
          qs.push(...lambdaQs);
        }
      }
      return qs;
    },
  ],
  attribute: [
    ({ node, code, sourceRef, profile }) => {
      if (profile === "shallow") return;
      const chain = extractCallChain(node, code);
      if (chain.length <= 1) return;
      const qs: Q11[] = [];
      chain.forEach((link, i) => {
        if (link.kind === "call" && link.name) {
          qs.push({
            kind: "chain-method-name",
            stem: `What is the name of method #${i + 1} in this chain?`,
            answerLabel: link.name,
            options: buildDistractors(link.name, { code }),
            sourceRefs: [sourceRef],
            generatorRule: "chain.method-name",
          });
        }
      });
      return qs;
    },
  ],
  binary_operator: [
    ({ root, node, code, sourceRef }) => {
      const left = getSectionFirstItem(node, "left");
      const right = getSectionFirstItem(node, "right");
      if (!left || !right) return;
      const leftText =
        textForRange(left.startIndex, left.endIndex, code) || left.type;
      const rightText =
        textForRange(right.startIndex, right.endIndex, code) || right.type;
      const op = extractOperatorBetween(code, left.endIndex, right.startIndex);
      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the left operand?",
          answerLabel: leftText,
          options: buildDistractors(leftText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: left.type,
              start: left.startIndex,
              end: left.endIndex,
              path: computeAstPath(root, left),
            },
          ],
          generatorRule: "binary.left",
        },
        {
          kind: "identify-field",
          stem: "What is the right operand?",
          answerLabel: rightText,
          options: buildDistractors(rightText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: right.type,
              start: right.startIndex,
              end: right.endIndex,
              path: computeAstPath(root, right),
            },
          ],
          generatorRule: "binary.right",
        },
      ];
      if (op && op.length <= 6) {
        qs.unshift({
          kind: "operator",
          stem: "What operator is used here?",
          answerLabel: op,
          options: buildDistractors(op, { code }),
          sourceRefs: [sourceRef],
          generatorRule: "binary.op",
        });
      }
      return qs;
    },
  ],
  subscript: [
    ({ root, node, code, sourceRef }) => {
      const valueNode = getSectionFirstItem(node, "value");
      // pyCuration exposes slice OR index depending on content
      const sliceNode = getSectionFirstItem(node, "slice");
      const indexNode = getSectionFirstItem(node, "index");
      const second = sliceNode || indexNode;
      if (!valueNode) return;
      const valueText =
        textForRange(valueNode.startIndex, valueNode.endIndex, code) ||
        valueNode.type;
      const qs: Q11[] = [
        {
          kind: "identify-field",
          stem: "What is the base being indexed?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: valueNode.type,
              start: valueNode.startIndex,
              end: valueNode.endIndex,
              path: computeAstPath(root, valueNode),
            },
          ],
          generatorRule: "subscript.base",
        },
      ];
      if (second) {
        if (sliceNode && sliceNode.type === "slice") {
          // Use slice sections for start/stop/step
          const startItem = getSectionFirstItem(sliceNode, "start");
          const stopItem = getSectionFirstItem(sliceNode, "stop");
          const stepItem = getSectionFirstItem(sliceNode, "step");
          const parts = [startItem, stopItem, stepItem].filter(Boolean) as TreeSitterAstNode[];
          const labels = ["start", "stop", "step"] as const;
          parts.forEach((p, idx) => {
            const txt = textForRange(p.startIndex, p.endIndex, code) || p.type;
            qs.push({
              kind: "identify-field",
              stem: `What is the ${labels[idx]} of this slice?`,
              answerLabel: txt,
              options: buildDistractors(txt, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: p.type,
                  start: p.startIndex,
                  end: p.endIndex,
                  path: computeAstPath(root, p),
                },
              ],
              generatorRule: `slice.${labels[idx]}`,
            });
          });
        } else {
          const idxText =
            textForRange(second.startIndex, second.endIndex, code) ||
            second.type;
          qs.push({
            kind: "identify-field",
            stem: "What is the index?",
            answerLabel: idxText,
            options: buildDistractors(idxText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: second.type,
                start: second.startIndex,
                end: second.endIndex,
                path: computeAstPath(root, second),
              },
            ],
            generatorRule: "subscript.index",
          });
        }
      }
      return qs;
    },
  ],
  slice: [
    ({ root, node, code, sourceRef }) => {
      const startItem = getSectionFirstItem(node, "start");
      const stopItem = getSectionFirstItem(node, "stop");
      const stepItem = getSectionFirstItem(node, "step");
      const parts = [startItem, stopItem, stepItem].filter(Boolean) as TreeSitterAstNode[];
      if (parts.length === 0) return;
      const qs: Q11[] = [];
      const labels = ["start", "stop", "step"] as const;
      parts.forEach((p, idx) => {
        const txt = textForRange(p.startIndex, p.endIndex, code) || p.type;
        qs.push({
          kind: "identify-field",
          stem: `What is the ${labels[idx]} of this slice?`,
          answerLabel: txt,
          options: buildDistractors(txt, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: p.type,
              start: p.startIndex,
              end: p.endIndex,
              path: computeAstPath(root, p),
            },
          ],
          generatorRule: `slice.${labels[idx]}`,
        });
      });
      return qs;
    },
  ],
  function_definition: [
    ({ root, node, code, sourceRef, profile }) => {
      const params = getSectionItems(node, "args");
      const qs: Q11[] = [];
      const defaults: Array<{ name: string; value: string; node: TreeSitterAstNode }> = [];

      // Categorize parameters: positional-only (before /), normal, keyword-only (after *)
      const positionalOnly: string[] = [];
      const normal: string[] = [];
      const keywordOnly: string[] = [];
      let seenSlash = false; // /
      let seenStar = false;  // * or *args

      for (const p of params) {
        const raw = (textForRange(p.startIndex, p.endIndex, code) ?? "").trim();

        // Handle / (positional-only separator)
        if (raw === "/" || p.type === "positional_separator") {
          seenSlash = true;
          continue;
        }

        // Handle bare * (keyword-only separator)
        if (raw === "*" || p.type === "keyword_separator") {
          seenStar = true;
          continue;
        }

        const nameNode = (p.namedChildren || []).find(
          (c) => c.type === "identifier"
        );
        const id = nameNode
          ? textForRange(nameNode.startIndex, nameNode.endIndex, code) || "param"
          : raw.split(":")[0].split("=")[0].replace(/^\*+/, "").trim() || "param";

        // Preserve * or ** prefix
        let paramName: string;
        if (raw.startsWith("**")) {
          paramName = `**${id}`;
          seenStar = true; // **kwargs also marks everything before as keyword-eligible
        } else if (raw.startsWith("*") && raw !== "*") {
          paramName = `*${id}`;
          seenStar = true; // *args marks everything after as keyword-only
        } else {
          paramName = id;
        }

        // Categorize based on separators seen
        if (!seenSlash && !seenStar) {
          // Before any separator - could be positional-only if / comes later
          // For now, add to a temporary list and recategorize after loop
          positionalOnly.push(paramName);
        } else if (seenSlash && !seenStar) {
          normal.push(paramName);
        } else if (seenStar) {
          keywordOnly.push(paramName);
        }

        // Extract default value if present
        if (raw.includes("=") && !raw.startsWith("*")) {
          const defaultNode = (p.namedChildren || []).find(
            (c) =>
              c.type !== "identifier" &&
              c.type !== "type" &&
              c.type !== "type_annotation" &&
              c.startIndex > (nameNode?.endIndex ?? p.startIndex)
          );
          if (defaultNode) {
            const defaultValue =
              textForRange(defaultNode.startIndex, defaultNode.endIndex, code) ??
              "";
            if (defaultValue.trim()) {
              defaults.push({ name: id, value: defaultValue.trim(), node: defaultNode });
            }
          }
        }
      }

      // If we never saw /, the positionalOnly params are actually normal
      if (!seenSlash) {
        normal.unshift(...positionalOnly);
        positionalOnly.length = 0;
      }

      // All params combined for the generic question
      const allNames = [...positionalOnly, ...normal, ...keywordOnly];

      const block = getSectionFirstItem(node, "body");
      const spanStart = block ? block.startIndex : node.startIndex;
      const spanEnd = block ? block.endIndex : node.endIndex;
      const paramsNode =
        childByField(node, "parameters") || firstChildOfType(node, "parameters");
      const paramsSpan = paramsNode
        ? { start: paramsNode.startIndex, end: paramsNode.endIndex }
        : getSectionSpan(node, "args");

      // Emit generic "all params" question
      if (allNames.length > 0) {
        const optionPool = buildMultiSelectOptionPool(allNames, code, spanStart, spanEnd);
        qs.push({
          kind: "function_params_multi",
          stem: "Which of the following are parameters of this function?",
          answerLabel: allNames[0] ?? "param",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "func.params-multi",
          questionType: "multi",
          multiCorrect: allNames,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: paramsSpan?.start,
          revealEndAfterChild: paramsSpan?.end,
        });
      }

      // Emit category-specific questions (only in deep mode and if category has items)
      if (profile === "deep") {
        if (positionalOnly.length > 0) {
          const optionPool = buildMultiSelectOptionPool(positionalOnly, code, spanStart, spanEnd);
          qs.push({
            kind: "function_params_positional_only",
            stem: "Which parameters are positional-only (before /)?",
            answerLabel: positionalOnly[0] ?? "param",
            options: optionPool,
            sourceRefs: [sourceRef],
            generatorRule: "func.params-positional-only",
            questionType: "multi",
            multiCorrect: positionalOnly,
            optionPool,
            revealStart: node.startIndex,
            revealEndBeforeChild: paramsSpan?.start,
            revealEndAfterChild: paramsSpan?.end,
          });
        }

        if (keywordOnly.length > 0) {
          const optionPool = buildMultiSelectOptionPool(keywordOnly, code, spanStart, spanEnd);
          qs.push({
            kind: "function_params_keyword_only",
            stem: "Which parameters are keyword-only (after *)?",
            answerLabel: keywordOnly[0] ?? "param",
            options: optionPool,
            sourceRefs: [sourceRef],
            generatorRule: "func.params-keyword-only",
            questionType: "multi",
            multiCorrect: keywordOnly,
            optionPool,
            revealStart: node.startIndex,
            revealEndBeforeChild: paramsSpan?.start,
            revealEndAfterChild: paramsSpan?.end,
          });
        }
      }

      // Always ask return type (even in shallow)
      const ret = getSectionFirstItem(node, "returns");
      if (ret) {
        const retText =
          textForRange(ret.startIndex, ret.endIndex, code) || ret.type;
        qs.push({
          kind: "return-type",
          stem: "What is the return type of this function?",
          answerLabel: retText,
          options: buildDistractors(retText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: ret.type,
              start: ret.startIndex,
              end: ret.endIndex,
              path: computeAstPath(root, ret),
            },
          ],
          generatorRule: "func.return-type",
        });
      }

      if (profile !== "shallow") {
        // Default parameter values
        for (const def of defaults) {
          qs.push({
            kind: "param-default",
            stem: `What is the default value of parameter ${def.name}?`,
            answerLabel: def.value,
            options: buildDistractors(def.value, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: def.node.type,
                start: def.node.startIndex,
                end: def.node.endIndex,
                path: computeAstPath(root, def.node),
              },
            ],
            generatorRule: "func.param-default",
          });
        }

        // Type parameters (Python 3.12+ PEP 695)
        const typeParamsNode = getSectionFirstItem(node, "type_params");
        if (typeParamsNode) {
          const typeParamChildren = typeParamsNode.namedChildren || [];
          if (typeParamChildren.length > 0) {
            const typeParamNames = typeParamChildren
              .map((tp) => textForRange(tp.startIndex, tp.endIndex, code) || tp.type)
              .filter(Boolean);
            if (typeParamNames.length > 0) {
              const tpSpan = getSectionSpan(node, "type_params");
              const tpOptionPool = buildMultiSelectOptionPool(typeParamNames, code, node.startIndex, node.endIndex);
              qs.push({
                kind: "func_type_params_multi",
                stem: "Which are type parameters of this function?",
                answerLabel: typeParamNames[0] ?? "T",
                options: tpOptionPool,
                sourceRefs: [sourceRef],
                generatorRule: "func.type-params-multi",
                questionType: "multi",
                multiCorrect: typeParamNames,
                optionPool: tpOptionPool,
                revealStart: node.startIndex,
                revealEndBeforeChild: tpSpan?.start,
                revealEndAfterChild: tpSpan?.end,
              });
            }
          }
        }

        // Generator function detection (yield/yield from in function body)
        const bodyNode = getSectionFirstItem(node, "body");
        if (bodyNode) {
          // Helper to check if a node is a yield type
          const isYieldType = (t: string) =>
            t === "yield" ||
            t === "yield_expression" ||
            t === "yield_expr" ||
            t === "yield_statement";

          // Collect yield nodes, unwrapping expression_statement wrappers
          const yieldNodes: TreeSitterAstNode[] = [];
          const rawMatches = collectDescendantsWithinScope(
            bodyNode,
            (n) =>
              isYieldType(n.type) ||
              // Also match expression_statement containing yield
              (n.type === "expression_statement" &&
                (n.namedChildren || []).some((c) => isYieldType(c.type)))
          );

          for (const match of rawMatches) {
            if (isYieldType(match.type)) {
              // Direct yield node
              yieldNodes.push(match);
            } else if (match.type === "expression_statement") {
              // Unwrap: push the actual yield child, not the wrapper
              const yieldChild = (match.namedChildren || []).find((c) => isYieldType(c.type));
              if (yieldChild) {
                yieldNodes.push(yieldChild);
              }
            }
          }

          if (yieldNodes.length > 0) {
            // Check if any are yield from (now correctly using actual yield nodes)
            const hasYieldFrom = yieldNodes.some((y) => isYieldFrom(y, code));

            qs.push({
              kind: "generator-function",
              stem: "Does this function use yield (making it a generator)?",
              answerLabel: "Yes",
              options: ["No"],
              sourceRefs: [sourceRef],
              generatorRule: "func.is-generator",
              difficulty: "easy",
            });

            // If there's yield from, add a specific question
            if (hasYieldFrom) {
              qs.push({
                kind: "generator-yield-from",
                stem: "Does this generator use 'yield from'?",
                answerLabel: "Yes",
                options: ["No"],
                sourceRefs: [sourceRef],
                generatorRule: "func.has-yield-from",
                difficulty: "medium",
              });
            }
          }
        }
      }
      return qs;
    },
  ],
  class_definition: [
    ({ root, node, code, sourceRef }) => {
      const qs: Q11[] = [];

      // 0. Type parameters (Python 3.12+ PEP 695, e.g. class Box[T]:)
      const typeParamsNode = getSectionFirstItem(node, "type_params");
      if (typeParamsNode) {
        const typeParamChildren = typeParamsNode.namedChildren || [];
        if (typeParamChildren.length > 0) {
          const typeParamNames = typeParamChildren
            .map((tp) => textForRange(tp.startIndex, tp.endIndex, code) || tp.type)
            .filter(Boolean);
          if (typeParamNames.length > 0) {
            const tpSpan = getSectionSpan(node, "type_params");
            const tpOptionPool = buildMultiSelectOptionPool(typeParamNames, code, node.startIndex, node.endIndex);
            qs.push({
              kind: "class_type_params_multi",
              stem: "Which are type parameters of this class?",
              answerLabel: typeParamNames[0] ?? "T",
              options: tpOptionPool,
              sourceRefs: [sourceRef],
              generatorRule: "class.type-params-multi",
              questionType: "multi",
              multiCorrect: typeParamNames,
              optionPool: tpOptionPool,
              revealStart: node.startIndex,
              revealEndBeforeChild: tpSpan?.start,
              revealEndAfterChild: tpSpan?.end,
            });
          }
        }
      }

      // 1. Base classes (multi-select)
      const bases = getSectionItems(node, "bases");
      if (bases.length > 0) {
        const baseNames = bases
          .map((b) => textForRange(b.startIndex, b.endIndex, code) || b.type)
          .filter(Boolean);
        const body = getSectionFirstItem(node, "body");
        const spanStart = body ? body.startIndex : node.startIndex;
        const spanEnd = body ? body.endIndex : node.endIndex;
        const optionPool = buildMultiSelectOptionPool(
          baseNames,
          code,
          spanStart,
          spanEnd
        );
        const basesSpan = getSectionSpan(node, "bases");
        qs.push({
          kind: "class_bases_multi",
          stem: "Which are base classes of this class?",
          answerLabel: baseNames[0] ?? "base",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "class.bases-multi",
          questionType: "multi",
          multiCorrect: baseNames,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: basesSpan?.start,
          revealEndAfterChild: basesSpan?.end,
        });
      }

      // 2. Metaclass (from keywords like metaclass=X)
      // Use proper field access for robustness
      const keywords = getSectionItems(node, "keywords");
      for (const kw of keywords) {
        const children = kw.namedChildren || [];
        // Prefer curated section access, fallback to first identifier
        const keyNode =
          getSectionFirstItem(kw, "name") ||
          children.find((c) => c.type === "identifier");
        // Prefer curated section access, fallback to last named child
        const valueNode =
          getSectionFirstItem(kw, "value") ||
          (children.length > 0 ? children[children.length - 1] : undefined);

        const keyText =
          keyNode && textForRange(keyNode.startIndex, keyNode.endIndex, code);
        if (keyText === "metaclass" && valueNode && valueNode !== keyNode) {
          const valueText = (
            textForRange(valueNode.startIndex, valueNode.endIndex, code) ||
            valueNode.type
          ).trim();
          qs.push({
            kind: "class_metaclass",
            stem: "What is the metaclass of this class?",
            answerLabel: valueText,
            options: buildDistractors(valueText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: valueNode.type,
                start: valueNode.startIndex,
                end: valueNode.endIndex,
                path: computeAstPath(root, valueNode),
              },
            ],
            generatorRule: "class.metaclass",
          });
        }
      }

      return qs;
    },
  ],
  decorated_definition: [
    ({ root, node, code, sourceRef, profile }) => {
      const qs: Q11[] = [];

      // Decorator names (multi-select)
      const decorators = getSectionItems(node, "decorators");
      if (decorators.length > 0) {
        const decoratorNames = decorators.map((d) => {
          const nameNode = getSectionFirstItem(d, "name");
          if (nameNode) {
            return (
              textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
              nameNode.type
            );
          }
          // Fallback: extract first identifier or dotted_name from decorator
          const firstId = (d.namedChildren || []).find(
            (c) =>
              c.type === "identifier" ||
              c.type === "dotted_name" ||
              c.type === "attribute"
          );
          if (firstId) {
            return (
              textForRange(firstId.startIndex, firstId.endIndex, code) ||
              firstId.type
            );
          }
          // Last resort: full decorator text without @
          const full =
            textForRange(d.startIndex, d.endIndex, code) || d.type;
          return full.replace(/^@/, "").split("(")[0];
        });
        const validNames = decoratorNames.filter(Boolean);
        if (validNames.length > 0) {
          // Use inner def's body span for better distractors
          const innerDef = (node.namedChildren || []).find(
            (c) =>
              c.type === "function_definition" || c.type === "class_definition"
          );
          const innerBody = innerDef
            ? getSectionFirstItem(innerDef, "body")
            : null;
          const spanStart = innerBody ? innerBody.startIndex : node.startIndex;
          const spanEnd = innerBody ? innerBody.endIndex : node.endIndex;
          const optionPool = buildMultiSelectOptionPool(
            validNames,
            code,
            spanStart,
            spanEnd
          );
          const decoSpan = getSectionSpan(node, "decorators");
          qs.push({
            kind: "decorators_multi",
            stem: "Which decorators are applied to this definition?",
            answerLabel: validNames[0] ?? "decorator",
            options: optionPool,
            sourceRefs: [sourceRef],
            generatorRule: "decorated.decorators-multi",
            questionType: "multi",
            multiCorrect: validNames,
            optionPool,
            revealStart: node.startIndex,
            revealEndBeforeChild: decoSpan?.start,
            revealEndAfterChild: decoSpan?.end,
          });
        }
      }

      // Decorator arguments (for each decorator that has args)
      for (const d of decorators) {
        const decoArgs = getSectionItems(d, "args");
        if (decoArgs.length === 0) continue;

        const decoNameNode = getSectionFirstItem(d, "name");
        const decoName = decoNameNode
          ? textForRange(decoNameNode.startIndex, decoNameNode.endIndex, code)
          : "decorator";

        // Positional args (non-keyword_argument children)
        const positionalArgs = decoArgs.filter(
          (a) => a.type !== "keyword_argument"
        );
        for (let i = 0; i < positionalArgs.length; i++) {
          const arg = positionalArgs[i];
          const argText =
            textForRange(arg.startIndex, arg.endIndex, code) || arg.type;
          qs.push({
            kind: "decorator-arg-positional",
            stem: `What is argument #${i + 1} of @${decoName}?`,
            answerLabel: argText,
            options: buildDistractors(argText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: arg.type,
                start: arg.startIndex,
                end: arg.endIndex,
                path: computeAstPath(root, arg),
              },
            ],
            generatorRule: "decorator.pos-arg",
          });
        }

        // Keyword args
        const kwArgs = decoArgs.filter((a) => a.type === "keyword_argument");
        for (const kw of kwArgs) {
          const children = kw.namedChildren || [];
          const keyNode =
            getSectionFirstItem(kw, "name") ||
            children.find((c) => c.type === "identifier");
          const valueNode =
            getSectionFirstItem(kw, "value") ||
            (children.length > 0 ? children[children.length - 1] : undefined);

          if (keyNode && valueNode && valueNode !== keyNode) {
            const keyText =
              textForRange(keyNode.startIndex, keyNode.endIndex, code) || "key";
            const valueText =
              textForRange(valueNode.startIndex, valueNode.endIndex, code) ||
              valueNode.type;
            qs.push({
              kind: "decorator-arg-keyword",
              stem: `What is the value of ${keyText}= in @${decoName}?`,
              answerLabel: valueText,
              options: buildDistractors(valueText, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: valueNode.type,
                  start: valueNode.startIndex,
                  end: valueNode.endIndex,
                  path: computeAstPath(root, valueNode),
                },
              ],
              generatorRule: "decorator.kwarg-value",
            });
          }
        }
      }

      // Also generate questions for the inner function/class definition
      const innerDef = (node.namedChildren || []).find(
        (c) =>
          c.type === "function_definition" || c.type === "class_definition"
      );
      if (innerDef) {
        qs.push(...generateQuestionsV11(root, innerDef, profile, code));
      }

      return qs;
    },
  ],
  lambda: [
    ({ root, node, code, sourceRef }) => {
      const params = getSectionItems(node, "args");
      if (params.length === 0) return [];

      const names: string[] = [];
      for (const p of params) {
        const nameNode = (p.namedChildren || []).find(
          (c) => c.type === "identifier"
        );
        if (nameNode) {
          const nameText =
            textForRange(nameNode.startIndex, nameNode.endIndex, code) ||
            "param";
          names.push(nameText);
        } else {
          const raw =
            textForRange(p.startIndex, p.endIndex, code) || p.type || "param";
          names.push(raw);
        }
      }

      if (names.length === 0) return [];

      const body = getSectionFirstItem(node, "body");
      const spanStart = body ? body.startIndex : node.startIndex;
      const spanEnd = body ? body.endIndex : node.endIndex;
      const optionPool = buildMultiSelectOptionPool(
        names,
        code,
        spanStart,
        spanEnd
      );
      const argsSpan = getSectionSpan(node, "args");

      // Lambda-only fallback guard: if too many params (> 10), fall back to single-select
      const MAX_MULTI_OPTIONS = 10;
      if (names.length > MAX_MULTI_OPTIONS) {
        // Fallback to single-select for first parameter
        return [
          {
            kind: "lambda_params_single",
            stem: "What is the first parameter of this lambda?",
            answerLabel: names[0],
            options: buildDistractors(names[0], { code }),
            sourceRefs: [sourceRef],
            generatorRule: "lambda.params-single-fallback",
            revealStart: node.startIndex,
            revealEndBeforeChild: argsSpan?.start,
            revealEndAfterChild: argsSpan?.end,
          },
        ];
      }

      return [
        {
          kind: "lambda_params_multi",
          stem: "Which are parameters of this lambda?",
          answerLabel: names[0] ?? "param",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "lambda.params-multi",
          questionType: "multi",
          multiCorrect: names,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: argsSpan?.start,
          revealEndAfterChild: argsSpan?.end,
        },
      ];
    },
  ],
  if_statement: [headerRule],
  elif_clause: [headerRule],
  else_clause: [headerRule],
  while_statement: [headerRule],
  for_statement: [headerRule],

  // Enhanced with_statement with context manager binding questions
  with_statement: [
    headerRule,
    ({ root, node, code, sourceRef }) => {
      const items = getSectionItems(node, "items");
      if (items.length === 0) return;
      const qs: Q11[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const context = getSectionFirstItem(item, "context");
        const alias = getSectionFirstItem(item, "alias");

        if (context) {
          const contextText =
            textForRange(context.startIndex, context.endIndex, code) || context.type;
          qs.push({
            kind: "with-context",
            stem: items.length > 1
              ? `What is the context manager expression #${i + 1}?`
              : "What is the context manager expression?",
            answerLabel: contextText,
            options: buildDistractors(contextText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: context.type,
                start: context.startIndex,
                end: context.endIndex,
                path: computeAstPath(root, context),
              },
            ],
            generatorRule: "with.context",
          });
        }

        if (alias) {
          const aliasText =
            textForRange(alias.startIndex, alias.endIndex, code) || alias.type;
          qs.push({
            kind: "with-binding",
            stem: items.length > 1
              ? `What is the binding name (as ...) for context manager #${i + 1}?`
              : "What is the binding name (as ...)?",
            answerLabel: aliasText,
            options: buildDistractors(aliasText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: alias.type,
                start: alias.startIndex,
                end: alias.endIndex,
                path: computeAstPath(root, alias),
              },
            ],
            generatorRule: "with.binding",
          });
        }
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  try_statement: [headerRule],

  // Enhanced except_clause with exception type and binding name questions
  except_clause: [
    headerRule,
    ({ root, node, code, sourceRef }) => {
      const exceptionType = getSectionFirstItem(node, "type");
      const bindingName = getSectionFirstItem(node, "name");
      const qs: Q11[] = [];

      if (exceptionType) {
        const typeText =
          textForRange(exceptionType.startIndex, exceptionType.endIndex, code) ||
          exceptionType.type;
        qs.push({
          kind: "except-type",
          stem: "What exception type is being caught?",
          answerLabel: typeText,
          options: buildDistractors(typeText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: exceptionType.type,
              start: exceptionType.startIndex,
              end: exceptionType.endIndex,
              path: computeAstPath(root, exceptionType),
            },
          ],
          generatorRule: "except.type",
        });
      }

      if (bindingName) {
        const nameText =
          textForRange(bindingName.startIndex, bindingName.endIndex, code) ||
          bindingName.type;
        qs.push({
          kind: "except-binding",
          stem: "What is the binding name for the caught exception (as ...)?",
          answerLabel: nameText,
          options: buildDistractors(nameText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: bindingName.type,
              start: bindingName.startIndex,
              end: bindingName.endIndex,
              path: computeAstPath(root, bindingName),
            },
          ],
          generatorRule: "except.binding",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  finally_clause: [headerRule],
  match_statement: [headerRule],
  match_stmt: [headerRule],

  // Enhanced case_clause with pattern-specific questions
  case_clause: [
    headerRule,
    ({ root, node, code, sourceRef }) => {
      const pattern = getSectionFirstItem(node, "pattern");
      const guard = getSectionFirstItem(node, "guard");
      const qs: Q11[] = [];

      if (pattern) {
        const patternText =
          textForRange(pattern.startIndex, pattern.endIndex, code) || pattern.type;
        qs.push({
          kind: "case-pattern",
          stem: "What pattern is being matched?",
          answerLabel: patternText,
          options: buildDistractors(patternText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: pattern.type,
              start: pattern.startIndex,
              end: pattern.endIndex,
              path: computeAstPath(root, pattern),
            },
          ],
          generatorRule: "case.pattern",
        });

        // For as_pattern, ask about the binding name
        if (pattern.type === "as_pattern") {
          const bindingName = getSectionFirstItem(pattern, "name");
          if (bindingName) {
            const nameText =
              textForRange(bindingName.startIndex, bindingName.endIndex, code) ||
              bindingName.type;
            qs.push({
              kind: "case-binding",
              stem: "What is the binding name in this pattern (as ...)?",
              answerLabel: nameText,
              options: buildDistractors(nameText, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: bindingName.type,
                  start: bindingName.startIndex,
                  end: bindingName.endIndex,
                  path: computeAstPath(root, bindingName),
                },
              ],
              generatorRule: "case.binding",
            });
          }
        }

        // For class_pattern, ask about the class name
        if (pattern.type === "class_pattern") {
          const className = getSectionFirstItem(pattern, "class");
          if (className) {
            const classText =
              textForRange(className.startIndex, className.endIndex, code) ||
              className.type;
            qs.push({
              kind: "case-class",
              stem: "Which class is being matched in this pattern?",
              answerLabel: classText,
              options: buildDistractors(classText, { code }),
              sourceRefs: [
                sourceRef,
                {
                  nodeType: className.type,
                  start: className.startIndex,
                  end: className.endIndex,
                  path: computeAstPath(root, className),
                },
              ],
              generatorRule: "case.class",
            });
          }
        }
      }

      if (guard) {
        const guardText =
          textForRange(guard.startIndex, guard.endIndex, code) || guard.type;
        qs.push({
          kind: "case-guard",
          stem: "What is the guard condition?",
          answerLabel: guardText,
          options: buildDistractors(guardText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: guard.type,
              start: guard.startIndex,
              end: guard.endIndex,
              path: computeAstPath(root, guard),
            },
          ],
          generatorRule: "case.guard",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],
  case_block: [headerRule],

  // Walrus operator (:=)
  assignment_expression: [
    ({ root, node, code, sourceRef }) => {
      const target = getSectionFirstItem(node, "target");
      const value = getSectionFirstItem(node, "value");
      const qs: Q11[] = [];

      if (target) {
        const targetText =
          textForRange(target.startIndex, target.endIndex, code) || target.type;
        qs.push({
          kind: "walrus-target",
          stem: "What variable is being assigned with :=?",
          answerLabel: targetText,
          options: buildDistractors(targetText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: target.type,
              start: target.startIndex,
              end: target.endIndex,
              path: computeAstPath(root, target),
            },
          ],
          generatorRule: "walrus.target",
        });
      }

      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        qs.push({
          kind: "walrus-value",
          stem: "What value is being assigned with :=?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: value.type,
              start: value.startIndex,
              end: value.endIndex,
              path: computeAstPath(root, value),
            },
          ],
          generatorRule: "walrus.value",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // List comprehension
  list_comprehension: [
    ({ root, node, code, sourceRef }) => {
      const output = getSectionFirstItem(node, "output");
      const fors = getSectionItems(node, "fors");
      const ifs = getSectionItems(node, "ifs");
      const qs: Q11[] = [];

      if (output) {
        const outputText =
          textForRange(output.startIndex, output.endIndex, code) || output.type;
        qs.push({
          kind: "comprehension-output",
          stem: "What is the output expression of this list comprehension?",
          answerLabel: outputText,
          options: buildDistractors(outputText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: output.type,
              start: output.startIndex,
              end: output.endIndex,
              path: computeAstPath(root, output),
            },
          ],
          generatorRule: "listcomp.output",
        });
      }

      for (let i = 0; i < fors.length; i++) {
        const forClause = fors[i];
        const forText =
          textForRange(forClause.startIndex, forClause.endIndex, code) || "for clause";
        qs.push({
          kind: "comprehension-for",
          stem: fors.length > 1
            ? `What is the for-clause #${i + 1}?`
            : "What is the for-clause in this comprehension?",
          answerLabel: forText,
          options: buildDistractors(forText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: forClause.type,
              start: forClause.startIndex,
              end: forClause.endIndex,
              path: computeAstPath(root, forClause),
            },
          ],
          generatorRule: "listcomp.for",
        });
      }

      for (let i = 0; i < ifs.length; i++) {
        const ifClause = ifs[i];
        const ifText =
          textForRange(ifClause.startIndex, ifClause.endIndex, code) || "if clause";
        qs.push({
          kind: "comprehension-if",
          stem: ifs.length > 1
            ? `What is the filter condition #${i + 1}?`
            : "What is the filter condition (if clause)?",
          answerLabel: ifText,
          options: buildDistractors(ifText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: ifClause.type,
              start: ifClause.startIndex,
              end: ifClause.endIndex,
              path: computeAstPath(root, ifClause),
            },
          ],
          generatorRule: "listcomp.if",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // Set comprehension
  set_comprehension: [
    ({ root, node, code, sourceRef }) => {
      const elt = getSectionFirstItem(node, "elt");
      const generators = getSectionItems(node, "generators");
      const qs: Q11[] = [];

      if (elt) {
        const eltText =
          textForRange(elt.startIndex, elt.endIndex, code) || elt.type;
        qs.push({
          kind: "comprehension-element",
          stem: "What is the element expression of this set comprehension?",
          answerLabel: eltText,
          options: buildDistractors(eltText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: elt.type,
              start: elt.startIndex,
              end: elt.endIndex,
              path: computeAstPath(root, elt),
            },
          ],
          generatorRule: "setcomp.element",
        });
      }

      for (let i = 0; i < generators.length; i++) {
        const gen = generators[i];
        const genText =
          textForRange(gen.startIndex, gen.endIndex, code) || gen.type;
        qs.push({
          kind: "comprehension-generator",
          stem: generators.length > 1
            ? `What is generator clause #${i + 1}?`
            : "What is the generator clause?",
          answerLabel: genText,
          options: buildDistractors(genText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: gen.type,
              start: gen.startIndex,
              end: gen.endIndex,
              path: computeAstPath(root, gen),
            },
          ],
          generatorRule: "setcomp.generator",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // Generator expression
  generator_expression: [
    ({ root, node, code, sourceRef }) => {
      const elt = getSectionFirstItem(node, "elt");
      const generators = getSectionItems(node, "generators");
      const qs: Q11[] = [];

      if (elt) {
        const eltText =
          textForRange(elt.startIndex, elt.endIndex, code) || elt.type;
        qs.push({
          kind: "generator-element",
          stem: "What is the yielded expression of this generator expression?",
          answerLabel: eltText,
          options: buildDistractors(eltText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: elt.type,
              start: elt.startIndex,
              end: elt.endIndex,
              path: computeAstPath(root, elt),
            },
          ],
          generatorRule: "genexp.element",
        });
      }

      for (let i = 0; i < generators.length; i++) {
        const gen = generators[i];
        const genText =
          textForRange(gen.startIndex, gen.endIndex, code) || gen.type;
        qs.push({
          kind: "generator-clause",
          stem: generators.length > 1
            ? `What is generator clause #${i + 1}?`
            : "What is the generator clause?",
          answerLabel: genText,
          options: buildDistractors(genText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: gen.type,
              start: gen.startIndex,
              end: gen.endIndex,
              path: computeAstPath(root, gen),
            },
          ],
          generatorRule: "genexp.generator",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // Dictionary comprehension
  dictionary_comprehension: [
    ({ root, node, code, sourceRef }) => {
      const key = getSectionFirstItem(node, "key");
      const value = getSectionFirstItem(node, "value");
      const generators = getSectionItems(node, "generators");
      const qs: Q11[] = [];

      if (key) {
        const keyText =
          textForRange(key.startIndex, key.endIndex, code) || key.type;
        qs.push({
          kind: "dictcomp-key",
          stem: "What is the key expression of this dict comprehension?",
          answerLabel: keyText,
          options: buildDistractors(keyText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: key.type,
              start: key.startIndex,
              end: key.endIndex,
              path: computeAstPath(root, key),
            },
          ],
          generatorRule: "dictcomp.key",
        });
      }

      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        qs.push({
          kind: "dictcomp-value",
          stem: "What is the value expression of this dict comprehension?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: value.type,
              start: value.startIndex,
              end: value.endIndex,
              path: computeAstPath(root, value),
            },
          ],
          generatorRule: "dictcomp.value",
        });
      }

      for (let i = 0; i < generators.length; i++) {
        const gen = generators[i];
        const genText =
          textForRange(gen.startIndex, gen.endIndex, code) || gen.type;
        qs.push({
          kind: "dictcomp-generator",
          stem: generators.length > 1
            ? `What is generator clause #${i + 1}?`
            : "What is the generator clause?",
          answerLabel: genText,
          options: buildDistractors(genText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: gen.type,
              start: gen.startIndex,
              end: gen.endIndex,
              path: computeAstPath(root, gen),
            },
          ],
          generatorRule: "dictcomp.generator",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // Global statement
  global_statement: [
    ({ node, code, sourceRef }) => {
      const names = getSectionItems(node, "names");
      const nameTexts = names
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);

      if (nameTexts.length === 0) return;

      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const optionPool = buildMultiSelectOptionPool(nameTexts, code, spanStart, spanEnd);
      const namesSpan = getSectionSpan(node, "names");

      return [
        {
          kind: "global-names",
          stem: "Which variables are declared global?",
          answerLabel: nameTexts[0] ?? "global",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "global.names",
          questionType: "multi",
          multiCorrect: nameTexts,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: namesSpan?.start,
          revealEndAfterChild: namesSpan?.end,
        },
      ];
    },
  ],
  global_stmt: [
    ({ node, code, sourceRef }) => {
      const names = getSectionItems(node, "names");
      const nameTexts = names
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);

      if (nameTexts.length === 0) return;

      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const optionPool = buildMultiSelectOptionPool(nameTexts, code, spanStart, spanEnd);
      const namesSpan = getSectionSpan(node, "names");

      return [
        {
          kind: "global-names",
          stem: "Which variables are declared global?",
          answerLabel: nameTexts[0] ?? "global",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "global.names",
          questionType: "multi",
          multiCorrect: nameTexts,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: namesSpan?.start,
          revealEndAfterChild: namesSpan?.end,
        },
      ];
    },
  ],

  // Nonlocal statement
  nonlocal_statement: [
    ({ node, code, sourceRef }) => {
      const names = getSectionItems(node, "names");
      const nameTexts = names
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);

      if (nameTexts.length === 0) return;

      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const optionPool = buildMultiSelectOptionPool(nameTexts, code, spanStart, spanEnd);
      const namesSpan = getSectionSpan(node, "names");

      return [
        {
          kind: "nonlocal-names",
          stem: "Which variables are declared nonlocal?",
          answerLabel: nameTexts[0] ?? "nonlocal",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "nonlocal.names",
          questionType: "multi",
          multiCorrect: nameTexts,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: namesSpan?.start,
          revealEndAfterChild: namesSpan?.end,
        },
      ];
    },
  ],
  nonlocal_stmt: [
    ({ node, code, sourceRef }) => {
      const names = getSectionItems(node, "names");
      const nameTexts = names
        .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
        .filter(Boolean);

      if (nameTexts.length === 0) return;

      const spanStart = node.startIndex - 200 > 0 ? node.startIndex - 200 : 0;
      const spanEnd = node.endIndex + 200;
      const optionPool = buildMultiSelectOptionPool(nameTexts, code, spanStart, spanEnd);
      const namesSpan = getSectionSpan(node, "names");

      return [
        {
          kind: "nonlocal-names",
          stem: "Which variables are declared nonlocal?",
          answerLabel: nameTexts[0] ?? "nonlocal",
          options: optionPool,
          sourceRefs: [sourceRef],
          generatorRule: "nonlocal.names",
          questionType: "multi",
          multiCorrect: nameTexts,
          optionPool,
          revealStart: node.startIndex,
          revealEndBeforeChild: namesSpan?.start,
          revealEndAfterChild: namesSpan?.end,
        },
      ];
    },
  ],

  // F-strings with interpolations
  f_string: [
    ({ root, node, code, sourceRef }) => {
      // Find interpolation nodes (format expressions inside f-strings)
      const interpolations = (node.namedChildren || []).filter(
        (c) =>
          c.type === "interpolation" ||
          c.type === "format_expression" ||
          c.type === "string_interpolation"
      );

      if (interpolations.length === 0) return;

      const qs: Q11[] = [];

      for (let i = 0; i < interpolations.length; i++) {
        const interp = interpolations[i];
        const interpText =
          textForRange(interp.startIndex, interp.endIndex, code) || interp.type;

        qs.push({
          kind: "fstring-interpolation",
          stem:
            interpolations.length > 1
              ? `What is the interpolated expression #${i + 1}?`
              : "What is the interpolated expression in this f-string?",
          answerLabel: interpText,
          options: buildDistractors(interpText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: interp.type,
              start: interp.startIndex,
              end: interp.endIndex,
              path: computeAstPath(root, interp),
            },
          ],
          generatorRule: "fstring.interpolation",
        });

        // Check for format spec (e.g., :.2f)
        const formatSpec = (interp.namedChildren || []).find(
          (c) => c.type === "format_specifier" || c.type === "format_spec"
        );
        if (formatSpec) {
          const specText =
            textForRange(formatSpec.startIndex, formatSpec.endIndex, code) ||
            formatSpec.type;
          qs.push({
            kind: "fstring-format-spec",
            stem: "What is the format specifier?",
            answerLabel: specText,
            options: buildDistractors(specText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: formatSpec.type,
                start: formatSpec.startIndex,
                end: formatSpec.endIndex,
                path: computeAstPath(root, formatSpec),
              },
            ],
            generatorRule: "fstring.format-spec",
          });
        }
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],
  formatted_string: [
    ({ root, node, code, sourceRef }) => {
      // Same as f_string, handles alternative node type names
      const interpolations = (node.namedChildren || []).filter(
        (c) =>
          c.type === "interpolation" ||
          c.type === "format_expression" ||
          c.type === "string_interpolation"
      );

      if (interpolations.length === 0) return;

      const qs: Q11[] = [];

      for (let i = 0; i < interpolations.length; i++) {
        const interp = interpolations[i];
        const interpText =
          textForRange(interp.startIndex, interp.endIndex, code) || interp.type;

        qs.push({
          kind: "fstring-interpolation",
          stem:
            interpolations.length > 1
              ? `What is the interpolated expression #${i + 1}?`
              : "What is the interpolated expression in this f-string?",
          answerLabel: interpText,
          options: buildDistractors(interpText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: interp.type,
              start: interp.startIndex,
              end: interp.endIndex,
              path: computeAstPath(root, interp),
            },
          ],
          generatorRule: "fstring.interpolation",
        });

        const formatSpec = (interp.namedChildren || []).find(
          (c) => c.type === "format_specifier" || c.type === "format_spec"
        );
        if (formatSpec) {
          const specText =
            textForRange(formatSpec.startIndex, formatSpec.endIndex, code) ||
            formatSpec.type;
          qs.push({
            kind: "fstring-format-spec",
            stem: "What is the format specifier?",
            answerLabel: specText,
            options: buildDistractors(specText, { code }),
            sourceRefs: [
              sourceRef,
              {
                nodeType: formatSpec.type,
                start: formatSpec.startIndex,
                end: formatSpec.endIndex,
                path: computeAstPath(root, formatSpec),
              },
            ],
            generatorRule: "fstring.format-spec",
          });
        }
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // Yield expression (standalone or in expression statement)
  expression_statement: [
    ({ root, node, code, sourceRef, profile }) => {
      const yieldNode = (node.namedChildren || []).find(
        (c) =>
          c.type === "yield" ||
          c.type === "yield_expression" ||
          c.type === "yield_expr" ||
          c.type === "yield_statement"
      );
      if (!yieldNode) return;

      if (profile === "shallow") {
        const full = (textForRange(node.startIndex, node.endIndex, code) ?? "yield").trimEnd();
        return [
          {
            kind: "yield_line",
            stem: "Write the full yield statement",
            answerLabel: full,
            options: [],
            sourceRefs: [sourceRef],
            generatorRule: "yield.line",
            revealStart: node.startIndex,
            revealEndBeforeChild: node.startIndex,
            revealEndAfterChild: node.endIndex,
          },
        ];
      }

      return generateQuestionsV11(root, yieldNode, profile, code);
    },
  ],
  yield: [
    ({ root, node, code, sourceRef }) => {
      const value = getSectionFirstItem(node, "value");
      const qs: Q11[] = [];

      // Check if it's yield from
      const isFrom = isYieldFrom(node, code);

      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        qs.push({
          kind: isFrom ? "yield-from-value" : "yield-value",
          stem: isFrom
            ? "What iterable is being yielded from?"
            : "What value is being yielded?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: value.type,
              start: value.startIndex,
              end: value.endIndex,
              path: computeAstPath(root, value),
            },
          ],
          generatorRule: isFrom ? "yield.from-value" : "yield.value",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],
  yield_expression: [
    ({ root, node, code, sourceRef }) => {
      const value = getSectionFirstItem(node, "value");
      const qs: Q11[] = [];

      const isFrom = isYieldFrom(node, code);

      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        qs.push({
          kind: isFrom ? "yield-from-value" : "yield-value",
          stem: isFrom
            ? "What iterable is being yielded from?"
            : "What value is being yielded?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: value.type,
              start: value.startIndex,
              end: value.endIndex,
              path: computeAstPath(root, value),
            },
          ],
          generatorRule: isFrom ? "yield.from-value" : "yield.value",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],

  // Annotated assignment (class variables with type annotations: x: int = 5)
  annotated_assignment: [
    ({ root, node, code, sourceRef }) => {
      const target = getSectionFirstItem(node, "target");
      const annotation = getSectionFirstItem(node, "annotation");
      const value = getSectionFirstItem(node, "value");
      const qs: Q11[] = [];

      if (target) {
        const targetText =
          textForRange(target.startIndex, target.endIndex, code) || target.type;
        qs.push({
          kind: "annotated-var-name",
          stem: "What is the variable name?",
          answerLabel: targetText,
          options: buildDistractors(targetText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: target.type,
              start: target.startIndex,
              end: target.endIndex,
              path: computeAstPath(root, target),
            },
          ],
          generatorRule: "annotated.target",
        });
      }

      if (annotation) {
        const annotationText =
          textForRange(annotation.startIndex, annotation.endIndex, code) ||
          annotation.type;
        qs.push({
          kind: "annotated-var-type",
          stem: "What is the type annotation?",
          answerLabel: annotationText,
          options: buildDistractors(annotationText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: annotation.type,
              start: annotation.startIndex,
              end: annotation.endIndex,
              path: computeAstPath(root, annotation),
            },
          ],
          generatorRule: "annotated.type",
        });
      }

      if (value) {
        const valueText =
          textForRange(value.startIndex, value.endIndex, code) || value.type;
        qs.push({
          kind: "annotated-var-value",
          stem: "What is the default value?",
          answerLabel: valueText,
          options: buildDistractors(valueText, { code }),
          sourceRefs: [
            sourceRef,
            {
              nodeType: value.type,
              start: value.startIndex,
              end: value.endIndex,
              path: computeAstPath(root, value),
            },
          ],
          generatorRule: "annotated.value",
        });
      }

      return qs.length > 0 ? qs : undefined;
    },
  ],
};

// ============================================================================
// Node Type Aliases: Handle tree-sitter grammar variations
// ============================================================================
// Different tree-sitter-python versions/forks may use different node type names.
// We alias common variations to the canonical rule name.

// named_expression is an alternative name for assignment_expression (walrus operator)
if (rules.assignment_expression) {
  rules.named_expression = rules.assignment_expression;
}

// comparison might be used instead of comparison_operator
if (rules.comparison_operator) {
  rules.comparison = rules.comparison_operator;
}

// yield_expr might be an alias
if (rules.yield) {
  rules.yield_expr = rules.yield;
}
if (rules.yield_expression) {
  rules.yield_expr = rules.yield_expr || rules.yield_expression;
}

// async_function_definition should use the same rules as function_definition
if (rules.function_definition) {
  rules.async_function_definition = rules.function_definition;
}

export function generateQuestionsV11(
  root: TreeSitterAstNode,
  node: TreeSitterAstNode,
  profile: DecompositionLevel,
  code?: string
): Q11[] {
  const src: SourceRef = {
    nodeType: node.type,
    start: node.startIndex,
    end: node.endIndex,
    path: computeAstPath(root, node),
    preview: textForRange(node.startIndex, node.endIndex, code)?.slice(0, 120),
  };
  const applyRules = rules[node.type] || [];

  // Accumulate questions from ALL matching rules, not just the first one.
  // This allows stacked rules like [headerRule, enhancedRule] to both contribute.
  const allQuestions: Q11[] = [];
  for (const rule of applyRules) {
    const qs = rule({ root, node, code, sourceRef: src, profile });
    if (qs && qs.length) {
      allQuestions.push(...qs);
    }
  }
  return allQuestions;
}

// ============================================================================
// Statement Anchors
// ============================================================================

const ANCHOR_NODE_TYPES = new Set<string>([
  "assignment",
  "augmented_assignment",
  "annotated_assignment",
  "class_definition",
  "function_definition",
  "async_function_definition",
  "decorated_definition",
  "elif_clause",
  "else_clause",
  "except_clause",
  "finally_clause",
  "match_statement",
  "match_stmt",
  "case_clause",
  "case_block",
  "type_alias",
  "type_alias_statement",
]);

export const isAnchorNode = (node: TreeSitterAstNode): boolean => {
  if (ANCHOR_NODE_TYPES.has(node.type)) return true;
  if (node.type.endsWith("_statement")) return true;
  return false;
};

const getStatementChildren = (node: TreeSitterAstNode): TreeSitterAstNode[] =>
  (node.namedChildren || []).filter(
    (c) => c.type !== "comment" && !isDocstringNode(c, node)
  );

const BODY_NODE_TYPES = new Set(["block", "suite"]);

const statementHasAnchor = (node: TreeSitterAstNode): boolean => {
  const stack = (node.namedChildren || []).slice();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (BODY_NODE_TYPES.has(cur.type)) continue;
    if (isAnchorNode(cur)) return true;
    if (cur.namedChildren && cur.namedChildren.length) {
      stack.push(...cur.namedChildren);
    }
  }
  return false;
};

const hasQuizChildren = (node: TreeSitterAstNode): boolean => {
  const stack = (node.namedChildren || []).slice();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (BODY_NODE_TYPES.has(cur.type)) {
      const statements = getStatementChildren(cur);
      for (const stmt of statements) {
        if (isAnchorNode(stmt) || statementHasAnchor(stmt)) return true;
      }
      continue;
    }
    if (cur.namedChildren && cur.namedChildren.length) {
      stack.push(...cur.namedChildren);
    }
  }
  return false;
};

const isHeaderQuestion = (q: QuizQuestion): boolean =>
  q.stem === "Write the full header line" || q.generatorRule === "header.line";

const spanForQuestion = (
  q: QuizQuestion
): { start: number; end: number } | undefined => {
  if (
    typeof q.revealEndBeforeChild === "number" &&
    typeof q.revealEndAfterChild === "number" &&
    Number.isFinite(q.revealEndBeforeChild) &&
    Number.isFinite(q.revealEndAfterChild) &&
    q.revealEndAfterChild >= q.revealEndBeforeChild
  ) {
    return {
      start: q.revealEndBeforeChild,
      end: q.revealEndAfterChild,
    };
  }
  if (Array.isArray(q.sourceRefs) && q.sourceRefs.length > 0) {
    let best = q.sourceRefs[0];
    for (const ref of q.sourceRefs) {
      if (ref.end - ref.start < best.end - best.start) best = ref;
    }
    return { start: best.start, end: best.end };
  }
  return undefined;
};

/**
 * Overlap Guard: Removes redundant or nested quiz questions.
 *
 * Policy:
 * 1. DUPLICATES: If two questions have identical span + stem + answer, drop the duplicate.
 *
 * 2. NESTED (containment): Questions are sorted smallest-first. If a larger question's
 *    span fully contains a smaller question's span, drop the larger one. This keeps
 *    the more specific question and removes the vague "umbrella" question.
 *    Example: Keep "What is the left operand?" (span 3-4), drop "What is the condition?" (span 3-8).
 *
 * 3. HEADER EXCEPTION: Header questions ("Write the full header line") are exempt from
 *    the nested-drop rule. We want to quiz the full header even if sub-parts are also quizzed.
 *    Example: Keep both "Write the full header line: if x > 5:" AND "What is the condition?"
 *
 * Why this matters:
 * Without this guard, quiz generation could produce overlapping questions where one
 * asks about an entire expression and another asks about a sub-part. The guard ensures
 * questions are specific and non-redundant.
 *
 * Debugging tip: If a question unexpectedly disappears, check if its span contains
 * a smaller question's span — that would cause it to be dropped.
 */
const applyQuestionOverlapGuard = (steps: EngineStep[]): void => {
  const entries: Array<{
    question: QuizQuestion;
    span: { start: number; end: number };
    isHeader: boolean;
  }> = [];

  const collect = (step: EngineStep) => {
    if (step.quiz?.questions?.length) {
      for (const q of step.quiz.questions) {
        const span = spanForQuestion(q);
        if (!span) continue;
        entries.push({
          question: q,
          span,
          isHeader: isHeaderQuestion(q),
        });
      }
    }
    const children = step.lesson?.childSteps || [];
    if (children.length) children.forEach(collect);
  };

  steps.forEach(collect);
  if (!entries.length) return;

  // Sort by span length (smallest first), then by start position
  const sorted = entries.slice().sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    if (lenA !== lenB) return lenA - lenB;
    return a.span.start - b.span.start;
  });

  // Use Set for O(1) duplicate detection instead of O(n) .some()
  const seenKeys = new Set<string>();
  const makeDuplicateKey = (entry: typeof entries[0]): string =>
    `${entry.span.start}:${entry.span.end}:${entry.question.stem}:${entry.question.answerLabel}`;

  const kept: typeof entries = [];
  const drop = new Set<QuizQuestion>();

  for (const entry of sorted) {
    // O(1) duplicate check using Set
    const dupKey = makeDuplicateKey(entry);
    if (seenKeys.has(dupKey)) {
      drop.add(entry.question);
      continue;
    }

    // Containment check: does this (larger) span contain any kept (smaller) span?
    // Since we process smallest-first, we only need to check if entry contains anything in kept.
    // We can't fully eliminate O(n²) here without an interval tree, but we can:
    // 1. Early exit if entry span is too small to contain anything
    // 2. Skip header questions entirely (they're exempt)
    if (!entry.isHeader && kept.length > 0) {
      const entryLen = entry.span.end - entry.span.start;
      // Only check containment if this entry is larger than the smallest kept entry
      // (kept is sorted smallest-first, so kept[0] is the smallest)
      const smallestKeptLen = kept[0].span.end - kept[0].span.start;

      if (entryLen > smallestKeptLen) {
        // Check if entry strictly contains any kept span
        const containsKept = kept.some(
          (k) =>
            entry.span.start <= k.span.start &&
            entry.span.end >= k.span.end &&
            (entry.span.start < k.span.start || entry.span.end > k.span.end)
        );
        if (containsKept) {
          drop.add(entry.question);
          continue;
        }
      }
    }

    seenKeys.add(dupKey);
    kept.push(entry);
  }

  const filter = (step: EngineStep) => {
    if (step.quiz?.questions?.length) {
      step.quiz.questions = step.quiz.questions.filter((q) => !drop.has(q));
      if (step.quiz.questions.length === 0) step.quiz = undefined;
    }
    const children = step.lesson?.childSteps || [];
    if (children.length) children.forEach(filter);
  };

  steps.forEach(filter);
};

const NO_FALLBACK_QUIZ_NODE_TYPES = new Set<string>([
  "import_from_statement",
  "import_statement",
  "function_definition",
  "class_definition",
  "if_statement",
  "elif_clause",
  "else_clause",
  "while_statement",
  "for_statement",
  "with_statement",
  "try_statement",
  "except_clause",
  "finally_clause",
  "match_statement",
  "match_stmt",
  "case_clause",
  "case_block",
]);

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
  const mappedProfile: DecompositionLevel =
    options.profile === "deep" ? "deep" : "shallow";

  const buildQuestionsForAnchor = (anchor: TreeSitterAstNode): QuizQuestion[] => {
    if (options.generateQuiz === false) return [];
    const ruleQuestions = generateQuestionsV11(root, anchor, mappedProfile, code);
    if (ruleQuestions.length) return ruleQuestions;
    if (NO_FALLBACK_QUIZ_NODE_TYPES.has(anchor.type)) return [];
    if (hasQuizChildren(anchor)) return [];
    const txt = textForNode(anchor, code);
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
            path: computeAstPath(root, anchor),
            preview: txt.slice(0, 120),
          },
        ],
        generatorRule: "shallow_statement",
      },
    ];
  };

  const buildLessonDataForAnchor = (
    anchor: TreeSitterAstNode,
    hasChildStatements: boolean,
    hasQuestions: boolean
  ): EngineStep["lesson"] | undefined => {
    switch (anchor.type) {
      case "import_statement": {
        const sections = buildCuratedSections(anchor);
        const namesGroup = sections.find((g) => g.key === "names");
        const names = (namesGroup?.items || [])
          .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
          .filter(Boolean);
        const nameText = names.length ? names.join(", ") : "module(s)";
        return {
          prompt: `We import ${nameText}.`,
          semanticRole: "import_statement",
          isDigable: false,
        };
      }

      case "import_from_statement": {
        const sections = buildCuratedSections(anchor);
        const moduleGroup = sections.find((g) => g.key === "module");
        const moduleNode = moduleGroup?.items?.[0];
        const moduleText =
          moduleNode &&
          (textForRange(moduleNode.startIndex, moduleNode.endIndex, code) ||
            moduleNode.type);
        const namesGroup = sections.find((g) => g.key === "names");
        const names = (namesGroup?.items || [])
          .map((n) => textForRange(n.startIndex, n.endIndex, code) || n.type)
          .filter(Boolean);
        let prompt = "We import from another module.";
        if (names.length && moduleText) {
          prompt = `We import ${names.join(", ")} from ${moduleText}.`;
        } else if (moduleText) {
          prompt = `We import from ${moduleText}.`;
        } else if (names.length) {
          prompt = `We import ${names.join(", ")}.`;
        }
        return {
          prompt,
          semanticRole: "import_from_statement",
          isDigable: false,
        };
      }

      case "class_definition": {
        const name = firstChildOfType(anchor, "identifier");
        const nameText = name ? textForNode(name, code) : "class";
        return {
          prompt: `We define a class named: ${nameText}`,
          semanticRole: "class_definition",
          isDigable: hasChildStatements,
        };
      }

      case "async_function_definition":
      case "function_definition": {
        const name = firstChildOfType(anchor, "identifier");
        const nameText = name ? textForNode(name, code) : "function";
        const isAsync = anchor.type === "async_function_definition";
        return {
          prompt: isAsync
            ? `We define an async function named: ${nameText}`
            : `We define a function named: ${nameText}`,
          semanticRole: "function_definition",
          isDigable: hasChildStatements,
        };
      }

      case "decorated_definition": {
        const innerFn = firstChildOfType(anchor, "function_definition");
        const innerClass = firstChildOfType(anchor, "class_definition");
        const defNode = innerFn || innerClass;
        const nameNode = defNode
          ? firstChildOfType(defNode, "identifier")
          : firstChildOfType(anchor, "identifier");
        let prompt = "We define a decorated definition.";
        if (defNode) {
          const kind = innerClass ? "class" : "function";
          const nameText = nameNode
            ? textForNode(nameNode, code)
            : kind;
          prompt = `We define a ${kind} named: ${nameText}`;
        }
        return {
          prompt,
          semanticRole: "decorated_definition",
          isDigable: hasChildStatements,
        };
      }

      case "if_statement": {
        return {
          prompt: "An if statement checks a condition.",
          semanticRole: "if_statement",
          isDigable: hasChildStatements,
        };
      }

      case "while_statement": {
        return {
          prompt: "A while loop runs as long as the condition is true.",
          semanticRole: "while_statement",
          isDigable: hasChildStatements,
        };
      }

      case "for_statement": {
        return {
          prompt: "A for loop iterates over a sequence.",
          semanticRole: "for_statement",
          isDigable: hasChildStatements,
        };
      }

      case "assignment": {
        return {
          prompt: "An assignment statement stores a value.",
          semanticRole: "assignment",
          isDigable: false,
        };
      }

      case "augmented_assignment": {
        return {
          prompt: "An augmented assignment updates a value.",
          semanticRole: "augmented_assignment",
          isDigable: false,
        };
      }

      default: {
        const label = anchor.type.replace(/_/g, " ");
        if (hasQuestions) {
          return {
            prompt: `Analyze this ${label}.`,
            semanticRole: anchor.type,
            isDigable: hasChildStatements,
          };
        }
        const prompt = anchor.type.endsWith("_statement")
          ? `Next, we have a ${anchor.type.replace("_statement", "")} statement.`
          : `Next, we have a ${label}.`;
        return {
          prompt,
          semanticRole: anchor.type,
          isDigable: hasChildStatements,
        };
      }
    }
  };

  const emitAnchorStep = (
    anchor: TreeSitterAstNode,
    hasChildStatements: boolean
  ) => {
    const questions = buildQuestionsForAnchor(anchor);
    const lessonData = buildLessonDataForAnchor(
      anchor,
      hasChildStatements,
      questions.length > 0
    );
    if (lessonData || questions.length > 0) {
      steps.push({
        id: randomString(8),
        node: anchor,
        displaySpan: displaySpanForNode(anchor),
        lesson: lessonData,
        quiz: questions.length > 0 ? { questions } : undefined,
      });
    }
  };

  const blockHasStatements = (block?: TreeSitterAstNode) =>
    Boolean(block && getStatementChildren(block).some(isAnchorNode));

  const clauseHasStatements = (clause?: TreeSitterAstNode) =>
    Boolean(clause && blockHasStatements(firstChildOfType(clause, "block")));

  const walkModule = (mod: TreeSitterAstNode) => {
    const children = getStatementChildren(mod);
    let i = 0;
    while (i < children.length) {
      const stmt = children[i];
      if (isImportStmt(stmt)) {
        // Collect contiguous imports and emit a single grouped step
        const { run, nextIndex } = collectImportRun(children, i);
        emitImportRunStep(run);
        i = nextIndex;
      } else if (isAnchorNode(stmt)) {
        walkStmt(stmt);
        i++;
      } else {
        i++;
      }
    }
  };

  const walkBlock = (block: TreeSitterAstNode) => {
    const children = getStatementChildren(block);
    let i = 0;
    while (i < children.length) {
      const stmt = children[i];
      if (isImportStmt(stmt)) {
        // Collect contiguous imports and emit a single grouped step
        const { run, nextIndex } = collectImportRun(children, i);
        emitImportRunStep(run);
        i = nextIndex;
      } else if (isAnchorNode(stmt)) {
        walkStmt(stmt);
        i++;
      } else {
        i++;
      }
    }
  };

  /**
   * Emit a virtual step for an import run with grouped quiz questions.
   * Individual imports don't get their own quiz questions.
   */
  const emitImportRunStep = (run: TreeSitterAstNode[]) => {
    if (!run.length) return;

    const first = run[0];
    const last = run[run.length - 1];
    const span = { start: first.startIndex, end: last.endIndex };

    // Create virtual node for the import group
    const virtualNode = {
      ...first,
      type: "import_group",
      startIndex: span.start,
      endIndex: span.end,
      isVirtual: true,
    };

    // Generate grouped import questions if quiz is enabled
    const questions = options.generateQuiz !== false
      ? generateImportRunQuestions(root, run, code)
      : [];

    // Build child steps for individual imports (with generateQuiz:false)
    // This enables "dig" into individual import lines for lesson view
    const childSteps: EngineStep[] = run.map((importNode) => ({
      id: randomString(8),
      node: importNode,
      displaySpan: { start: importNode.startIndex, end: importNode.endIndex },
      lesson: {
        semanticRole: importNode.type,
        prompt: importNode.type === "import_from_statement"
          ? "Import from statement."
          : "Import statement.",
        isDigable: false,
      },
      // No quiz on individual import child steps
    }));

    // Build lesson prompt
    const moduleCount = run.length;
    const lessonPrompt = moduleCount === 1
      ? "We import dependencies for this module."
      : `This block imports dependencies from ${moduleCount} import statement(s).`;

    steps.push({
      id: randomString(8),
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


  const walkStmt = (stmt: TreeSitterAstNode) => {
    if (!isAnchorNode(stmt)) return;
    switch (stmt.type) {
      case "async_function_definition":
      case "function_definition":
      case "class_definition": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "decorated_definition": {
        const innerDef =
          firstChildOfType(stmt, "function_definition") ||
          firstChildOfType(stmt, "class_definition");
        const block = innerDef
          ? firstChildOfType(innerDef, "block")
          : firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "if_statement": {
        const block = firstChildOfType(stmt, "block");
        const elifs = childrenOfType(stmt, "elif_clause");
        const elseCl = firstChildOfType(stmt, "else_clause");
        const hasChildStatements =
          blockHasStatements(block) ||
          elifs.some((e) => clauseHasStatements(e)) ||
          clauseHasStatements(elseCl);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        for (const e of elifs) walkStmt(e);
        if (elseCl) walkStmt(elseCl);
        break;
      }
      case "elif_clause":
      case "else_clause": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "while_statement":
      case "for_statement": {
        const block = firstChildOfType(stmt, "block");
        const elseCl = firstChildOfType(stmt, "else_clause");
        const hasChildStatements =
          blockHasStatements(block) || clauseHasStatements(elseCl);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        if (elseCl) walkStmt(elseCl);
        break;
      }
      case "with_statement": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "try_statement": {
        const body = firstChildOfType(stmt, "block");
        const excepts = (stmt.namedChildren || []).filter((c) =>
          c.type.includes("except")
        );
        const elseCl = firstChildOfType(stmt, "else_clause");
        const finCl = firstChildOfType(stmt, "finally_clause");
        const hasChildStatements =
          blockHasStatements(body) ||
          excepts.some((c) => clauseHasStatements(c)) ||
          clauseHasStatements(elseCl) ||
          clauseHasStatements(finCl);
        emitAnchorStep(stmt, hasChildStatements);
        if (body) walkBlock(body);
        for (const h of excepts) walkStmt(h);
        if (elseCl) walkStmt(elseCl);
        if (finCl) walkStmt(finCl);
        break;
      }
      case "except_clause":
      case "finally_clause": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      case "match_statement":
      case "match_stmt": {
        const cases = (stmt.namedChildren || []).filter(
          (c) => c.type === "case_clause" || c.type === "case_block"
        );
        const hasChildStatements = cases.some((c) => clauseHasStatements(c));
        emitAnchorStep(stmt, hasChildStatements);
        for (const c of cases) walkStmt(c);
        break;
      }
      case "case_clause":
      case "case_block": {
        const block = firstChildOfType(stmt, "block");
        const hasChildStatements = blockHasStatements(block);
        emitAnchorStep(stmt, hasChildStatements);
        if (block) walkBlock(block);
        break;
      }
      default: {
        emitAnchorStep(stmt, false);
        break;
      }
    }
  };

  const finalizeSteps = (out: EngineStep[]): EngineStep[] => {
    if (options.generateQuiz !== false) applyQuestionOverlapGuard(out);
    return out;
  };

  if (node.type === "module") {
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
  const { headerEnd } = getRevealAnchors(stmt);
  const answerText = headerAnswer(stmt, code);
  const masks = headerEnd > stmt.startIndex
    ? [{ start: stmt.startIndex, end: headerEnd }]
    : [];
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
    "else_clause",
    "while_statement",
    "for_statement",
    "with_statement",
    "try_statement",
    "except_clause",
    "finally_clause",
    "match_statement",
    "match_stmt",
    "case_clause",
    "case_block",
  ];
  const isHeaderNode = headerTypes.includes(step.node.type);

  if (isHeaderNode) {
    return headerMaskAndAnswer(step.node, code);
  }
  return { masks: [], answerText: textForNode(step.node, code) };
}

export type LessonHistoryItem = EngineStep & { action?: "next" | "dig" };

type CustomQuizCard = {
  order: number;
  type: string;
  text: string;
  action: "next" | "dig";
  question?: string;
  semanticRole?: string;
  generatorRule?: string;
  difficulty?: "easy" | "medium" | "hard";
  questionType?: "single" | "multi" | "orderedMulti";
  multiCorrect?: string[];
  multiSelectHint?: number;
  optionPool?: string[];
  sourceRef?: SourceRef;
  revealStart?: number;
  revealEndBeforeChild?: number;
  revealEndAfterChild?: number;
  /** Request more distractors for grouped imports */
  distractorPoolSize?: number;
};

export function buildCustomQuizPayload(params: {
  fileKey?: { kind: "repo" | "project"; id: string; path: string };
  root: TreeSitterAstNode;
  code: string;
  history: LessonHistoryItem[];
  lessonQueue: EngineStep[];
  currentStep: number;
}) {
  const { fileKey, root, code, history, lessonQueue, currentStep } = params;

  const bestSourceRef = (q: QuizQuestion): SourceRef | undefined => {
    if (!Array.isArray(q.sourceRefs) || q.sourceRefs.length === 0) return undefined;
    let best = q.sourceRefs[0];
    for (const ref of q.sourceRefs) {
      if (ref.end - ref.start < best.end - best.start) best = ref;
    }
    const preview = textForRange(best.start, best.end, code)?.slice(0, 120);
    return preview ? { ...best, preview } : best;
  };

  const revealSpanForCard = (
    q: QuizQuestion,
    fallback?: SourceRef
  ): { start: number; end: number } | undefined => {
    const start =
      typeof q.revealStart === "number" ? q.revealStart : fallback?.start;
    const end =
      typeof q.revealEndAfterChild === "number"
        ? q.revealEndAfterChild
        : typeof q.revealEndBeforeChild === "number"
          ? q.revealEndBeforeChild
          : fallback?.end;

    if (typeof start === "number" && typeof end === "number" && end >= start) {
      return { start, end };
    }
    return undefined;
  };

  const questionToCard = (
    step: EngineStep,
    q: QuizQuestion,
    order: number,
    action: "next" | "dig"
  ): CustomQuizCard => {
    const isMulti =
      q.questionType === "multi" ||
      (Array.isArray(q.multiCorrect) && q.multiCorrect.length > 0);
    const span = step.displaySpan ?? {
      start: step.node.startIndex,
      end: step.node.endIndex,
    };
    const snippet = code.slice(span.start, span.end).trimEnd();
    const baseRef = bestSourceRef(q);
    const revealSpan = revealSpanForCard(q, baseRef);
    const cardRef =
      baseRef && revealSpan
        ? {
            ...baseRef,
            start: revealSpan.start,
            end: revealSpan.end,
            preview: textForRange(revealSpan.start, revealSpan.end, code)?.slice(0, 120),
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
      questionType: isMulti ? "multi" : undefined,
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

  const cards: CustomQuizCard[] = [];
  let order = 0;

  const appendStepCards = (step: EngineStep, action: "next" | "dig") => {
    const questions = step.quiz?.questions || [];
    for (const q of questions) {
      cards.push(questionToCard(step, q, order++, action));
    }
    const children = step.lesson?.childSteps || [];
    for (const child of children) appendStepCards(child, action);
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
    type: "CustomQuizV1.1" as const,
    profile: "shallow" as const,
    rootNode: {
      type: root.type,
      text: textForNode(root, code),
      start: root.startIndex,
      end: root.endIndex,
      path: [] as number[],
    },
    cards,
  };
}
