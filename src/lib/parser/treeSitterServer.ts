import Parser from "tree-sitter";
import type ParserType from "tree-sitter";
import Python from "tree-sitter-python";

type SupportedLanguageId = "python";

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

const serialiseNode = (
  node: ParserType.SyntaxNode,
  parent?: ParserType.SyntaxNode
): TreeSitterAstNode => {
  const toSerializableNamedChildren = (items: (ParserType.SyntaxNode | null)[]) =>
    items
      .filter((item): item is ParserType.SyntaxNode => item !== null)
      .map((child) => {
        // In native tree-sitter, fieldNameForChild expects the index within all children.
        const all = node.children;
        const childIdx = all.findIndex((c) => c.id === child.id);
        const fieldName = childIdx >= 0 ? node.fieldNameForChild(childIdx) ?? undefined : undefined;
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
