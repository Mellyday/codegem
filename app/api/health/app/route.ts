export const runtime = 'nodejs';
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/src/lib/mongodb";

export async function GET() {
  const env = {
    hasMongoUri: Boolean(process.env.MONGODB_URI),
    hasClerkPublishable: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    hasClerkSecret: Boolean(process.env.CLERK_SECRET_KEY),
  } as const;

  let authUserId: string | null = null;
  try {
    const { userId } = await auth();
    authUserId = userId ?? null;
  } catch (e) {
    // ignore, surface below
  }

  const dbStatus: {
    ok: boolean;
    error?: string;
    pingOk?: boolean;
  } = { ok: false };

  try {
    const db = await getDb();
    // Ping
    try {
      const ping = await db.command({ ping: 1 });
      dbStatus.pingOk = ping?.ok === 1;
    } catch (e) {
      dbStatus.pingOk = false;
    }
    dbStatus.ok = true;
  } catch (e) {
    dbStatus.ok = false;
    dbStatus.error = String(e);
  }

  return NextResponse.json({ env, authUserId, db: dbStatus });
}
