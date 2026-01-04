import { getDb, generateId, toDbDate, fromJson, toJson } from "@/src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

export type RepoOrProjectRef = {
  id: string; // stringified ObjectId
  type: "repo" | "project";
};

export type RepoOrProjectItem = RepoOrProjectRef & {
  label: string; // simple label until we have a metadata collection
};

export type TopLevelListing = {
  repos: RepoOrProjectItem[];
  projects: RepoOrProjectItem[];
};

export type PathListing = {
  prefix: string; // normalized, no leading slash, may be ""
  dirs: string[]; // immediate child directory names
  files: Array<{
    name: string; // file basename at this level
    path: string; // full path (relative to root of repo/project)
    extension?: string;
    language?: string;
    size?: number;
  }>;
};

// Viewing is public; no userId required for browse/read operations.
async function getOptionalUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    return null;
  }
}

const DEV_USER_ID = "dev-push-project";

export async function listReposAndProjects(): Promise<TopLevelListing> {
  // Be resilient when DB is unavailable
  let db;
  try {
    db = getDb();
  } catch {
    return { repos: [], projects: [] };
  }

  // Get current user (if logged in) for filtering
  const userId = await getOptionalUserId();

  // Build repos list - group by repo_id
  // Using MIN() for deterministic results in GROUP BY
  const repoRows = db.prepare(`
    SELECT repo_id, MIN(owner) as owner, MIN(name) as name, MIN(user_id) as user_id
    FROM repos
    WHERE repo_id IS NOT NULL
    GROUP BY repo_id
  `).all() as Array<{ repo_id: string; owner: string; name: string; user_id: string }>;

  // Filter repos by user
  const filteredRepos = repoRows.filter(r =>
    r.user_id === DEV_USER_ID || (userId && r.user_id === userId)
  );

  const repos: RepoOrProjectItem[] = filteredRepos
    .map((g) => ({
      id: String(g.repo_id),
      type: "repo" as const,
      label: g.owner && g.name ? `${g.owner}/${g.name}` : `Repo ${String(g.repo_id)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Build projects list - group by project_id
  // Using MIN() for deterministic results in GROUP BY
  const projectRows = db.prepare(`
    SELECT project_id, MIN(project_name) as project_name, MIN(user_id) as user_id
    FROM files
    WHERE project_id IS NOT NULL
    GROUP BY project_id
  `).all() as Array<{ project_id: string; project_name: string | null; user_id: string }>;

  // Filter projects by user
  const filteredProjects = projectRows.filter(p =>
    p.user_id === DEV_USER_ID || (userId && p.user_id === userId)
  );

  const projects: RepoOrProjectItem[] = filteredProjects
    .filter((g) => g.project_id)
    .map((g) => ({
      id: String(g.project_id),
      type: "project" as const,
      label: g.project_name || `Project ${String(g.project_id)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { repos, projects };
}

type ListChildrenInput =
  | { kind: "repo"; id: string; prefix?: string }
  | { kind: "project"; id: string; prefix?: string };

export async function listPathChildren(
  input: ListChildrenInput
): Promise<PathListing> {
  const db = getDb();
  const prefix = normalizePrefix(input.prefix);

  let docs: Array<{
    path: string;
    extension?: string;
    language?: string;
    size?: number;
    is_dir?: number;
  }>;

  if (input.kind === "repo") {
    // Query repos table
    if (prefix) {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM repos
        WHERE repo_id = ? AND (path = ? OR path LIKE ?)
      `).all(input.id, prefix, `${prefix}/%`) as typeof docs;
    } else {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM repos
        WHERE repo_id = ?
      `).all(input.id) as typeof docs;
    }
  } else {
    // Query files table
    if (prefix) {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM files
        WHERE project_id = ? AND (path = ? OR path LIKE ?)
      `).all(input.id, prefix, `${prefix}/%`) as typeof docs;
    } else {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM files
        WHERE project_id = ?
      `).all(input.id) as typeof docs;
    }
  }

  // Build immediate children at this level
  const dirSet = new Set<string>();
  const filesOut: PathListing["files"] = [];

  for (const doc of docs) {
    const rel = prefix ? doc.path.replace(new RegExp(`^${escapeRegex(prefix + "/")}`), "") : doc.path;
    if (rel === prefix) continue; // impossible, but guard

    const parts = rel.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) continue;

    const immediate = parts.length === 1;
    if (doc.is_dir) {
      // Explicit folder marker: always contributes a directory at this level
      dirSet.add(parts[0]);
      continue;
    }

    if (immediate) {
      // Immediate file in this directory
      filesOut.push({
        name: parts[0],
        path: doc.path,
        extension: doc.extension,
        language: doc.language,
        size: doc.size,
      });
    } else {
      dirSet.add(parts[0]);
    }
  }

  return {
    prefix,
    dirs: Array.from(dirSet).sort((a, b) => a.localeCompare(b)),
    files: filesOut.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getFileAtPath(input: {
  kind: "repo" | "project";
  id: string;
  path: string;
}): Promise<
  | (Pick<PathListing["files"][number], "path" | "extension" | "language" | "size"> & {
    name: string;
    sourceCode: string;
  })
  | null
> {
  const db = getDb();

  let doc: {
    path: string;
    extension?: string;
    language?: string;
    size?: number;
    source_code?: string;
    is_dir?: number;
  } | undefined;

  if (input.kind === "repo") {
    doc = db.prepare(`
      SELECT path, extension, language, size, source_code, is_dir
      FROM repos
      WHERE repo_id = ? AND path = ?
    `).get(input.id, input.path) as typeof doc;
  } else {
    doc = db.prepare(`
      SELECT path, extension, language, size, source_code, is_dir
      FROM files
      WHERE project_id = ? AND path = ?
    `).get(input.id, input.path) as typeof doc;
  }

  if (!doc) return null;
  if (doc.is_dir) return null; // Do not treat folders as files

  const segments = doc.path.split("/");
  return {
    name: segments[segments.length - 1],
    path: doc.path,
    extension: doc.extension,
    language: doc.language,
    size: doc.size,
    sourceCode: doc.source_code || "",
  };
}

function normalizePrefix(prefix?: string): string {
  const p = (prefix || "").replace(/^\/+|\/+$/g, "");
  return p;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
