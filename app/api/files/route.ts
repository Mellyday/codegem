import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";
import { auth, clerkClient } from "@clerk/nextjs/server";

type FilePayload = {
  userId?: string; // Ignored; server enforces Clerk user
  repoId?: string | null;
  projectId?: string | null;
  path: string;
  language: string;
  extension: string;
  sourceCode: string;
  ast: unknown;
  parseStatus?: "success" | "failed";
  parseError?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FilePayload;
    const db = await getDb();
    const files = db.collection("files");
    const now = new Date();
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Validate user exists in Clerk (optional safety)
    try {
      const client = await clerkClient();
      await client.users.getUser(clerkUserId);
    } catch (e) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const doc = {
      // Enforce server-side Clerk userId
      userId: clerkUserId,
      repoId: body.repoId ?? null,
      projectId: body.projectId ?? null,
      path: body.path,
      language: body.language,
      extension: body.extension,
      sourceCode: body.sourceCode,
      ast: body.ast,
      parseStatus: body.parseStatus ?? "success",
      parseError: body.parseError,
      size: Buffer.from(body.sourceCode, "utf8").length,
      createdAt: now,
      updatedAt: now,
    } as const;

    const result = await files.insertOne(doc);
    return NextResponse.json({ id: String(result.insertedId) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
