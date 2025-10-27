import { NextResponse } from "next/server";
import { getDb } from "@/src/lib/mongodb";
import { auth, clerkClient } from "@clerk/nextjs/server";

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

    // Optionally confirm user exists in Clerk
    try {
      await clerkClient.users.getUser(userId);
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body || (body.action !== "create_folder" && body.action !== "create_snippet")) {
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

    return NextResponse.json({ error: "Unsupported" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
