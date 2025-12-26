"use client";

import { useState } from "react";

export default function DevPushTestPage() {
    const [fileName, setFileName] = useState("");
    const [content, setContent] = useState("");
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!fileName.trim() || !content.trim()) {
            setStatus("error");
            setMessage("Please provide both a file name and content.");
            return;
        }

        // Ensure .py extension
        const finalFileName = fileName.endsWith(".py") ? fileName : `${fileName}.py`;

        setStatus("loading");
        setMessage("");

        try {
            const res = await fetch("/api/dev/push-project", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "tests",
                    files: [{ path: finalFileName, sourceCode: content }],
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                if (res.status === 409 && data.duplicates) {
                    throw new Error(`Duplicate file(s): ${data.duplicates.join(", ")}`);
                }
                throw new Error(data.error || `HTTP ${res.status}`);
            }

            setStatus("success");
            setMessage(`✓ Pushed "${finalFileName}" to project "${data.projectId}"`);
            // Clear form on success
            setFileName("");
            setContent("");
        } catch (err: any) {
            setStatus("error");
            setMessage(err.message || "Failed to push file");
        }
    };

    // Only show in development
    if (process.env.NODE_ENV === "production") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
                <p className="text-red-400">This page is disabled in production.</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 px-4 py-12 text-white">
            <div className="mx-auto max-w-2xl">
                <h1 className="mb-2 text-2xl font-bold text-amber-400">Push Test Script</h1>
                <p className="mb-6 text-sm text-slate-400">
                    Quickly push Python test files to the "tests" project in MongoDB.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* File Name */}
                    <div>
                        <label htmlFor="fileName" className="mb-1 block text-sm font-medium text-slate-300">
                            File Name
                        </label>
                        <input
                            id="fileName"
                            type="text"
                            placeholder="e.g., my_test_script.py"
                            value={fileName}
                            onChange={(e) => setFileName(e.target.value)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <p className="mt-1 text-xs text-slate-500">.py extension will be added if missing</p>
                    </div>

                    {/* Content */}
                    <div>
                        <label htmlFor="content" className="mb-1 block text-sm font-medium text-slate-300">
                            Python Code
                        </label>
                        <textarea
                            id="content"
                            placeholder="# Paste your Python code here..."
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            rows={18}
                            className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={status === "loading"}
                        className="w-full rounded-lg bg-amber-500 px-4 py-3 font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {status === "loading" ? "Pushing..." : "Push to MongoDB"}
                    </button>

                    {/* Status Message */}
                    {message && (
                        <div
                            className={`rounded-lg px-4 py-3 text-sm ${status === "success"
                                ? "bg-green-900/50 text-green-300"
                                : status === "error"
                                    ? "bg-red-900/50 text-red-300"
                                    : "bg-slate-800 text-slate-300"
                                }`}
                        >
                            {message}
                        </div>
                    )}
                </form>

                {/* Quick Tips */}
                <div className="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                    <h2 className="mb-2 text-sm font-semibold text-slate-300">Quick Tips</h2>
                    <ul className="space-y-1 text-xs text-slate-400">
                        <li>• All files go to the shared <code className="text-amber-400">tests</code> project</li>
                        <li>• Duplicate file names are rejected</li>
                        <li>• Find your files in the <code className="text-amber-400">tests</code> project on the home page</li>
                        <li>• Quizzes saved on these files will appear in the saved quizzes panel</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
