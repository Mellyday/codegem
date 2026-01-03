export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import Link from "next/link";
import { getFileAtPath, listPathChildren } from "@/src/server/browse";
import { SandboxViewer } from "@/src/components/SandboxViewer";
import { ExplorerActions } from "@/src/components/ExplorerActions";
import { DeleteButton } from "@/src/components/DeleteButton";
import { FileQuizActions } from "@/src/components/FileQuizActions";

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
    <main className="min-h-screen bg-rose-50 text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Breadcrumb kind="project" id={id} prefix={listing.prefix} />
        <ExplorerActions kind="project" id={id} prefix={listing.prefix} />
        <ul className="mt-4 divide-y divide-rose-100 rounded-lg border border-rose-200 bg-white">
          {listing.dirs.map((d) => {
            const dirPath = [listing.prefix, d].filter(Boolean).join("/");
            return (
              <li key={`dir:${d}`} className="flex items-center justify-between px-4 py-3">
                <Link
                  href={`/project/${encodeURIComponent(id)}/${dirPath
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")}`}
                  className="font-medium text-rose-700 hover:underline"
                >
                  {d}/
                </Link>
                <div className="flex items-center">
                  <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">Folder</span>
                  <DeleteButton kind="project" id={id} path={dirPath} isDir label="×" />
                </div>
              </li>
            );
          })}
          {listing.files.map((f) => (
            <li key={`file:${f.path}`} className="flex items-center justify-between px-4 py-3">
              <Link
                href={`/project/${encodeURIComponent(id)}/${f.path
                  .split("/")
                  .map(encodeURIComponent)
                  .join("/")}`}
                className="text-slate-800 hover:underline"
              >
                {f.name}
              </Link>
              <div className="flex items-center gap-2">
                <FileQuizActions kind="project" id={id} path={f.path} />
                <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">File</span>
                <DeleteButton kind="project" id={id} path={f.path} label="×" />
              </div>
            </li>
          ))}
          {listing.dirs.length === 0 && listing.files.length === 0 && (
            <li className="px-4 py-6 text-sm italic text-rose-400">Empty</li>
          )}
        </ul>
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
