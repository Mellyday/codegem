export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import Link from "next/link";
import { listReposAndProjects } from "@/src/server/browse";

export default async function HomePage() {
  const { repos, projects } = await listReposAndProjects();

  return (
    <main className="min-h-screen bg-rose-50 text-slate-900">
      <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-rose-700">Your Code</h1>
          <p className="text-sm text-rose-500">
            Choose a repo or a project to browse like a filesystem.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-rose-700">Repos</h2>
            {repos.length === 0 ? (
              <p className="italic text-rose-400">No repos yet.</p>
            ) : (
              <ul className="grid gap-2">
                {repos.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/repo/${encodeURIComponent(r.id)}`}
                      className="flex items-center justify-between rounded-lg border border-rose-200 bg-white/70 px-4 py-3 text-sm font-medium transition hover:border-rose-300 hover:bg-white hover:text-rose-700"
                    >
                      <span>{r.label}</span>
                      <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">
                        Browse
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-rose-700">Projects</h2>
            {projects.length === 0 ? (
              <p className="italic text-rose-400">No projects yet.</p>
            ) : (
              <ul className="grid gap-2">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/project/${encodeURIComponent(p.id)}`}
                      className="flex items-center justify-between rounded-lg border border-rose-200 bg-white/70 px-4 py-3 text-sm font-medium transition hover:border-rose-300 hover:bg-white hover:text-rose-700"
                    >
                      <span>{p.label}</span>
                      <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">
                        Browse
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

