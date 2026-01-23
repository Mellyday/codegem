import { getDb, fromJson, toDbDate, toJson } from "../sqlite";
import {
  canParseWithTreeSitter,
  parseWithTreeSitter,
  type TreeSitterAstNode,
} from "../parser/treeSitterServer";

type AstLookup = {
  kind: "repo" | "project";
  fileId: string;
  persist?: boolean;
};

export type AstResult = {
  ast: TreeSitterAstNode;
  sourceCode: string;
  extension: string;
};

const AST_CACHE_LIMIT = 50;
const astCache = new Map<string, TreeSitterAstNode>();

const getCachedAst = (key: string) => {
  const cached = astCache.get(key);
  if (!cached) return null;
  astCache.delete(key);
  astCache.set(key, cached);
  return cached;
};

const setCachedAst = (key: string, ast: TreeSitterAstNode) => {
  astCache.set(key, ast);
  if (astCache.size <= AST_CACHE_LIMIT) return;
  const oldest = astCache.keys().next().value as string | undefined;
  if (oldest) astCache.delete(oldest);
};

const cacheKeyFor = (fileId: string, updatedAt?: string | null) =>
  `${fileId}:${updatedAt ?? ""}`;

export async function getAstForFileId(
  input: AstLookup
): Promise<AstResult | null> {
  const db = getDb();
  const tableName = input.kind === "repo" ? "repos" : "files";
  const row = db
    .prepare(
      `SELECT ast, source_code, extension, updated_at FROM ${tableName} WHERE id = ?`
    )
    .get(input.fileId) as
    | {
        ast: string | null;
        source_code: string | null;
        extension: string | null;
        updated_at: string | null;
      }
    | undefined;

  if (
    !row ||
    (row.source_code === null && row.ast === null && row.extension === null)
  ) {
    return null;
  }

  const sourceCode = row.source_code ?? "";
  const extension = (row.extension ?? "").toLowerCase();
  const cacheKey = cacheKeyFor(input.fileId, row.updated_at);

  const cached = getCachedAst(cacheKey);
  if (cached) {
    return { ast: cached, sourceCode, extension };
  }

  if (row.ast) {
    const parsed = fromJson<TreeSitterAstNode>(row.ast);
    if (parsed) {
      setCachedAst(cacheKey, parsed);
      return { ast: parsed, sourceCode, extension };
    }
  }

  if (row.source_code === null) {
    throw new Error("No source code stored for this file");
  }
  if (!canParseWithTreeSitter(extension)) {
    throw new Error(`File type .${extension || "unknown"} is not supported`);
  }

  const parsed = await parseWithTreeSitter(sourceCode, extension);
  setCachedAst(cacheKey, parsed.ast);

  if (input.persist) {
    db.prepare(`UPDATE ${tableName} SET ast = ?, updated_at = ? WHERE id = ?`).run(
      toJson(parsed.ast),
      toDbDate(new Date()),
      input.fileId
    );
  }

  return { ast: parsed.ast, sourceCode, extension };
}
