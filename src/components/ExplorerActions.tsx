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
        router.push(`/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(path)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const createSnippet = async () => {
    const name = window.prompt("New snippet filename (e.g. hello.py):");
    if (!name) return;
    const initial = ""; // Could add language/template detection later
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
        router.push(`/${kind}/${encodeURIComponent(id)}/${encodeURIComponent(path)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
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
        onClick={createSnippet}
        disabled={busy}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
      >
        New Snippet
      </button>
    </div>
  );
}
