import GitHubImportSection from "@/src/components/GitHubImportSection";

export default function ImportPage() {
    return (
        <main className="min-h-screen bg-gradient-to-b from-cyan-50 via-teal-50/80 to-emerald-50/60 text-slate-900">
            <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
                <header className="space-y-2">
                    <h1 className="text-3xl font-semibold text-cyan-700">Import Repository</h1>
                    <p className="text-sm text-cyan-600/80">
                        Fetch a GitHub repository and parse it for code analysis.
                    </p>
                </header>

                <GitHubImportSection />
            </section>
        </main>
    );
}
