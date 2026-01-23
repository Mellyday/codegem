import { getDb, fromJson, toJson } from "../sqlite";
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
      `SELECT ast, source_code, extension, updated_at, is_dir FROM ${tableName} WHERE id = ?`
    )
    .get(input.fileId) as
    | {
        ast: string | null;
        source_code: string | null;
        extension: string | null;
        updated_at: string | null;
        is_dir?: number | null;
      }
    | undefined;

  if (!row || row.is_dir) {
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

  if (!sourceCode) {
    throw new Error("No source code stored for this file");
  }
  if (!canParseWithTreeSitter(extension)) {
    throw new Error(`File type .${extension || "unknown"} is not supported`);
  }

  const parsed = await parseWithTreeSitter(sourceCode, extension);
  setCachedAst(cacheKey, parsed.ast);

  if (input.persist) {
    db.prepare(`UPDATE ${tableName} SET ast = ? WHERE id = ?`).run(
      toJson(parsed.ast),
      input.fileId
    );
  }

  return { ast: parsed.ast, sourceCode, extension };
}
