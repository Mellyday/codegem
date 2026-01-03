export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import Link from "next/link";
import { getFileAtPath, listPathChildren } from "@/src/server/browse";
import { SandboxViewer } from "@/src/components/SandboxViewer";
import { ExplorerActions } from "@/src/components/ExplorerActions";
import { FileListing } from "@/src/components/FileListing";

type Params = { id: string; path?: string[] };

export default async function RepoBrowsePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, path } = await params;
  const prefix = Array.isArray(path) ? path.join("/") : "";
  const file = prefix
    ? await getFileAtPath({ kind: "repo", id, path: prefix })
    : null;

  if (file) {
    return (
      <SandboxViewer
        sandboxId={`repo/${id}/${file.path}`}
        fileName={file.path}
        initialCode={file.sourceCode}
      />
    );
  }

  const listing = await listPathChildren({ kind: "repo", id, prefix });

  return (
    <main className="min-h-screen bg-rose-50 text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Breadcrumb kind="repo" id={id} prefix={listing.prefix} />
        <ExplorerActions kind="repo" id={id} prefix={listing.prefix} />
        <FileListing
          kind="repo"
          id={id}
          prefix={listing.prefix}
          dirs={listing.dirs}
          files={listing.files}
        />
      </section>
    </main>
  );
}

function Breadcrumb({
  kind,
  id,
  prefix,
}: {
  kind: "repo" | "project";
  id: string;
  prefix?: string;
}) {
  const segments = (prefix || "").split("/").filter(Boolean);
  const baseHref = `/${kind}/${encodeURIComponent(id)}`;
  const crumbs = [
    { name: kind === "repo" ? "Repo" : "Project", href: baseHref },
    ...segments.map((seg, idx) => ({
      name: seg,
      href: `${baseHref}/${segments.slice(0, idx + 1).map(encodeURIComponent).join("/")}`,
    })),
  ];
  return (
    <nav className="text-sm text-rose-600">
      <Link href="/" className="hover:underline">Home</Link>
      <span className="mx-2">/</span>
      {crumbs.map((c, i) => (
        <span key={c.href}>
          <Link href={c.href} className="hover:underline">{c.name}</Link>
          {i < crumbs.length - 1 && <span className="mx-2">/</span>}
        </span>
      ))}
    </nav>
  );
}
