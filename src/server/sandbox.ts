import { getDb } from "../lib/mongodb";

export type SandboxRoute = {
  fileName: string;
  routePath: string;
  label: string;
  astSupport: "tree-sitter" | "none";
};

export async function listSandboxes(): Promise<SandboxRoute[]> {
  const db = await getDb();
  const files = db.collection("files");
  const docs = await files
    .find({}, { projection: { path: 1, extension: 1 } })
    .toArray();

  const routes: SandboxRoute[] = docs
    .map((doc: any) => {
      const routePath = (doc.path as string).replace(/\.[^/.]+$/, "");
      const extension = (doc.extension as string) || "";
      const astSupport: "tree-sitter" | "none" =
        extension === "py" ? "tree-sitter" : "none";
      return {
        fileName: doc.path as string,
        routePath,
        label: routePath,
        astSupport,
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));

  return routes;
}

export async function readSandbox(
  routePath: string
): Promise<{ fileName: string; code: string } | null> {
  const db = await getDb();
  const files = db.collection("files");
  const path = `${routePath}.py`;
  const doc = await files.findOne({ path });
  if (!doc || typeof (doc as any).sourceCode !== "string") return null;
  return {
    fileName: doc.path as string,
    code: (doc as any).sourceCode as string,
  };
}
