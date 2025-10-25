import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";

type FilePayload = {
  userId?: string; // TODO: integrate Clerk later
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

    const doc = {
      userId: body.userId ?? null,
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
