import path from "node:path";
import fs from "node:fs/promises";
import { getDb, generateId, toDbDate, toJson } from "../sqlite";
import { parseWithTreeSitter, canParseWithTreeSitter, type TreeSitterAstNode } from "../parser/treeSitterServer";
import type Database from "better-sqlite3";

export type RepoProgress = {
  totalFiles: number;
  parsedFiles: number;
  failedFiles: number;
};

const isHidden = (p: string) => /(^|\/)\./.test(p);

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || isHidden(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      if (isHidden(entry.name)) continue;
      yield full;
    }
  }
}

function fileExtension(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, "");
  return ext.toLowerCase();
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

export async function parseAndPersistRepo(
  db: Database.Database,
  params: {
    userId: string;
    repoId: string;
    url: string;
    owner: string;
    name: string;
    rootDir: string;
  }
): Promise<RepoProgress> {
  const { userId, repoId, url, owner, name, rootDir } = params;
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0 };

  // First pass: count parseable files
  const allPaths: string[] = [];
  for await (const p of walk(rootDir)) {
    const ext = fileExtension(p);
    if (canParseWithTreeSitter(ext)) allPaths.push(p);
  }
  progress.totalFiles = allPaths.length;

  const insertStmt = db.prepare(`
    INSERT INTO repos (
      id, user_id, repo_id, project_id, url, owner, name, path,
      language, extension, source_code, ast, parse_status, parse_error,
      size, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  for (const absPath of allPaths) {
    const ext = fileExtension(absPath);
    const relPath = relativePath(rootDir, absPath);
    const now = toDbDate(new Date());

    try {
      const sourceCode = await fs.readFile(absPath, "utf8");
      const parsed = await parseWithTreeSitter(sourceCode, ext);

      insertStmt.run(
        generateId(),
        userId,
        repoId,
        null, // projectId
        url,
        owner,
        name,
        relPath,
        parsed.languageId,
        ext,
        sourceCode,
        toJson(parsed.ast as TreeSitterAstNode),
        "success",
        null,
        Buffer.byteLength(sourceCode, "utf8"),
        now,
        now
      );
      progress.parsedFiles += 1;
    } catch (err) {
      progress.failedFiles += 1;
      const sourceCode = await fs.readFile(absPath, "utf8").catch(() => "");

      insertStmt.run(
        generateId(),
        userId,
        repoId,
        null, // projectId
        url,
        owner,
        name,
        relPath,
        "unknown",
        ext,
        sourceCode,
        null,
        "failed",
        String(err),
        Buffer.byteLength(sourceCode, "utf8"),
        now,
        now
      );
    }
  }

  return progress;
}

// Event types for streaming progress
export type ProgressEvent =
  | { type: 'cloned'; fileCount: number }
  | { type: 'scanning' }
  | { type: 'discovered'; files: string[]; ignoredFiles: string[] }
  | { type: 'processing'; file: string; index: number; total: number }
  | { type: 'ignored'; file: string; reason: string }
  | { type: 'parsed'; file: string; success: boolean; error?: string };

type WithProgressParams = {
  userId: string;
  repoId: string;
  url: string;
  owner: string;
  name: string;
  rootDir: string;
  onProgress: (event: ProgressEvent) => void;
};

export async function parseAndPersistRepoWithProgress(
  db: Database.Database,
  params: WithProgressParams
): Promise<RepoProgress> {
  const { userId, repoId, url, owner, name, rootDir, onProgress } = params;
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0 };

  // Collect all files and categorize them
  onProgress({ type: 'scanning' });

  const parsableFiles: string[] = [];
  const ignoredFiles: string[] = [];

  for await (const p of walk(rootDir)) {
    const ext = fileExtension(p);
    const relPath = relativePath(rootDir, p);
    if (canParseWithTreeSitter(ext)) {
      parsableFiles.push(relPath);
    } else {
      ignoredFiles.push(relPath);
    }
  }

  onProgress({
    type: 'discovered',
    files: parsableFiles,
    ignoredFiles: ignoredFiles,
  });

  // Emit ignored files
  for (const ignoredPath of ignoredFiles) {
    onProgress({
      type: 'ignored',
      file: ignoredPath,
      reason: 'Unsupported file extension',
    });
  }

  progress.totalFiles = parsableFiles.length;

  const insertStmt = db.prepare(`
    INSERT INTO repos (
      id, user_id, repo_id, project_id, url, owner, name, path,
      language, extension, source_code, ast, parse_status, parse_error,
      size, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  // Process parsable files
  for (let i = 0; i < parsableFiles.length; i++) {
    const relPath = parsableFiles[i];
    const absPath = path.join(rootDir, relPath);
    const ext = fileExtension(absPath);
    const now = toDbDate(new Date());

    onProgress({
      type: 'processing',
      file: relPath,
      index: i + 1,
      total: parsableFiles.length,
    });

    try {
      const sourceCode = await fs.readFile(absPath, "utf8");
      const parsed = await parseWithTreeSitter(sourceCode, ext);

      insertStmt.run(
        generateId(),
        userId,
        repoId,
        null, // projectId
        url,
        owner,
        name,
        relPath,
        parsed.languageId,
        ext,
        sourceCode,
        toJson(parsed.ast as TreeSitterAstNode),
        "success",
        null,
        Buffer.byteLength(sourceCode, "utf8"),
        now,
        now
      );
      progress.parsedFiles += 1;
      onProgress({ type: 'parsed', file: relPath, success: true });
    } catch (err) {
      progress.failedFiles += 1;
      const failedSourceCode = await fs.readFile(absPath, "utf8").catch(() => "");

      insertStmt.run(
        generateId(),
        userId,
        repoId,
        null, // projectId
        url,
        owner,
        name,
        relPath,
        "unknown",
        ext,
        failedSourceCode,
        null,
        "failed",
        String(err),
        Buffer.byteLength(failedSourceCode, "utf8"),
        now,
        now
      );
      onProgress({ type: 'parsed', file: relPath, success: false, error: String(err) });
    }
  }

  return progress;
}
