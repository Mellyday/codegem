import { Parser, Language, type Node as TreeSitterNode } from "web-tree-sitter";
import { highlightQueryCandidates } from "./treeSitterHighlightQueries";

const pythonWasmUrl = "/wasm/tree-sitter-python.wasm";
const javascriptWasmUrl = "/wasm/tree-sitter-javascript.wasm";
const typescriptWasmUrl = "/wasm/tree-sitter-typescript.wasm";
const tsxWasmUrl = "/wasm/tree-sitter-tsx.wasm";
const rubyWasmUrl = "/wasm/tree-sitter-ruby.wasm";
const goWasmUrl = "/wasm/tree-sitter-go.wasm";
const javaWasmUrl = "/wasm/tree-sitter-java.wasm";
const cWasmUrl = "/wasm/tree-sitter-c.wasm";
const treeSitterWasmUrl = "/wasm/tree-sitter.wasm";

type SupportedLanguageId =
  | "python"
  | "javascript"
  | "typescript"
  | "tsx"
  | "ruby"
  | "go"
  | "java"
  | "c";

type LanguageConfig = {
  id: SupportedLanguageId;
  wasmUrl: string;
  extensions: ReadonlySet<string>;
  displayName: string;
};

type Position = {
  row: number;
  column: number;
};

type HighlightToken = {
  startIndex: number;
  endIndex: number;
  scope: string;
};

export type TreeSitterAstNode = {
  type: string;
  named: boolean;
  // When present, indicates this node's field name relative to its parent
  fieldName?: string;
  startPosition: Position;
  endPosition: Position;
  // Absolute character indices within the full source string
  startIndex: number;
  endIndex: number;
  text?: string;
  children: TreeSitterAstNode[];
  namedChildren: TreeSitterAstNode[];
};

const supportedLanguages: LanguageConfig[] = [
  {
    id: "python",
    displayName: "Python",
    wasmUrl: pythonWasmUrl,
    extensions: new Set(["py"]),
  },
  {
    id: "javascript",
    displayName: "JavaScript",
    wasmUrl: javascriptWasmUrl,
    extensions: new Set(["js", "mjs", "cjs", "jsx"]),
  },
  {
    id: "typescript",
    displayName: "TypeScript",
    wasmUrl: typescriptWasmUrl,
    extensions: new Set(["ts"]),
  },
  {
    id: "tsx",
    displayName: "TSX",
    wasmUrl: tsxWasmUrl,
    extensions: new Set(["tsx"]),
  },
  {
    id: "ruby",
    displayName: "Ruby",
    wasmUrl: rubyWasmUrl,
    extensions: new Set(["rb"]),
  },
  {
    id: "c",
    displayName: "C",
    wasmUrl: cWasmUrl,
    extensions: new Set(["c", "h"]),
  },
  {
    id: "go",
    displayName: "Go",
    wasmUrl: goWasmUrl,
    extensions: new Set(["go"]),
  },
  {
    id: "java",
    displayName: "Java",
    wasmUrl: javaWasmUrl,
    extensions: new Set(["java"]),
  },
];

const extensionToLanguage = new Map<string, LanguageConfig>();
for (const config of supportedLanguages) {
  for (const ext of config.extensions) {
    extensionToLanguage.set(ext, config);
  }
}

const highlightQueryCache = new Map<SupportedLanguageId, any | null>();

const captureToScope = (captureName: string) => captureName.split(".")[0];

const getHighlightQuery = (
  languageId: SupportedLanguageId,
  language: Language
) => {
  if (highlightQueryCache.has(languageId)) {
    return highlightQueryCache.get(languageId) ?? null;
  }

  const candidates = highlightQueryCandidates[languageId] ?? [];
  for (const queryText of candidates) {
    try {
      const query = language.query(queryText);
      highlightQueryCache.set(languageId, query);
      return query;
    } catch (error) {
      console.warn(
        `Failed to compile highlight query for ${languageId}, trying fallback.`,
        error
      );
    }
  }

  highlightQueryCache.set(languageId, null);
  return null;
};

const computeHighlights = (
  tree: { rootNode: TreeSitterNode },
  language: Language,
  languageId: SupportedLanguageId
): HighlightToken[] => {
  const query = getHighlightQuery(languageId, language);
  if (!query) return [];

  try {
    const caps = query.captures(tree.rootNode);
    const tokens = caps.map((c: any) => ({
      startIndex: c.node.startIndex,
      endIndex: c.node.endIndex,
      scope: captureToScope(c.name),
    }));

    tokens.sort(
      (a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex
    );

    const out: HighlightToken[] = [];
    let lastEnd = -1;
    for (const t of tokens) {
      if (t.endIndex <= t.startIndex) continue;
      if (t.startIndex < lastEnd) continue;
      out.push(t);
      lastEnd = t.endIndex;
    }
    return out;
  } catch (error) {
    console.warn(`Failed to capture highlights for ${languageId}.`, error);
    return [];
  }
};

let initPromise: Promise<void> | undefined;

const getInitPromise = () => {
  if (!initPromise) {
    console.log("Initializing Tree-sitter...");
    initPromise = Parser.init({
      locateFile: (scriptName: string, scriptDirectory: string) => {
        const url =
          scriptName === "tree-sitter.wasm"
            ? treeSitterWasmUrl
            : `${scriptDirectory}${scriptName}`;
        console.log(`Loading WASM file: ${scriptName} from ${url}`);
        return url;
      },
    })
      .then(() => {
        console.log("Tree-sitter initialization completed");
      })
      .catch((error) => {
        console.error("Tree-sitter initialization failed:", error);
        throw error;
      });
  }
  return initPromise;
};

const languageCache = new Map<SupportedLanguageId, Promise<Language>>();

const loadLanguage = async (config: LanguageConfig) => {
  const cached = languageCache.get(config.id);
  if (cached) {
    console.log(`Using cached language: ${config.id}`);
    return cached;
  }

  console.log(`Loading language: ${config.id} from ${config.wasmUrl}`);
  const promise = getInitPromise()
    .then(async () => {
      console.log(`Tree-sitter initialized, loading language: ${config.id}`);
      const language = await Language.load(config.wasmUrl);
      console.log(`Language loaded successfully: ${config.id}`);
      return language;
    })
    .catch((error) => {
      console.error(`Failed to load language ${config.id}:`, error);
      languageCache.delete(config.id);
      throw error;
    });

  languageCache.set(config.id, promise);
  return promise;
};

const serialiseNode = (
  node: TreeSitterNode,
  parent?: TreeSitterNode
): TreeSitterAstNode => {
  // Only serialise named children to avoid duplicating the tree structure
  // (namedChildren is a subset of children). Rendering both massively inflates
  // the AST and can freeze the UI.
  const toSerializableNamedChildren = (items: (TreeSitterNode | null)[]) =>
    items
      .filter((item): item is TreeSitterNode => item !== null)
      .map((child, index) => {
        // Attempt to retrieve the field name for each named child relative to this node
        // Using fieldNameForNamedChild is O(1) and aligns with namedChildren iteration
        const fieldName = node.fieldNameForNamedChild(index) ?? undefined;
        const serialised = serialiseNode(child, node);
        // Attach field name if available
        return fieldName ? { ...serialised, fieldName } : serialised;
      });

  const namedChildren = toSerializableNamedChildren(node.namedChildren);

  const leafText = node.childCount === 0 ? node.text : undefined;

  return {
    type: node.type,
    named: node.isNamed,
    startPosition: { ...node.startPosition },
    endPosition: { ...node.endPosition },
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: leafText?.length ? leafText : undefined,
    // Expose only named children; keep `children` empty to maintain shape
    children: [],
    namedChildren,
  };
};

export type TreeSitterParseSuccess = {
  ast: TreeSitterAstNode;
  parser: "tree-sitter";
  languageId: SupportedLanguageId;
  languageName: string;
  highlights: HighlightToken[];
};

export const canParseWithTreeSitter = (extension: string) =>
  extensionToLanguage.has(extension);

export const parseWithTreeSitter = async (
  code: string,
  extension: string
): Promise<TreeSitterParseSuccess> => {
  console.log(`Starting Tree-sitter parse for .${extension} file`);
  const config = extensionToLanguage.get(extension);

  if (!config) {
    throw new Error(
      `Tree-sitter parser is not configured for .${
        extension || "unknown"
      } files`
    );
  }

  console.log(`Loading language for parsing: ${config.id}`);
  const language = await loadLanguage(config);
  console.log(`Language loaded, creating parser for ${config.id}`);
  const parser = new Parser();

  try {
    console.log(
      `Setting language and parsing code (${code.length} characters)`
    );
    parser.setLanguage(language);
    const tree = parser.parse(code);

    if (!tree) {
      throw new Error("Tree-sitter was unable to produce a syntax tree.");
    }

    console.log(
      `Parsing completed, tree has ${tree.rootNode.childCount} children`
    );

    const ast = serialiseNode(tree.rootNode);
    const highlights =
      code.length > 300_000
        ? []
        : computeHighlights(tree, language, config.id);
    console.log(`AST serialized, tree deleted`);
    tree.delete();

    return {
      ast,
      parser: "tree-sitter",
      languageId: config.id,
      languageName: config.displayName,
      highlights,
    };
  } catch (error) {
    console.error(`Error during Tree-sitter parsing:`, error);
    throw error;
  } finally {
    console.log(`Cleaning up parser`);
    parser.delete();
  }
};
