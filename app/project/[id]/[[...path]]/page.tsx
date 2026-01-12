export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import Link from "next/link";
import { getFileAtPath, listPathChildren } from "@/src/server/browse";
import { SandboxViewer } from "@/src/components/SandboxViewer";
import { ExplorerActions } from "@/src/components/ExplorerActions";
import { DeleteButton } from "@/src/components/DeleteButton";
import { FileListing } from "@/src/components/FileListing";

type Params = { id: string; path?: string[] };

export default async function ProjectBrowsePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, path } = await params;
  const prefix = Array.isArray(path) ? path.join("/") : "";
  const file = prefix
    ? await getFileAtPath({ kind: "project", id, path: prefix })
    : null;

  if (file) {
    return (
      <SandboxViewer
        sandboxId={`project/${id}/${file.path}`}
        fileName={file.path}
        initialCode={file.sourceCode}
      />
    );
  }

  const listing = await listPathChildren({ kind: "project", id, prefix });

  return (
    <main className="min-h-screen bg-gradient-to-b from-cyan-50 via-teal-50/80 to-emerald-50/60 text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Breadcrumb kind="project" id={id} prefix={listing.prefix} />
        <ExplorerActions kind="project" id={id} prefix={listing.prefix} />
        <FileListing
          kind="project"
          id={id}
          prefix={listing.prefix}
          dirs={listing.dirs}
          files={listing.files}
          showDelete
          DeleteButton={DeleteButton}
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
    <nav className="text-sm text-cyan-600">
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
