"use client";
import { useCallback, useState } from "react";
import { parseWithTreeSitter } from "@/src/lib/treeSitter";

export default function Page() {
  const [status, setStatus] = useState<string>("");
  const [fileId, setFileId] = useState<string | null>(null);

  const run = useCallback(async () => {
    setStatus("Fetching twod_matrix.py...");
    const codeRes = await fetch("/api/dev/twod-code");
    const { source } = await codeRes.json();

    setStatus("Parsing in browser with tree-sitter...");
    const parsed = await parseWithTreeSitter(source, "py");

    setStatus("Saving to Mongo via /api/files...");
    const saveRes = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "code_sandbox/twod_matrix.py",
        language: parsed.languageName.toLowerCase(),
        extension: "py",
        sourceCode: source,
        ast: parsed.ast,
        parseStatus: "success",
      }),
    });
    const saveJson = await saveRes.json();
    if (saveRes.ok) {
      setFileId(saveJson.id);
      setStatus("Saved!");
    } else {
      setStatus(`Error: ${saveJson.error}`);
    }
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Seed twod_matrix.py into Mongo</h1>
      <button
        onClick={run}
        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
      >
        Parse and Save
      </button>
      <div className="text-sm text-gray-600">{status}</div>
      {fileId ? <div className="text-sm">Saved file id: {fileId}</div> : null}
    </div>
  );
}
