import { getDb, fromJson, toJson, toDbDate } from "../sqlite";
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

export class AstResolverError extends Error {
  code: "UNSUPPORTED" | "NO_SOURCE";

  constructor(code: "UNSUPPORTED" | "NO_SOURCE", message: string) {
    super(message);
    this.code = code;
    this.name = "AstResolverError";
    Object.setPrototypeOf(this, AstResolverError.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AstResolverError);
    }
  }
}

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

const columnCache = new Map<string, boolean>();
const hasColumn = (db: ReturnType<typeof getDb>, table: string, column: string) => {
  const key = `${table}:${column}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  const exists = info.some((row) => row.name === column);
  columnCache.set(key, exists);
  return exists;
};

export async function getAstForFileId(
  input: AstLookup
): Promise<AstResult | null> {
  const db = getDb();
  const tableName = input.kind === "repo" ? "repos" : "files";
  const hasIsDir = hasColumn(db, tableName, "is_dir");
  const selectCols = hasIsDir
    ? "ast, source_code, extension, updated_at, is_dir"
    : "ast, source_code, extension, updated_at";
  const row = db
    .prepare(`SELECT ${selectCols} FROM ${tableName} WHERE id = ?`)
    .get(input.fileId) as
    | {
        ast: string | null;
        source_code: string | null;
        extension: string | null;
        updated_at: string | null;
        is_dir?: number | null;
      }
    | undefined;

  if (!row) {
    return null;
  }
  if (hasIsDir && row.is_dir) {
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
    throw new AstResolverError("NO_SOURCE", "No source code stored for this file");
  }
  if (!canParseWithTreeSitter(extension)) {
    throw new AstResolverError(
      "UNSUPPORTED",
      `File type .${extension || "unknown"} is not supported`
    );
  }

  const parsed = await parseWithTreeSitter(sourceCode, extension);

  if (input.persist) {
    const updatedAt = toDbDate(new Date());
    db.prepare(`UPDATE ${tableName} SET ast = ?, updated_at = ? WHERE id = ?`).run(
      toJson(parsed.ast),
      updatedAt,
      input.fileId
    );
    setCachedAst(cacheKeyFor(input.fileId, updatedAt), parsed.ast);
  } else {
    setCachedAst(cacheKey, parsed.ast);
  }

  return { ast: parsed.ast, sourceCode, extension };
}
