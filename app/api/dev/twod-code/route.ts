import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "code_sandbox", "twod_matrix.py");
    const source = await readFile(filePath, "utf8");
    return NextResponse.json({ source });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
