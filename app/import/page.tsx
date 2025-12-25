import GitHubImportSection from "@/src/components/GitHubImportSection";

export default function ImportPage() {
    return (
        <main className="min-h-screen bg-rose-50 text-slate-900">
            <section className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
                <header className="space-y-2">
                    <h1 className="text-3xl font-semibold text-rose-700">Import Repository</h1>
                    <p className="text-sm text-rose-500">
                        Fetch a GitHub repository and parse it for code analysis.
                    </p>
                </header>

                <GitHubImportSection />
            </section>
        </main>
    );
}
