import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import simpleGit from "simple-git";

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

export type CloneResult = ParsedGithub & {
  dir: string;
};

export async function cloneGithubRepo(url: string): Promise<CloneResult> {
  const { owner, name } = parseGithubUrl(url);
  const base = process.env.TEMP_CLONE_DIR || os.tmpdir();
  const dir = path.join(base, `codegem-${owner}-${name}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });

  const git = simpleGit();
  await git.clone(url, dir, ["--depth", "1"]);

  return { owner, name, dir };
}

