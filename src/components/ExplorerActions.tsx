"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ExplorerActions({
  kind,
  id,
  prefix,
}: {
  kind: "repo" | "project";
  id: string;
  prefix?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showSnippetModal, setShowSnippetModal] = useState(false);
  const [snippetName, setSnippetName] = useState("");
  const [snippetCode, setSnippetCode] = useState("");

  const createFolder = async () => {
    const name = window.prompt("New folder name:");
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/fs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_folder", kind, id, prefix, name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        alert(`Failed to create folder: ${data.error || res.statusText}`);
      } else {
        const path = [prefix?.replace(/^\/+|\/+$/g, ""), name]
          .filter(Boolean)
          .join("/");
        router.push(`/${kind}/${encodeURIComponent(id)}/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSnippet = async () => {
    const name = snippetName.trim();
    if (!name) return;
    const initial = snippetCode;
    setBusy(true);
    try {
      const res = await fetch("/api/fs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_snippet",
          kind,
          id,
          prefix,
          name,
          sourceCode: initial,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any));
        alert(`Failed to create snippet: ${data.error || res.statusText}`);
      } else {
        const path = [prefix?.replace(/^\/+|\/+$/g, ""), name]
          .filter(Boolean)
          .join("/");
        router.push(`/${kind}/${encodeURIComponent(id)}/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`);
        setShowSnippetModal(false);
        setSnippetName("");
        setSnippetCode("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={createFolder}
          disabled={busy}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-rose-700 disabled:opacity-50"
        >
          New Folder
        </button>
        <button
          type="button"
          onClick={() => setShowSnippetModal(true)}
          disabled={busy}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
        >
          New Snippet
        </button>
      </div>

      {showSnippetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-4 shadow-lg">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Create Snippet</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Filename</label>
                <input
                  type="text"
                  value={snippetName}
                  onChange={(e) => setSnippetName(e.target.value)}
                  placeholder="e.g. test/comprehensive.py"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Code</label>
                <textarea
                  value={snippetCode}
                  onChange={(e) => setSnippetCode(e.target.value)}
                  placeholder="# Write your snippet..."
                  rows={10}
                  className="w-full resize-y rounded border border-slate-300 px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  setShowSnippetModal(false);
                  setSnippetName("");
                  setSnippetCode("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !snippetName.trim()}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
                onClick={submitSnippet}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
