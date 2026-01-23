import path from "node:path";
import fs from "node:fs/promises";
import { generateId, toDbDate } from "../sqlite";
import { canParseWithTreeSitter, getLanguageIdForExtension } from "../astSupport";
import { STREAMING_LIMITS, isTooManyFiles, isFileTooLarge, formatBytes } from "./importLimits";
import type Database from "better-sqlite3";

/**
 * Progress tracking for repository parsing.
 * 
 * Invariant: totalFiles === parsedFiles + failedFiles + skippedFiles
 * (when processing completes without abort)
 */
export type RepoProgress = {
  /** Number of parsable files discovered */
  totalFiles: number;
  /** Successfully parsed and stored */
  parsedFiles: number;
  /** Failed to parse (errors) */
  failedFiles: number;
  /** Intentionally skipped (e.g., too large) */
  skippedFiles: number;
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
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0, skippedFiles: 0 };

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

  const insertMany = db.transaction((rows: any[]) => {
    for (const row of rows) insertStmt.run(...row);
  });

  const rows: any[] = [];
  const batchSize = STREAMING_LIMITS.BATCH_SIZE;

  try {
    for (const absPath of allPaths) {
      const ext = fileExtension(absPath);
      const relPath = relativePath(rootDir, absPath);
      const now = toDbDate(new Date());

      try {
        try {
          const stats = await fs.stat(absPath);
          if (isFileTooLarge(stats.size)) {
            progress.skippedFiles += 1;
            continue;
          }
        } catch {
          // If stat fails, try to continue with read
        }

        const sourceCode = await fs.readFile(absPath, "utf8");
        const languageId = getLanguageIdForExtension(ext) ?? "unknown";

        rows.push([
          generateId(),
          userId,
          repoId,
          null, // projectId
          url,
          owner,
          name,
          relPath,
          languageId,
          ext,
          sourceCode,
          null, // ast
          "success",
          null,
          Buffer.byteLength(sourceCode, "utf8"),
          now,
          now,
        ]);
        progress.parsedFiles += 1;
      } catch (err) {
        progress.failedFiles += 1;
        const sourceCode = await fs.readFile(absPath, "utf8").catch(() => "");

        rows.push([
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
          now,
        ]);
      }

      if (rows.length >= batchSize) {
        insertMany(rows);
        rows.length = 0;
      }
    }
  } finally {
    if (rows.length) insertMany(rows);
  }

  return progress;
}

// Event types for streaming progress
export type ProgressEvent =
  | { type: 'cloned'; fileCount: number }
  | { type: 'scanning' }
  | { type: 'discovered_summary'; parsableCount: number; ignoredCount: number }
  | { type: 'discovered_chunk'; files: string[] }
  | { type: 'processing'; file: string; index: number; total: number }
  | { type: 'ignored'; file: string; reason: string }
  | { type: 'parsed'; file: string; success: boolean; error?: string }
  | { type: 'limit_exceeded'; limitType: 'files' | 'file_size'; message: string }
  | { type: 'skipped'; file: string; reason: string }
  | { type: 'aborted' };

type WithProgressParams = {
  userId: string;
  repoId: string;
  url: string;
  owner: string;
  name: string;
  rootDir: string;
  onProgress: (event: ProgressEvent) => void;
  abortSignal?: { aborted: boolean };
};

export async function parseAndPersistRepoWithProgress(
  db: Database.Database,
  params: WithProgressParams
): Promise<RepoProgress> {
  const { userId, repoId, url, owner, name, rootDir, onProgress, abortSignal } = params;
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0, skippedFiles: 0 };

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
    type: 'discovered_summary',
    parsableCount: parsableFiles.length,
    ignoredCount: ignoredFiles.length,
  });

  const discoveryChunkSize = 200;
  for (let i = 0; i < parsableFiles.length; i += discoveryChunkSize) {
    onProgress({
      type: 'discovered_chunk',
      files: parsableFiles.slice(i, i + discoveryChunkSize),
    });
  }

  // Check file count limit
  if (isTooManyFiles(parsableFiles.length)) {
    const message = `Too many files: ${parsableFiles.length} exceeds ${STREAMING_LIMITS.MAX_FILES} limit. Consider importing a smaller subset.`;
    onProgress({ type: 'limit_exceeded', limitType: 'files', message });
    throw new Error(message);
  }

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

  const insertMany = db.transaction((rows: any[]) => {
    for (const row of rows) insertStmt.run(...row);
  });
  let rows: any[] = [];

  // Process parsable files with batch yielding
  for (let i = 0; i < parsableFiles.length; i++) {
    // Check for abort at batch boundaries
    if (abortSignal?.aborted) {
      if (rows.length) {
        insertMany(rows);
        rows = [];
      }
      onProgress({ type: 'aborted' });
      break;
    }

    // Yield between batches to prevent blocking
    if (i > 0 && i % STREAMING_LIMITS.BATCH_SIZE === 0) {
      await new Promise(resolve => setTimeout(resolve, STREAMING_LIMITS.BATCH_DELAY_MS));
    }

    const relPath = parsableFiles[i];
    const absPath = path.join(rootDir, relPath);
    const ext = fileExtension(absPath);
    const now = toDbDate(new Date());

    // Check file size before reading
    try {
      const stats = await fs.stat(absPath);
      if (isFileTooLarge(stats.size)) {
        onProgress({
          type: 'skipped',
          file: relPath,
          reason: `File too large: ${formatBytes(stats.size)} exceeds ${formatBytes(STREAMING_LIMITS.MAX_FILE_SIZE_KB * 1024)} limit`,
        });
        progress.skippedFiles += 1;
        continue;
      }
    } catch {
      // If stat fails, try to continue with read
    }

    onProgress({
      type: 'processing',
      file: relPath,
      index: i + 1,
      total: parsableFiles.length,
    });

    try {
      const sourceCode = await fs.readFile(absPath, "utf8");
      const languageId = getLanguageIdForExtension(ext) ?? "unknown";

      rows.push([
        generateId(),
        userId,
        repoId,
        null, // projectId
        url,
        owner,
        name,
        relPath,
        languageId,
        ext,
        sourceCode,
        null, // ast
        "success",
        null,
        Buffer.byteLength(sourceCode, "utf8"),
        now,
        now,
      ]);
      progress.parsedFiles += 1;
      onProgress({ type: 'parsed', file: relPath, success: true });
    } catch (err) {
      progress.failedFiles += 1;
      const failedSourceCode = await fs.readFile(absPath, "utf8").catch(() => "");

      rows.push([
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
        now,
      ]);
      onProgress({ type: 'parsed', file: relPath, success: false, error: String(err) });
    }

    if (rows.length >= STREAMING_LIMITS.BATCH_SIZE) {
      insertMany(rows);
      rows = [];
    }
  }

  if (rows.length) insertMany(rows);

  return progress;
}
