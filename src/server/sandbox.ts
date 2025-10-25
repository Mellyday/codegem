import fs from "fs";
import path from "path";

import { canParseWithBabel } from "../lib/ast";
import { canParseWithTreeSitter } from "../lib/treeSitter";

export type SandboxRoute = {
  fileName: string;
  routePath: string;
  label: string;
  astSupport: "babel" | "tree-sitter" | "none";
};

const CODE_SANDBOX_DIR = path.join(process.cwd(), "code_sandbox");

const stripExtension = (fileName: string) => fileName.replace(/\.[^/.]+$/, "");
const getExtension = (fileName: string) => fileName.split(".").pop() ?? "";

export function listSandboxes(): SandboxRoute[] {
  if (!fs.existsSync(CODE_SANDBOX_DIR)) {
    return [];
  }

  const entries = fs
    .readdirSync(CODE_SANDBOX_DIR, { withFileTypes: true })
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name);

  const routes: SandboxRoute[] = entries
    .map((fileName) => {
      const routePath = stripExtension(fileName);
      const extension = getExtension(fileName);

      const astSupport = canParseWithBabel(fileName)
        ? "babel"
        : canParseWithTreeSitter(extension)
        ? "tree-sitter"
        : "none";

      return {
        fileName,
        routePath,
        label: routePath,
        astSupport,
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));

  return routes;
}

export function readSandbox(
  routePath: string
): { fileName: string; code: string } | null {
  if (!fs.existsSync(CODE_SANDBOX_DIR)) {
    return null;
  }

  const entries = fs
    .readdirSync(CODE_SANDBOX_DIR, { withFileTypes: true })
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name);

  const matching = entries.find(
    (fileName) => stripExtension(fileName) === routePath
  );
  if (!matching) return null;

  const absPath = path.join(CODE_SANDBOX_DIR, matching);
  try {
    const code = fs.readFileSync(absPath, "utf8");
    return { fileName: matching, code };
  } catch {
    return null;
  }
}
