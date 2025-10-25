import { NextResponse } from "next/server";
import dns from "node:dns";

const dnsPromises = dns.promises;

function extractHostFromSrvUri(uri: string): string | null {
  // mongodb+srv://user:pass@HOST/db?opts
  try {
    if (!uri.startsWith("mongodb+srv://")) return null;
    const withoutScheme = uri.replace("mongodb+srv://", "");
    const atIdx = withoutScheme.indexOf("@");
    const hostAndRest =
      atIdx >= 0 ? withoutScheme.slice(atIdx + 1) : withoutScheme;
    const slashIdx = hostAndRest.indexOf("/");
    const host = slashIdx >= 0 ? hostAndRest.slice(0, slashIdx) : hostAndRest;
    return host || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const uri = process.env.MONGODB_URI || "";
  const host = extractHostFromSrvUri(uri);
  if (!uri) {
    return NextResponse.json({ error: "MONGODB_URI not set" }, { status: 400 });
  }
  if (!host) {
    return NextResponse.json({
      note: "Not an SRV URI or failed to parse host",
      uri,
    });
  }

  const srvName = `_mongodb._tcp.${host}`;
  const result: Record<string, unknown> = { uri, host, srvName };

  try {
    const [srv, txt] = await Promise.all([
      dnsPromises.resolveSrv(srvName).catch((e) => ({ error: String(e) })),
      dnsPromises.resolveTxt(host).catch((e) => ({ error: String(e) })),
    ]);
    const servers = dns.getServers();
    result.srv = srv;
    result.txt = txt;
    result.resolvers = servers;
  } catch (error) {
    result.error = String(error);
  }

  return NextResponse.json(result);
}
