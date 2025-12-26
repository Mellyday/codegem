export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { listReposAndProjects } from "@/src/server/browse";
import { RepoProjectItem } from "@/src/components/RepoProjectItem";

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
                  <RepoProjectItem
                    key={r.id}
                    id={r.id}
                    label={r.label}
                    kind="repo"
                  />
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
                  <RepoProjectItem
                    key={p.id}
                    id={p.id}
                    label={p.label}
                    kind="project"
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
