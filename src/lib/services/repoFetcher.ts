import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import simpleGit from "simple-git";
import { IMPORT_LIMITS, isRepoTooLarge, formatBytes } from "./importLimits";

export type ParsedGithub = {
  owner: string;
  name: string;
};

export function parseGithubUrl(urlStr: string): ParsedGithub {
  try {
    const url = new URL(urlStr);
    if (!/^(github\.com)$/i.test(url.hostname)) {
      throw new Error("Only github.com URLs are supported");
    }
    const parts = url.pathname.replace(/^\//, "").split("/");
    const owner = parts[0];
    const nameWithGit = parts[1] || "";
    const name = nameWithGit.replace(/\.git$/, "");
    if (!owner || !name) {
      throw new Error("Invalid GitHub repository URL");
    }
    return { owner, name };
  } catch (e) {
    throw new Error(`Invalid GitHub URL: ${String(e)}`);
  }
}

export type RepoSizeInfo = {
  sizeKB: number;
  isPrivate: boolean;
};

/**
 * Fetch repository size from GitHub API before cloning.
 * Returns size in KB. For private repos, returns 0 (skip size check).
 */
export async function getRepoSizeFromGitHub(
  owner: string,
  name: string
): Promise<RepoSizeInfo> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "codegem-import",
      },
    });

    if (response.status === 404) {
      throw new Error(`Repository not found: ${owner}/${name}`);
    }

    if (response.status === 403) {
      // Rate limited or private - skip size check
      return { sizeKB: 0, isPrivate: true };
    }

    if (!response.ok) {
      // Skip size check on API errors, let clone fail if needed
      return { sizeKB: 0, isPrivate: false };
    }

    const data = await response.json();
    return {
      sizeKB: data.size || 0,
      isPrivate: data.private || false,
    };
  } catch (err) {
    // Network error - skip size check
    console.warn("Failed to check repo size:", err);
    return { sizeKB: 0, isPrivate: false };
  }
}

export type CloneResult = ParsedGithub & {
  dir: string;
  sizeKB: number;
};

export async function cloneGithubRepo(url: string): Promise<CloneResult> {
  const { owner, name } = parseGithubUrl(url);

  // Check repo size via GitHub API before cloning
  const { sizeKB, isPrivate } = await getRepoSizeFromGitHub(owner, name);

  if (!isPrivate && sizeKB > 0 && isRepoTooLarge(sizeKB)) {
    const actualSize = formatBytes(sizeKB * 1024);
    const maxSize = formatBytes(IMPORT_LIMITS.MAX_REPO_SIZE_MB * 1024 * 1024);
    throw new Error(
      `Repository too large: ${actualSize} exceeds ${maxSize} limit. ` +
      `Consider importing a smaller subset or fork.`
    );
  }

  const base = process.env.TEMP_CLONE_DIR || os.tmpdir();
  const dir = path.join(base, `codegem-${owner}-${name}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });

  const git = simpleGit();
  await git.clone(url, dir, ["--depth", "1"]);

  return { owner, name, dir, sizeKB };
}
