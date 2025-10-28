import path from "node:path";
import { Parser, Language, type Node as TreeSitterNode } from "web-tree-sitter";

// Absolute paths to WASM files served from public/wasm for server-side usage
const wasmDir = path.join(process.cwd(), "public", "wasm");
const pythonWasmPath = path.join(wasmDir, "tree-sitter-python.wasm");
const coreWasmPath = path.join(wasmDir, "tree-sitter.wasm");

type SupportedLanguageId = "python";

type LanguageConfig = {
  id: SupportedLanguageId;
  wasmPath: string;
  extensions: ReadonlySet<string>;
  displayName: string;
};

type Position = {
  row: number;
  column: number;
};

export type TreeSitterAstNode = {
  type: string;
  named: boolean;
  fieldName?: string;
  startPosition: Position;
  endPosition: Position;
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
    wasmPath: pythonWasmPath,
    extensions: new Set(["py"]),
  },
];

const extensionToLanguage = new Map<string, LanguageConfig>();
for (const config of supportedLanguages) {
  for (const ext of config.extensions) {
    extensionToLanguage.set(ext, config);
  }
}

let initPromise: Promise<void> | undefined;

const getInitPromise = () => {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (scriptName: string, scriptDirectory: string) => {
        // On Node, returning an absolute file system path allows web-tree-sitter
        // to read the WASM via fs.
        if (scriptName === "tree-sitter.wasm") return coreWasmPath;
        return path.join(scriptDirectory, scriptName);
      },
    });
  }
  return initPromise;
};

const languageCache = new Map<SupportedLanguageId, Promise<Language>>();

const loadLanguage = async (config: LanguageConfig) => {
  const cached = languageCache.get(config.id);
  if (cached) return cached;
  const promise = getInitPromise().then(() => Language.load(config.wasmPath));
  languageCache.set(config.id, promise);
  return promise;
};

const serialiseNode = (
  node: TreeSitterNode,
  parent?: TreeSitterNode
): TreeSitterAstNode => {
  const toSerializableNamedChildren = (items: (TreeSitterNode | null)[]) =>
    items
      .filter((item): item is TreeSitterNode => item !== null)
      .map((child, index) => {
        const fieldName = node.fieldNameForNamedChild(index) ?? undefined;
        const serialised = serialiseNode(child, node);
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
    children: [],
    namedChildren,
  };
};

export type TreeSitterParseSuccess = {
  ast: TreeSitterAstNode;
  parser: "tree-sitter";
  languageId: SupportedLanguageId;
  languageName: string;
};

export const canParseWithTreeSitter = (extension: string) =>
  extensionToLanguage.has(extension);

export const parseWithTreeSitter = async (
  code: string,
  extension: string
): Promise<TreeSitterParseSuccess> => {
  const config = extensionToLanguage.get(extension);
  if (!config) {
    throw new Error(
      `Tree-sitter parser is not configured for .${extension || "unknown"} files`
    );
  }
  const language = await loadLanguage(config);
  const parser = new Parser();
  try {
    parser.setLanguage(language);
    const tree = parser.parse(code);
    if (!tree) throw new Error("Tree-sitter failed to produce a tree");
    const ast = serialiseNode(tree.rootNode);
    tree.delete();
    return {
      ast,
      parser: "tree-sitter",
      languageId: config.id,
      languageName: config.displayName,
    };
  } finally {
    parser.delete();
  }
};

