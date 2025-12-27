// Minimal AST support helpers that are safe to import on the server

export type SupportedLanguageId =
  | "python"
  | "javascript"
  | "typescript"
  | "tsx"
  | "go"
  | "java"
  | "c"
  | "ruby";

const supportedExtensionsByLanguage: Readonly<
  Record<SupportedLanguageId, ReadonlySet<string>>
> = {
  python: new Set(["py"]),
  javascript: new Set(["js", "mjs", "cjs", "jsx"]),
  typescript: new Set(["ts"]),
  tsx: new Set(["tsx"]),
  c: new Set(["c", "h"]),
  go: new Set(["go"]),
  java: new Set(["java"]),
  ruby: new Set(["rb"]),
};

const supportedExtensions = new Set<string>(
  Array.from(Object.values(supportedExtensionsByLanguage)).flatMap((set) =>
    Array.from(set)
  )
);

const extensionToLanguage = new Map<string, SupportedLanguageId>();
for (const [lang, exts] of Object.entries(supportedExtensionsByLanguage)) {
  for (const ext of exts) extensionToLanguage.set(ext, lang as SupportedLanguageId);
}

export const canParseWithTreeSitter = (extension: string) =>
  supportedExtensions.has(extension);

export const getLanguageIdForExtension = (
  extension: string
): SupportedLanguageId | undefined => extensionToLanguage.get(extension);

export const getLanguageIdFromFileName = (
  fileName?: string
): SupportedLanguageId | undefined => {
  if (!fileName) return undefined;
  const parts = fileName.split(".");
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : "";
  return getLanguageIdForExtension(ext);
};
