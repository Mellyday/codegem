import { parse } from "@babel/parser";
import type { ParserOptions } from "@babel/parser";
import type { File } from "@babel/types";

import { canParseWithTreeSitter } from "./astSupport";
import type { TreeSitterAstNode } from "./treeSitter";

type ParseSuccess = {
  status: "success";
  parser: "babel";
  language: string;
  ast: File;
};

type TreeSitterSuccess = {
  status: "success";
  parser: "tree-sitter";
  language: string;
  ast: TreeSitterAstNode;
};

type ParseUnsupported = {
  status: "unsupported";
  reason: string;
};

type ParseError = {
  status: "error";
  message: string;
};

export type ParseResult =
  | ParseSuccess
  | TreeSitterSuccess
  | ParseUnsupported
  | ParseError;

const supportedExtensions = new Set(["js", "cjs", "mjs", "jsx", "ts", "tsx"]);

const parserOptions: ParserOptions = {
  sourceType: "unambiguous",
  plugins: [
    "typescript",
    "jsx",
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "decorators-legacy",
    "dynamicImport",
    "importMeta",
    "exportDefaultFrom",
    "optionalChaining",
    "nullishCoalescingOperator",
    "objectRestSpread",
    "topLevelAwait",
  ],
};

const getExtension = (fileName?: string) => {
  if (!fileName) return "";
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
};

export const canParseWithBabel = (fileName: string) =>
  supportedExtensions.has(getExtension(fileName));

const BABEL_LANGUAGE_NAME = "JavaScript / TypeScript";

// Helper function to add timeout to promises
const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | number | null = null;

    // Set up the timeout
    timeoutId = setTimeout(() => {
      timeoutId = null; // Clear the reference
      reject(new Error(errorMessage));
    }, timeoutMs);

    // Handle the promise resolution
    promise
      .then((result) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
          resolve(result);
        }
      })
      .catch((error) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
          reject(error);
        }
      });
  });
};

export const parseCodeToAst = async (
  code: string,
  fileName: string
): Promise<ParseResult> => {
  const extension = getExtension(fileName);
  console.log(`Starting AST parsing for ${fileName} (${extension})`);

  const attemptTreeSitter = async (): Promise<ParseResult> => {
    if (!canParseWithTreeSitter(extension)) {
      return {
        status: "unsupported",
        reason: `Unable to parse files with the .${
          extension || "unknown"
        } extension`,
      };
    }

    try {
      console.log(`Attempting Tree-sitter parse for .${extension} file`);
      const { parseWithTreeSitter } = await import("./treeSitter");
      const result = await withTimeout(
        parseWithTreeSitter(code, extension),
        10000, // 10 second timeout
        "Tree-sitter parsing timed out after 10 seconds"
      );
      console.log(`Tree-sitter parse successful for .${extension} file`);
      return {
        status: "success",
        parser: "tree-sitter",
        language: result.languageName,
        ast: result.ast,
      };
    } catch (error) {
      console.error(`Tree-sitter parse failed for .${extension} file:`, error);
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while parsing code.";
      return {
        status: "error",
        message,
      };
    }
  };

  if (!canParseWithBabel(fileName)) {
    return attemptTreeSitter();
  }

  try {
    console.log(`Attempting Babel parse for ${fileName}`);
    const ast = await withTimeout(
      Promise.resolve(parse(code, parserOptions)),
      5000, // 5 second timeout for Babel
      "Babel parsing timed out after 5 seconds"
    );
    console.log(`Babel parse successful for ${fileName}`);
    return {
      status: "success",
      parser: "babel",
      language: BABEL_LANGUAGE_NAME,
      ast,
    };
  } catch (error) {
    console.error(`Babel parse failed for ${fileName}:`, error);
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while parsing code.";

    console.log(`Babel failed, trying Tree-sitter fallback for ${fileName}`);
    const treeSitterResult = await attemptTreeSitter();
    if (treeSitterResult.status === "success") {
      console.log(`Tree-sitter fallback successful for ${fileName}`);
      return treeSitterResult;
    }

    if (treeSitterResult.status === "error") {
      console.log(`Tree-sitter fallback also failed for ${fileName}`);
      return treeSitterResult;
    }

    console.log(`Both parsers failed for ${fileName}`);
    return {
      status: "error",
      message,
    };
  }
};
