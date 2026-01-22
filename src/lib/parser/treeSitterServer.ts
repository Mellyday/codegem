import Parser from "tree-sitter";
import type ParserType from "tree-sitter";
import C from "tree-sitter-c";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import Ruby from "tree-sitter-ruby";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TypeScript = require("tree-sitter-typescript");

type SupportedLanguageId =
  | "python"
  | "javascript"
  | "typescript"
  | "tsx"
  | "go"
  | "java"
  | "c"
  | "ruby";

type LanguageConfig = {
  id: SupportedLanguageId;
  language: any; // tree-sitter Language object from grammar package
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
    language: Python,
    extensions: new Set(["py"]),
  },
  {
    id: "javascript",
    displayName: "JavaScript",
    language: JavaScript,
    extensions: new Set(["js", "mjs", "cjs", "jsx"]),
  },
  {
    id: "typescript",
    displayName: "TypeScript",
    language: (TypeScript as any).typescript,
    extensions: new Set(["ts"]),
  },
  {
    id: "tsx",
    displayName: "TSX",
    language: (TypeScript as any).tsx,
    extensions: new Set(["tsx"]),
  },
  {
    id: "c",
    displayName: "C",
    language: C,
    extensions: new Set(["c", "h"]),
  },
  {
    id: "go",
    displayName: "Go",
    language: Go,
    extensions: new Set(["go"]),
  },
  {
    id: "java",
    displayName: "Java",
    language: Java,
    extensions: new Set(["java"]),
  },
  {
    id: "ruby",
    displayName: "Ruby",
    language: Ruby,
    extensions: new Set(["rb"]),
  },
];

const extensionToLanguage = new Map<string, LanguageConfig>();
for (const config of supportedLanguages) {
  for (const ext of config.extensions) {
    extensionToLanguage.set(ext, config);
  }
}

// With native tree-sitter bindings, languages are loaded via their packages.
// Keep a trivial cache in case future grammars need lazy loading.
const languageCache = new Map<SupportedLanguageId, any>();

const loadLanguage = async (config: LanguageConfig) => {
  const cached = languageCache.get(config.id);
  if (cached) return cached;
  languageCache.set(config.id, config.language);
  return config.language;
};

const EXTRA_TOKEN_TYPES = new Set(["&&", "||", "??"]);

const serialiseNode = (
  node: ParserType.SyntaxNode,
  parent?: ParserType.SyntaxNode
): TreeSitterAstNode => {
  const children: TreeSitterAstNode[] = [];
  const childMap = new Map<number, TreeSitterAstNode>();
  const fieldNamesById = new Map<number, string | undefined>();

  node.children.forEach((child, index) => {
    if (!child) return;
    if (!child.isNamed && !EXTRA_TOKEN_TYPES.has(child.type)) return;
    const fieldName = node.fieldNameForChild(index) ?? undefined;
    const serialised = serialiseNode(child, node);
    const withField = fieldName ? { ...serialised, fieldName } : serialised;
    children.push(withField);
    childMap.set(child.id, withField);
    fieldNamesById.set(child.id, fieldName);
  });

  const namedChildren = node.namedChildren
    .filter((item): item is ParserType.SyntaxNode => item !== null)
    .map((child) => {
      const existing = childMap.get(child.id);
      if (existing) return existing;
      const serialised = serialiseNode(child, node);
      const fieldName = fieldNamesById.get(child.id);
      return fieldName ? { ...serialised, fieldName } : serialised;
    });
  const leafText = node.childCount === 0 ? node.text : undefined;

  return {
    type: node.type,
    named: node.isNamed,
    startPosition: { ...node.startPosition },
    endPosition: { ...node.endPosition },
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: leafText?.length ? leafText : undefined,
    children,
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
    const tree = parser.parse(code, undefined, { bufferSize: 1024 * 1024 }); // 1MB buffer for large files
    if (!tree) throw new Error("Tree-sitter failed to produce a tree");
    const ast = serialiseNode(tree.rootNode);
    return {
      ast,
      parser: "tree-sitter",
      languageId: config.id,
      languageName: config.displayName,
    };
  } finally {
    // Native binding cleans up via GC; no explicit delete()
  }
};
