import { MongoClient } from "mongodb";
import dns from "node:dns";

let cachedClient: MongoClient | null = null;
let cachedPromise: Promise<MongoClient> | null = null;

const uri = process.env.MONGODB_URI;

export function getMongoUri(): string {
  if (!uri) {
    throw new Error("MONGODB_URI is not set in environment");
  }
  return uri;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  if (!cachedPromise) {
    const mongoUri = getMongoUri();
    cachedPromise = (async () => {
      try {
        const client = await MongoClient.connect(mongoUri, {});
        cachedClient = client;
        return client;
      } catch (error) {
        const message = String(error || "");
        const isSrv = mongoUri.startsWith("mongodb+srv://");
        const srvProblem =
          message.includes("queryTxt ESERVFAIL") ||
          message.includes("querySrv") ||
          message.includes("ENOTFOUND") ||
          message.includes("ESERVFAIL");
        if (isSrv && srvProblem) {
          const seedUri = await buildSeedListUriFromSrv(mongoUri).catch(
            () => null
          );
          if (seedUri) {
            const client = await MongoClient.connect(seedUri, {});
            cachedClient = client;
            return client;
          }
        }
        throw error;
      }
    })();
  }
  return cachedPromise;
}

export async function getDb(dbName = "codegem"): Promise<import("mongodb").Db> {
  const client = await getMongoClient();
  return client.db(dbName);
}

async function buildSeedListUriFromSrv(originalUri: string): Promise<string> {
  // Parse SRV URI and perform DNS resolution to construct a mongodb:// seed list URI
  const url = new URL(originalUri);
  const host = url.hostname;
  const username = url.username;
  const password = url.password;
  const dbName = url.pathname?.replace(/^\//, "") || "";

  const srvName = `_mongodb._tcp.${host}`;
  const [srvRecords, txtRecords] = await Promise.all([
    dns.promises.resolveSrv(srvName),
    dns.promises.resolveTxt(host).catch(() => [] as string[][]),
  ]);

  const seeds = srvRecords.map((r) => `${r.name}:${r.port}`).join(",");

  // Extract TXT options like replicaSet and authSource
  const txtParams = new URLSearchParams();
  for (const entry of txtRecords) {
    // Each TXT record entry is an array of strings; join them then parse as query
    const raw = entry.join("");
    const parts = raw.split("&");
    for (const part of parts) {
      const [k, v] = part.split("=");
      if (k && v) txtParams.set(k, v);
    }
  }

  // Merge original query params with TXT, without overwriting explicit original values
  const merged = new URLSearchParams(txtParams);
  url.searchParams.forEach((value, key) => {
    merged.set(key, value);
  });

  // Ensure TLS unless explicitly disabled
  if (!merged.has("tls") && !merged.has("ssl")) {
    merged.set("tls", "true");
  }

  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : "";
  const dbPath = dbName ? `/${dbName}` : "/";
  const query = merged.toString();
  const seedUri = `mongodb://${auth}${seeds}${dbPath}${
    query ? `?${query}` : ""
  }`;
  return seedUri;
}
