export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { getDb } from "@/src/lib/mongodb";
import { auth } from "@clerk/nextjs/server";
import { ObjectId } from "mongodb";

type FsAction =
  | {
    action: "create_folder";
    kind: "repo" | "project";
    id: string;
    prefix?: string;
    name: string;
  }
  | {
    action: "create_snippet";
    kind: "repo" | "project";
    id: string;
    prefix?: string;
    name: string; // file name, e.g. hello.py
    language?: string;
    sourceCode?: string;
  }
  | {
    action: "delete";
    kind: "repo" | "project";
    id: string;
    path: string; // full path to delete
    isDir?: boolean; // if true, recursively delete folder contents
  };

function normalizePrefix(prefix?: string): string {
  return (prefix || "").replace(/^\/+|\/+$/g, "");
}

function joinPath(prefix: string | undefined, name: string): string {
  const p = normalizePrefix(prefix);
  return [p, name].filter(Boolean).join("/");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FsAction;
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Session is already validated by Clerk via auth(); no extra lookup needed

    if (!body || (body.action !== "create_folder" && body.action !== "create_snippet" && body.action !== "delete")) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const db = await getDb();
    const files = db.collection("files");

    // Basic validation
    const { kind, id } = body as any;
    if (!kind || !id) {
      return NextResponse.json({ error: "Missing kind or id" }, { status: 400 });
    }

    if (body.action === "create_folder") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
      if (name.includes("/")) {
        return NextResponse.json({ error: "Folder name cannot contain '/'" }, { status: 400 });
      }
      const path = joinPath(body.prefix, name);
      const match: any = { userId, path };
      if (body.kind === "repo") {
        match.repoId = body.id as any;
        match.projectId = null;
      } else {
        match.projectId = body.id as any;
      }
      const existing = await files.findOne(match, { projection: { _id: 1 } });
      if (existing) {
        return NextResponse.json({ error: "Path already exists" }, { status: 409 });
      }
      const now = new Date();
      const doc: any = {
        userId,
        path,
        isDir: true,
        createdAt: now,
      };
      if (body.kind === "repo") {
        doc.repoId = body.id as any;
        doc.projectId = null;
      } else {
        doc.projectId = body.id as any;
      }
      const res = await files.insertOne(doc);
      return NextResponse.json({ ok: true, id: String(res.insertedId) });
    }

    if (body.action === "create_snippet") {
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
      if (name.endsWith("/")) {
        return NextResponse.json({ error: "File name cannot end with '/'" }, { status: 400 });
      }
      const path = joinPath(body.prefix, name);
      const match: any = { userId, path };
      if (body.kind === "repo") {
        match.repoId = body.id as any;
        match.projectId = null;
      } else {
        match.projectId = body.id as any;
      }
      const existing = await files.findOne(match, { projection: { _id: 1, isDir: 1 } });
      if (existing) {
        return NextResponse.json({ error: "Path already exists" }, { status: 409 });
      }
      const now = new Date();
      const extension = name.includes(".") ? name.split(".").pop() : undefined;
      const doc: any = {
        userId,
        path,
        extension,
        language: (body as any).language,
        size: (body.sourceCode ?? "").length,
        sourceCode: body.sourceCode ?? "",
        createdAt: now,
      };
      if (body.kind === "repo") {
        doc.repoId = body.id as any;
        doc.projectId = null;
      } else {
        doc.projectId = body.id as any;
      }
      const res = await files.insertOne(doc);
      return NextResponse.json({ ok: true, id: String(res.insertedId) });
    }

    if (body.action === "delete") {
      const path = body.path?.trim();
      if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

      const match: any = { path };
      // Coerce ID to ObjectId for proper matching with dev-pushed files
      let idAsObject: any = body.id;
      try {
        idAsObject = new ObjectId(String(body.id));
      } catch {
        // Keep as string if not a valid ObjectId
      }
      if (body.kind === "repo") {
        match.repoId = idAsObject;
        match.projectId = null;
      } else {
        match.projectId = idAsObject;
      }

      let deletedCount = 0;

      if (body.isDir) {
        // Delete the folder marker and all files under this path prefix
        const folderMatch: any = {
          $or: [
            { ...match }, // The folder itself
            {
              ...(body.kind === "repo"
                ? { repoId: idAsObject, projectId: null }
                : { projectId: idAsObject }),
              path: { $regex: `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/` }
            }
          ]
        };
        const res = await files.deleteMany(folderMatch);
        deletedCount = res.deletedCount ?? 0;
      } else {
        // Delete single file
        const res = await files.deleteOne(match);
        deletedCount = res.deletedCount ?? 0;
      }

      if (deletedCount === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({ ok: true, deletedCount });
    }

    return NextResponse.json({ error: "Unsupported" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
