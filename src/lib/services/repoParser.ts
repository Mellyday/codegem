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

type AbortSignalLike = { aborted: boolean };

const isHidden = (p: string) => /(^|\/)\./.test(p);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  "target",
]);

async function* walk(
  dir: string,
  options?: { abortSignal?: AbortSignalLike }
): AsyncGenerator<string> {
  if (options?.abortSignal?.aborted) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (options?.abortSignal?.aborted) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isHidden(entry.name) || SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full, options);
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
    abortSignal?: AbortSignalLike;
  }
): Promise<RepoProgress> {
  const { userId, repoId, url, owner, name, rootDir, abortSignal } = params;
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0, skippedFiles: 0 };
  const now = toDbDate(new Date());

  // First pass: count parseable files
  const allPaths: string[] = [];
  for await (const p of walk(rootDir, { abortSignal })) {
    if (abortSignal?.aborted) break;
    const ext = fileExtension(p);
    if (canParseWithTreeSitter(ext)) allPaths.push(p);
  }
  if (abortSignal?.aborted) {
    progress.totalFiles = allPaths.length;
    return progress;
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
      if (abortSignal?.aborted) {
        break;
      }
      const ext = fileExtension(absPath);
      const relPath = relativePath(rootDir, absPath);

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
  | { type: 'ignored_chunk'; files: string[]; reason: string }
  | { type: 'parsed'; file: string; success: boolean; error?: string }
  | {
    type: 'progress';
    parsedFiles: number;
    failedFiles: number;
    skippedFiles: number;
    index: number;
    total: number;
  }
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
  abortSignal?: AbortSignalLike;
};

export async function parseAndPersistRepoWithProgress(
  db: Database.Database,
  params: WithProgressParams
): Promise<RepoProgress> {
  const { userId, repoId, url, owner, name, rootDir, onProgress, abortSignal } = params;
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0, skippedFiles: 0 };
  const now = toDbDate(new Date());
  const ignoredReason = "Unsupported file extension";
  const parsedSampleRate = 10;
  const progressSampleRate = 10;
  const ignoredChunkSize = 200;

  // Collect all files and categorize them
  onProgress({ type: 'scanning' });

  const parsableFiles: string[] = [];
  const ignoredFiles: string[] = [];

  for await (const p of walk(rootDir, { abortSignal })) {
    if (abortSignal?.aborted) {
      onProgress({ type: 'aborted' });
      return progress;
    }
    const ext = fileExtension(p);
    const relPath = relativePath(rootDir, p);
    if (canParseWithTreeSitter(ext)) {
      parsableFiles.push(relPath);
    } else {
      ignoredFiles.push(relPath);
    }
  }
  if (abortSignal?.aborted) {
    onProgress({ type: 'aborted' });
    return progress;
  }

  onProgress({
    type: 'discovered_summary',
    parsableCount: parsableFiles.length,
    ignoredCount: ignoredFiles.length,
  });

  const discoveryChunkSize = 200;
  for (let i = 0; i < parsableFiles.length; i += discoveryChunkSize) {
    if (abortSignal?.aborted) {
      onProgress({ type: 'aborted' });
      return progress;
    }
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

  // Emit ignored files in chunks
  for (let i = 0; i < ignoredFiles.length; i += ignoredChunkSize) {
    if (abortSignal?.aborted) {
      onProgress({ type: 'aborted' });
      return progress;
    }
    onProgress({
      type: 'ignored_chunk',
      files: ignoredFiles.slice(i, i + ignoredChunkSize),
      reason: ignoredReason,
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

  const emitProgress = (index: number) => {
    if (index % progressSampleRate !== 0 && index !== parsableFiles.length) return;
    onProgress({
      type: 'progress',
      parsedFiles: progress.parsedFiles,
      failedFiles: progress.failedFiles,
      skippedFiles: progress.skippedFiles,
      index,
      total: parsableFiles.length,
    });
  };

  // Process parsable files with batch yielding
  for (let i = 0; i < parsableFiles.length; i++) {
    // Check for abort at batch boundaries
    if (abortSignal?.aborted) {
      if (rows.length) {
        insertMany(rows);
        rows = [];
      }
      emitProgress(i);
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
        emitProgress(i + 1);
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
      if ((i + 1) % parsedSampleRate === 0) {
        onProgress({ type: 'parsed', file: relPath, success: true });
      }
      emitProgress(i + 1);
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
      emitProgress(i + 1);
    }

    if (rows.length >= STREAMING_LIMITS.BATCH_SIZE) {
      insertMany(rows);
      rows = [];
    }
  }

  if (rows.length) insertMany(rows);

  return progress;
}
