// Minimal AST support helpers that are safe to import on the server

export type SupportedLanguageId = "python";

const supportedExtensionsByLanguage: Readonly<
  Record<SupportedLanguageId, ReadonlySet<string>>
> = {
  python: new Set(["py"]),
};

const supportedExtensions = new Set<string>(
  Array.from(Object.values(supportedExtensionsByLanguage)).flatMap((set) =>
    Array.from(set)
  )
);

export const canParseWithTreeSitter = (extension: string) =>
  supportedExtensions.has(extension);
