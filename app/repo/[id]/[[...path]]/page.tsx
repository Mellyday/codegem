import Link from "next/link";
import { getFileAtPath, listPathChildren } from "@/src/server/browse";

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
    // Simple file viewer
    return (
      <main className="min-h-screen bg-rose-50 text-slate-900">
        <section className="mx-auto max-w-4xl px-6 py-8">
          <Breadcrumb kind="repo" id={id} prefix={prefix} />
          <article className="mt-4 rounded-lg border border-rose-200 bg-white p-4">
            <header className="mb-3 flex items-center justify-between">
              <h1 className="text-lg font-semibold text-rose-700">{file.name}</h1>
              <span className="text-xs text-rose-400">{file.language || file.extension || ""}</span>
            </header>
            <pre className="overflow-auto rounded bg-rose-50 p-3 text-sm text-slate-800">
              <code>{file.sourceCode}</code>
            </pre>
          </article>
        </section>
      </main>
    );
  }

  const listing = await listPathChildren({ kind: "repo", id, prefix });

  return (
    <main className="min-h-screen bg-rose-50 text-slate-900">
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Breadcrumb kind="repo" id={id} prefix={listing.prefix} />
        <ul className="mt-4 divide-y divide-rose-100 rounded-lg border border-rose-200 bg-white">
          {listing.dirs.map((d) => (
            <li key={`dir:${d}`} className="flex items-center justify-between px-4 py-3">
              <Link
                href={`/repo/${encodeURIComponent(id)}/${encodeURIComponent(
                  [listing.prefix, d].filter(Boolean).join("/")
                )}`}
                className="font-medium text-rose-700 hover:underline"
              >
                {d}/
              </Link>
              <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">Folder</span>
            </li>
          ))}
          {listing.files.map((f) => (
            <li key={`file:${f.path}`} className="flex items-center justify-between px-4 py-3">
              <Link
                href={`/repo/${encodeURIComponent(id)}/${encodeURIComponent(f.path)}`}
                className="text-slate-800 hover:underline"
              >
                {f.name}
              </Link>
              <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">File</span>
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

