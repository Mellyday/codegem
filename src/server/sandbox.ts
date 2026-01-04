import { getDb } from "../lib/sqlite";

export type SandboxRoute = {
  fileName: string;
  routePath: string;
  label: string;
  astSupport: "tree-sitter" | "none";
};

export async function listSandboxes(): Promise<SandboxRoute[]> {
  const db = getDb();

  const docs = db.prepare(`
    SELECT path, extension
    FROM files
  `).all() as Array<{ path: string; extension: string | null }>;

  const routes: SandboxRoute[] = docs
    .map((doc) => {
      const routePath = doc.path.replace(/\.[^/.]+$/, "");
      const extension = doc.extension || "";
      const astSupport: "tree-sitter" | "none" =
        extension === "py" ? "tree-sitter" : "none";
      return {
        fileName: doc.path,
        routePath,
        label: routePath,
        astSupport,
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
