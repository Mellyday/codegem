import Link from "next/link";
import { listSandboxes } from "@/src/server/sandbox";

export default async function HomePage() {
  const sandboxRoutes = await listSandboxes();

  return (
    <main className="min-h-screen bg-rose-50 text-slate-900">
      <section className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold text-rose-700">
            Code Sandbox Routes
          </h1>
          <p className="text-sm text-rose-500">
            Select a sandbox file to visit its placeholder route.
          </p>
        </header>
        {sandboxRoutes.length === 0 ? (
          <p className="italic text-rose-400">No sandbox files detected.</p>
        ) : (
          <ul className="grid gap-3">
            {sandboxRoutes.map(({ routePath, label, astSupport }) => (
              <li key={routePath}>
                <Link
                  href={`/${routePath}`}
                  className="flex items-center justify-between rounded-lg border border-rose-200 bg-white/70 px-4 py-3 text-base font-medium transition hover:border-rose-300 hover:bg-white hover:text-rose-700"
                >
                  <span>{label}</span>
                  <span className="text-[0.65rem] uppercase tracking-wide text-rose-400">
                    {astSupport === "tree-sitter"
                      ? "AST via Tree-sitter"
                      : "AST unsupported"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
