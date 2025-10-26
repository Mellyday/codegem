import { getDb } from "@/src/lib/mongodb";
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

async function ensureAuthedUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

async function getOptionalUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    return null;
  }
}

export async function listReposAndProjects(): Promise<TopLevelListing> {
  const userId = await getOptionalUserId();
  if (!userId) return { repos: [], projects: [] };
  const db = await getDb();
  const files = db.collection("files");

  // Distinct repoIds (excluding null)
  const repoIds = (await files
    .distinct("repoId", { userId, repoId: { $ne: null } })) as unknown[];

  // Distinct projectIds (excluding null)
  const projectIds = (await files.distinct("projectId", {
    userId,
    projectId: { $ne: null },
  })) as unknown[];

  const repos: RepoOrProjectItem[] = repoIds
    .filter(Boolean)
    .map((id) => ({ id: String(id), type: "repo" as const, label: `Repo ${String(id)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const projects: RepoOrProjectItem[] = projectIds
    .filter(Boolean)
    .map((id) => ({ id: String(id), type: "project" as const, label: `Project ${String(id)}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { repos, projects };
}

type ListChildrenInput =
  | { kind: "repo"; id: string; prefix?: string }
  | { kind: "project"; id: string; prefix?: string };

export async function listPathChildren(
  input: ListChildrenInput
): Promise<PathListing> {
  const userId = await ensureAuthedUserId();
  const db = await getDb();
  const files = db.collection("files");

  const prefix = normalizePrefix(input.prefix);
  const match: any = { userId };
  if (input.kind === "repo") {
    match.repoId = coerceId(input.id);
    match.projectId = null;
  } else {
    match.projectId = coerceId(input.id);
  }

  // Fetch candidate files under the prefix (or all at root if empty)
  // We need: documents where path === prefix (file at this path) or path startsWith `${prefix}/`
  const or: any[] = [];
  if (prefix) {
    or.push({ path: prefix });
    or.push({ path: { $regex: `^${escapeRegex(prefix + "/")}` } });
  } else {
    // At root: any path without a slash is a file at root; any with a slash contributes dirs
    or.push({});
  }

  const cursor = files.find({ ...match, ...(or.length ? { $or: or } : {}) }, {
    projection: { path: 1, extension: 1, language: 1, size: 1 },
  });
  const docs = (await cursor.toArray()) as Array<{
    path: string;
    extension?: string;
    language?: string;
    size?: number;
  }>;

  // Build immediate children at this level
  const dirSet = new Set<string>();
  const filesOut: PathListing["files"] = [];

  for (const doc of docs) {
    const rel = prefix ? doc.path.replace(new RegExp(`^${escapeRegex(prefix + "/")}`), "") : doc.path;
    if (rel === prefix) continue; // impossible, but guard

    const parts = rel.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) continue;

    if (!prefix) {
      // At root, doc.path like "a/b/c" => dir "a", or like "file.py" => file
      if (parts.length === 1) {
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
    } else {
      // Under a prefix, rel is path without the prefix
      if (parts.length === 1) {
        // immediate file in this directory
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
  const userId = await ensureAuthedUserId();
  const db = await getDb();
  const files = db.collection("files");
  const match: any = { userId, path: input.path };
  if (input.kind === "repo") {
    match.repoId = coerceId(input.id);
    match.projectId = null;
  } else {
    match.projectId = coerceId(input.id);
  }
  const doc = (await files.findOne(match)) as any;
  if (!doc) return null;
  const segments = doc.path.split("/");
  return {
    name: segments[segments.length - 1],
    path: doc.path as string,
    extension: doc.extension as string | undefined,
    language: doc.language as string | undefined,
    size: doc.size as number | undefined,
    sourceCode: doc.sourceCode as string,
  };
}

function normalizePrefix(prefix?: string): string {
  const p = (prefix || "").replace(/^\/+|\/+$/g, "");
  return p;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coerceId(id: string): any {
  // We allow stringified ObjectId or already-serialized strings depending on how data was inserted.
  // Avoid importing ObjectId on the edge; Mongo will match string values too if stored as string.
  return (id as unknown) as any;
}
