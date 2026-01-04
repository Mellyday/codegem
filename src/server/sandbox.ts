import { getDb } from "../lib/sqlite";

export type SandboxRoute = {
  fileName: string;
  routePath: string;
  label: string;
  astSupport: "tree-sitter" | "none";
};

export async function listSandboxes(): Promise<SandboxRoute[]> {
  const db = getDb();

  // Issue #10 fix: Only list Python files that aren't directories
  const docs = db.prepare(`
    SELECT path, extension
    FROM files
    WHERE extension = 'py' AND (is_dir = 0 OR is_dir IS NULL)
  `).all() as Array<{ path: string; extension: string | null }>;

  const routes: SandboxRoute[] = docs
    .map((doc) => {
      const routePath = doc.path.replace(/\.[^/.]+$/, "");
      return {
        fileName: doc.path,
        routePath,
        label: routePath,
        astSupport: "tree-sitter" as const,
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));

  return routes;
}

export async function readSandbox(
  routePath: string
): Promise<{ fileName: string; code: string } | null> {
  const db = getDb();
  const path = `${routePath}.py`;

  const doc = db.prepare(`
    SELECT path, source_code
    FROM files
    WHERE path = ?
  `).get(path) as { path: string; source_code: string | null } | undefined;

  if (!doc || typeof doc.source_code !== "string") return null;

  return {
    fileName: doc.path,
    code: doc.source_code,
  };
}
