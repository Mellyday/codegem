import path from "node:path";
import fs from "node:fs/promises";
import { ObjectId, type Db } from "mongodb";
import { parseWithTreeSitter, canParseWithTreeSitter, type TreeSitterAstNode } from "../parser/treeSitterServer";

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
  db: Db,
  params: {
    userId: string;
    repoId: ObjectId;
    url: string;
    owner: string;
    name: string;
    rootDir: string;
  }
): Promise<RepoProgress> {
  const { userId, repoId, url, owner, name, rootDir } = params;
  // Per requirement: for GitHub auto-fetching flows, AST documents should be
  // stored in the "repos" collection exclusively, not in "files".
  const targetCol = db.collection("repos");
  const progress: RepoProgress = { totalFiles: 0, parsedFiles: 0, failedFiles: 0 };

  // First pass: count parseable files
  const allPaths: string[] = [];
  for await (const p of walk(rootDir)) {
    const ext = fileExtension(p);
    if (canParseWithTreeSitter(ext)) allPaths.push(p);
  }
  progress.totalFiles = allPaths.length;

  for (const absPath of allPaths) {
    const ext = fileExtension(absPath);
    const relPath = relativePath(rootDir, absPath);
    try {
      const sourceCode = await fs.readFile(absPath, "utf8");
      const parsed = await parseWithTreeSitter(sourceCode, ext);
      const now = new Date();
      await targetCol.insertOne({
        userId,
        repoId,
        projectId: null,
        url,
        owner,
        name,
        path: relPath,
        language: parsed.languageId,
        extension: ext,
        sourceCode,
        ast: parsed.ast as TreeSitterAstNode,
        parseStatus: "success",
        size: Buffer.byteLength(sourceCode, "utf8"),
        createdAt: now,
        updatedAt: now,
      });
      progress.parsedFiles += 1;
    } catch (err) {
      progress.failedFiles += 1;
      await targetCol.insertOne({
        userId,
        repoId,
        projectId: null,
        url,
        owner,
        name,
        path: relPath,
        language: "unknown",
        extension: ext,
        sourceCode: "",
        ast: null,
        parseStatus: "failed",
        parseError: String(err),
        size: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
  }

  return progress;
}
