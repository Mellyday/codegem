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

// User-first, DEV-fallback resolver for repos
function resolveEffectiveUserIdForRepo(db: any, repoId: string, userId?: string | null): string | null {
  if (userId) {
    const hasUser = db.prepare(`SELECT 1 FROM repos WHERE repo_id = ? AND user_id = ? LIMIT 1`).get(repoId, userId);
    if (hasUser) return userId;
  }
  const hasDev = db.prepare(`SELECT 1 FROM repos WHERE repo_id = ? AND user_id = ? LIMIT 1`).get(repoId, DEV_USER_ID);
  if (hasDev) return DEV_USER_ID;
  return null;
}

// User-first, DEV-fallback resolver for projects
function resolveEffectiveUserIdForProject(db: any, projectId: string, userId?: string | null): string | null {
  if (userId) {
    const hasUser = db.prepare(`SELECT 1 FROM files WHERE project_id = ? AND user_id = ? LIMIT 1`).get(projectId, userId);
    if (hasUser) return userId;
  }
  const hasDev = db.prepare(`SELECT 1 FROM files WHERE project_id = ? AND user_id = ? LIMIT 1`).get(projectId, DEV_USER_ID);
  if (hasDev) return DEV_USER_ID;
  return null;
}

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

  // Build repos list - filter in SQL to avoid scanning all users' data
  const repoRows = db.prepare(`
    SELECT user_id, repo_id, MIN(owner) as owner, MIN(name) as name
    FROM repos
    WHERE repo_id IS NOT NULL
      AND (user_id = ? OR user_id = ?)
    GROUP BY user_id, repo_id
  `).all(userId ?? "__no_user__", DEV_USER_ID) as Array<{ user_id: string; repo_id: string; owner: string; name: string }>;

  const repos: RepoOrProjectItem[] = repoRows
    .map((g) => ({
      id: String(g.repo_id),
      type: "repo" as const,
      label: g.owner && g.name ? `${g.owner}/${g.name}` : `Repo ${String(g.repo_id)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Build projects list - filter in SQL
  const projectRows = db.prepare(`
    SELECT user_id, project_id, MIN(project_name) as project_name
    FROM files
    WHERE project_id IS NOT NULL
      AND (user_id = ? OR user_id = ?)
    GROUP BY user_id, project_id
  `).all(userId ?? "__no_user__", DEV_USER_ID) as Array<{ user_id: string; project_id: string; project_name: string | null }>;

  const projects: RepoOrProjectItem[] = projectRows
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
  const userId = await getOptionalUserId();

  // Resolve effective user_id (user-first, DEV-fallback)
  const effectiveUserId =
    input.kind === "repo"
      ? resolveEffectiveUserIdForRepo(db, input.id, userId)
      : resolveEffectiveUserIdForProject(db, input.id, userId);

  // If no accessible copy found, return empty
  if (!effectiveUserId) {
    return { prefix, dirs: [], files: [] };
  }

  let docs: Array<{
    path: string;
    extension?: string;
    language?: string;
    size?: number;
    is_dir?: number;
  }>;

  if (input.kind === "repo") {
    // Query repos table - NOW SCOPED BY user_id
    if (prefix) {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM repos
        WHERE user_id = ? AND repo_id = ? AND (path = ? OR path LIKE ?)
      `).all(effectiveUserId, input.id, prefix, `${prefix}/%`) as typeof docs;
    } else {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM repos
        WHERE user_id = ? AND repo_id = ?
      `).all(effectiveUserId, input.id) as typeof docs;
    }
  } else {
    // Query files table - NOW SCOPED BY user_id
    if (prefix) {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM files
        WHERE user_id = ? AND project_id = ? AND (path = ? OR path LIKE ?)
      `).all(effectiveUserId, input.id, prefix, `${prefix}/%`) as typeof docs;
    } else {
      docs = db.prepare(`
        SELECT path, extension, language, size, is_dir
        FROM files
        WHERE user_id = ? AND project_id = ?
      `).all(effectiveUserId, input.id) as typeof docs;
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
  const userId = await getOptionalUserId();

  // Resolve effective user_id (user-first, DEV-fallback)
  const effectiveUserId =
    input.kind === "repo"
      ? resolveEffectiveUserIdForRepo(db, input.id, userId)
      : resolveEffectiveUserIdForProject(db, input.id, userId);

  // If no accessible copy found, return null
  if (!effectiveUserId) {
    return null;
  }

  let doc: {
    path: string;
    extension?: string;
    language?: string;
    size?: number;
    source_code?: string;
    is_dir?: number;
  } | undefined;

  if (input.kind === "repo") {
    // NOW SCOPED BY user_id
    doc = db.prepare(`
      SELECT path, extension, language, size, source_code, is_dir
      FROM repos
      WHERE user_id = ? AND repo_id = ? AND path = ?
    `).get(effectiveUserId, input.id, input.path) as typeof doc;
  } else {
    // NOW SCOPED BY user_id
    doc = db.prepare(`
      SELECT path, extension, language, size, source_code, is_dir
      FROM files
      WHERE user_id = ? AND project_id = ? AND path = ?
    `).get(effectiveUserId, input.id, input.path) as typeof doc;
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
