import Link from "next/link";
import { notFound } from "next/navigation";
import { readSandbox } from "@/src/server/sandbox";
import { SandboxViewer } from "@/src/components/SandboxViewer";

type Params = {
  sandboxId: string;
};

export default async function SandboxPage({ params }: { params: Params }) {
  const { sandboxId } = params;
  const data = readSandbox(sandboxId);

  if (!data) {
    return (
      <main className="min-h-screen bg-[#E8EBF0] text-slate-800">
        <section className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold text-slate-800">
              Route not found
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              We couldn't find a sandbox file for the route "{sandboxId}".
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow"
            >
              Back to Routes
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <SandboxViewer
      sandboxId={sandboxId}
      fileName={data.fileName}
      initialCode={data.code}
    />
  );
}
