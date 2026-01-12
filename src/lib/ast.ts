import { canParseWithTreeSitter } from "./astSupport";
import type { TreeSitterAstNode } from "./treeSitter";

export type HighlightToken = {
  startIndex: number;
  endIndex: number;
  scope: string;
};

type TreeSitterSuccess = {
  status: "success";
  parser: "tree-sitter";
  language: string;
  ast: TreeSitterAstNode;
  highlights: HighlightToken[];
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
  | TreeSitterSuccess
  | ParseUnsupported
  | ParseError;

const getExtension = (fileName?: string) => {
  if (!fileName) return "";
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
};

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

  if (!canParseWithTreeSitter(extension)) {
    return {
      status: "unsupported",
      reason: `Unable to parse files with the .${extension || "unknown"
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
      highlights: result.highlights ?? [],
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
