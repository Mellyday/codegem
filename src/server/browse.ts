import { getDb } from "@/src/lib/mongodb";
import { auth } from "@clerk/nextjs/server";
import { ObjectId } from "mongodb";

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
  // Be resilient when MongoDB is unavailable (e.g., offline or DNS SRV blocked)
  // If DB connection fails, return empty lists instead of erroring the page.
  let db: any;
  try {
    db = await getDb();
  } catch {
    return { repos: [], projects: [] };
  }

  // Get current user (if logged in) for filtering
  const userId = await getOptionalUserId();

  // Build user filter: show current user's items + dev items
  // If not logged in, only show dev items
  const userFilter = userId
    ? { userId: { $in: [userId, DEV_USER_ID] } }
    : { userId: DEV_USER_ID };

  const files = db.collection("files");
  const reposCol = db.collection("repos");

  // Repos are stored in the "repos" collection - filter by user
  const repoAgg = await reposCol
    .aggregate([
      { $match: { repoId: { $ne: null }, ...userFilter } },
      {
        $group: {
          _id: "$repoId",
          owner: { $first: "$owner" },
          name: { $first: "$name" },
        },
      },
    ])
    .toArray();

  // Projects are stored in the "files" collection - filter by user
  const projectAgg = await files
    .aggregate([
      { $match: { projectId: { $ne: null }, ...userFilter } },
      {
        $group: {
          _id: "$projectId",
          projectName: { $first: "$projectName" },
        },
      },
    ])
    .toArray();

  const repos: RepoOrProjectItem[] = repoAgg
    .map((g: any) => ({
      id: String(g._id),
      type: "repo" as const,
      label: g.owner && g.name ? `${g.owner}/${g.name}` : `Repo ${String(g._id)}`,
    }))
    .sort((a: RepoOrProjectItem, b: RepoOrProjectItem) => a.label.localeCompare(b.label));

  const projects: RepoOrProjectItem[] = projectAgg
    .filter((g: any) => g._id)
    .map((g: any) => ({
      id: String(g._id),
      type: "project" as const,
      label: g.projectName || `Project ${String(g._id)}`,
    }))
    .sort((a: RepoOrProjectItem, b: RepoOrProjectItem) => a.label.localeCompare(b.label));

  return { repos, projects };
}

type ListChildrenInput =
  | { kind: "repo"; id: string; prefix?: string }
  | { kind: "project"; id: string; prefix?: string };

export async function listPathChildren(
  input: ListChildrenInput
): Promise<PathListing> {
  const db = await getDb();
  const files = db.collection("files");

  const prefix = normalizePrefix(input.prefix);
  const match: any = {};
  let col = files as any;
  if (input.kind === "repo") {
    match.repoId = coerceId(input.id);
    match.projectId = null;
    col = db.collection("repos");
  } else {
    match.projectId = coerceId(input.id);
    col = files;
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

  const cursor = col.find({ ...match, ...(or.length ? { $or: or } : {}) }, {
    projection: { path: 1, extension: 1, language: 1, size: 1, isDir: 1 },
  });
  const docs = (await cursor.toArray()) as unknown as Array<{
    path: string;
    extension?: string;
    language?: string;
    size?: number;
    isDir?: boolean;
  }>;

  // Build immediate children at this level
  const dirSet = new Set<string>();
  const filesOut: PathListing["files"] = [];

  for (const doc of docs) {
    const rel = prefix ? doc.path.replace(new RegExp(`^${escapeRegex(prefix + "/")}`), "") : doc.path;
    if (rel === prefix) continue; // impossible, but guard

    const parts = rel.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) continue;

    const immediate = parts.length === 1;
    if (doc.isDir) {
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
    dirs: Array.from(dirSet).sort((a: string, b: string) => a.localeCompare(b)),
    files: filesOut.sort(
      (
        a: PathListing["files"][number],
        b: PathListing["files"][number]
      ) => a.name.localeCompare(b.name)
    ),
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
  const db = await getDb();
  const files = db.collection("files");
  const reposCol = db.collection("repos");
  const match: any = { path: input.path };
  let col = files as any;
  if (input.kind === "repo") {
    match.repoId = coerceId(input.id);
    match.projectId = null;
    col = reposCol;
  } else {
    match.projectId = coerceId(input.id);
    col = files;
  }
  const doc = (await col.findOne(match)) as any;
  if (!doc) return null;
  if ((doc as any).isDir) return null; // Do not treat folders as files
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
  // Try to coerce stringified ObjectIds to real ObjectIds for proper matching
  try {
    // Accept 24-hex string or already an ObjectId-like value
    return new ObjectId(id);
  } catch {
    return (id as unknown) as any;
  }
}
