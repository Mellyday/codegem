"use client";

import { useState, useRef, useCallback } from "react";
import {
    useGitHubFetchLogs,
    type FetchLog,
    type StreamEventLog,
} from "@/src/lib/hooks/useGitHubFetchLogs";

type FetchStatus = "idle" | "fetching" | "success" | "error";

type CurrentProgress = {
    phase: string;
    currentFile?: string;
    index?: number;
    total?: number;
    parsedFiles: number;
    failedFiles: number;
    skippedFiles: number;
    events: StreamEventLog[];
};

export default function GitHubFetcher() {
    const [url, setUrl] = useState("");
    const [status, setStatus] = useState<FetchStatus>("idle");
    const [error, setError] = useState<string | null>(null);
    const [currentProgress, setCurrentProgress] = useState<CurrentProgress | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const { addLog, updateLog, appendEvent, finalizeLog } = useGitHubFetchLogs();

    const validateUrl = (input: string): boolean => {
        try {
            const parsed = new URL(input);
            return /^github\.com$/i.test(parsed.hostname);
        } catch {
            return false;
        }
    };

    const resetState = () => {
        setStatus("idle");
        setError(null);
        setCurrentProgress(null);
    };

    const handleFetch = useCallback(async () => {
        if (!validateUrl(url)) {
            setError("Please enter a valid GitHub repository URL");
            return;
        }

        setStatus("fetching");
        setError(null);

        // Initialize progress
        const initialProgress: CurrentProgress = {
            phase: "Initializing...",
            parsedFiles: 0,
            failedFiles: 0,
            skippedFiles: 0,
            events: [],
        };
        setCurrentProgress(initialProgress);

        // Create log entry
        const logId = crypto.randomUUID();
        const newLog: FetchLog = {
            id: logId,
            url,
            owner: "",
            name: "",
            status: "pending",
            startedAt: new Date().toISOString(),
            events: [],
        };
        addLog(newLog);

        // Create abort controller
        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch("/api/repos/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            const decoder = new TextDecoder();
            let buffer = "";
            let ownerName = "";
            let repoName = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;

                    let event: StreamEventLog;
                    try {
                        event = JSON.parse(line.slice(6));
                    } catch {
                        continue;
                    }

                    // Append to log
                    appendEvent(logId, event);

                    // Update progress based on event type
                    setCurrentProgress((prev) => {
                        if (!prev) return prev;
                        const updated = { ...prev, events: [...prev.events, event] };

                        switch (event.type) {
                            case "start":
                                ownerName = event.owner;
                                repoName = event.name;
                                updateLog(logId, { owner: event.owner, name: event.name });
                                return { ...updated, phase: `Starting fetch for ${event.owner}/${event.name}` };
                            case "cloning":
                                return { ...updated, phase: "Cloning repository..." };
                            case "scanning":
                                return { ...updated, phase: "Scanning files..." };
                            case "discovered_summary":
                                return {
                                    ...updated,
                                    phase: `Found ${event.parsableCount} parsable files, ${event.ignoredCount} ignored`,
                                    total: event.parsableCount,
                                };
                            case "discovered_chunk":
                            case "ignored_chunk":
                                return updated;
                            case "processing":
                                return {
                                    ...updated,
                                    phase: "Processing files...",
                                    currentFile: event.file,
                                    index: event.index,
                                    total: event.total,
                                };
                            case "parsed":
                                return updated;
                            case "progress":
                                return {
                                    ...updated,
                                    parsedFiles: event.parsedFiles,
                                    failedFiles: event.failedFiles,
                                    skippedFiles: event.skippedFiles,
                                    index: event.index,
                                    total: event.total,
                                };
                            case "complete":
                                updateLog(logId, {
                                    status: "success",
                                    completedAt: new Date().toISOString(),
                                    repoId: event.repoId,
                                    progress: {
                                        totalFiles: event.totalFiles,
                                        parsedFiles: event.parsedFiles,
                                        failedFiles: event.failedFiles,
                                    },
                                });
                                return {
                                    ...updated,
                                    phase: "Complete!",
                                    parsedFiles: event.parsedFiles,
                                    failedFiles: event.failedFiles,
                                    skippedFiles: event.skippedFiles,
                                    total: event.totalFiles,
                                };
                            case "error":
                                updateLog(logId, {
                                    status: "failed",
                                    completedAt: new Date().toISOString(),
                                });
                                throw new Error(event.message);
                            default:
                                return updated;
                        }
                    });
                }
            }

            setStatus("success");
            finalizeLog(logId);
        } catch (err) {
            if ((err as Error).name === "AbortError") {
                updateLog(logId, {
                    status: "failed",
                    completedAt: new Date().toISOString(),
                });
                finalizeLog(logId);
                setError("Fetch cancelled");
            } else {
                updateLog(logId, {
                    status: "failed",
                    completedAt: new Date().toISOString(),
                });
                finalizeLog(logId);
                setError(String(err));
            }
            setStatus("error");
        }
    }, [url, addLog, updateLog, appendEvent, finalizeLog]);

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    };

    const isValidUrl = validateUrl(url);
    const progressPercent = currentProgress?.total
        ? Math.round(((currentProgress.parsedFiles + currentProgress.failedFiles + currentProgress.skippedFiles) / currentProgress.total) * 100)
        : 0;

    return (
        <div className="rounded-xl border border-cyan-200 bg-white/80 p-6 shadow-sm backdrop-blur">
            <h2 className="mb-4 text-lg font-semibold text-cyan-700">Import GitHub Repository</h2>

            {/* URL Input */}
            <div className="flex gap-3">
                <input
                    type="text"
                    value={url}
                    onChange={(e) => {
                        setUrl(e.target.value);
                        if (error) setError(null);
                    }}
                    placeholder="https://github.com/owner/repo"
                    disabled={status === "fetching"}
                    className="flex-1 rounded-lg border border-cyan-200 bg-white px-4 py-2.5 text-sm 
            placeholder:text-cyan-400 focus:border-cyan-400 focus:outline-none focus:ring-2 
            focus:ring-cyan-100 disabled:bg-cyan-50 disabled:text-cyan-400"
                />
                {status === "fetching" ? (
                    <button
                        onClick={handleCancel}
                        className="rounded-lg bg-cyan-100 px-5 py-2.5 text-sm font-medium text-cyan-600 
              transition hover:bg-cyan-200"
                    >
                        Cancel
                    </button>
                ) : (
                    <button
                        onClick={handleFetch}
                        disabled={!isValidUrl}
                        className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white 
              transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
                    >
                        Fetch
                    </button>
                )}
            </div>

            {/* Validation hint */}
            {url && !isValidUrl && (
                <p className="mt-2 text-xs text-cyan-500">
                    Enter a valid GitHub URL (e.g., https://github.com/owner/repo)
                </p>
            )}

            {/* Error display */}
            {error && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                    {error}
                </div>
            )}

            {/* Progress display */}
            {currentProgress && status === "fetching" && (
                <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-cyan-600">{currentProgress.phase}</span>
                        {currentProgress.total && (
                            <span className="text-cyan-500">
                                {currentProgress.index ?? 0}/{currentProgress.total} ({progressPercent}%)
                            </span>
                        )}
                    </div>

                    {/* Progress bar */}
                    {currentProgress.total && (
                        <div className="h-2 overflow-hidden rounded-full bg-cyan-100">
                            <div
                                className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600 transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    )}

                    {/* Current file */}
                    {currentProgress.currentFile && (
                        <div className="rounded-lg bg-cyan-50 p-3">
                            <p className="truncate text-xs text-cyan-500">
                                <span className="font-medium">Processing:</span> {currentProgress.currentFile}
                            </p>
                        </div>
                    )}

                    {/* Stats */}
                    <div className="flex gap-4 text-xs">
                        <span className="text-emerald-600">
                            ✓ Parsed: {currentProgress.parsedFiles}
                        </span>
                        <span className="text-red-500">
                            ✗ Failed: {currentProgress.failedFiles}
                        </span>
                    </div>

                    {/* Live log (last 5 events) */}
                    <div className="max-h-32 overflow-y-auto rounded-lg bg-slate-900 p-3">
                        <div className="space-y-1 font-mono text-xs text-slate-300">
                            {currentProgress.events.slice(-5).map((event, i) => (
                                <div key={i} className="truncate">
                                    <span className="text-cyan-400">[{event.type}]</span>{" "}
                                    {'file' in event && event.file}
                                    {'message' in event && event.message}
                                    {event.type === 'start' && `${event.owner}/${event.name}`}
                                    {event.type === 'discovered_summary' &&
                                        `${event.parsableCount} files, ${event.ignoredCount} ignored`}
                                    {event.type === 'discovered_chunk' && `${event.files.length} files`}
                                    {event.type === 'ignored_chunk' &&
                                        `${event.files.length} ignored (${event.reason})`}
                                    {event.type === 'progress' &&
                                        `${event.parsedFiles} parsed, ${event.failedFiles} failed`}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Success state */}
            {status === "success" && currentProgress && (
                <div className="mt-4 rounded-lg bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 text-emerald-700">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="font-medium">Repository imported successfully!</span>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm text-emerald-600">
                        <span>Total: {currentProgress.total}</span>
                        <span>Parsed: {currentProgress.parsedFiles}</span>
                        <span>Failed: {currentProgress.failedFiles}</span>
                    </div>
                    <button
                        onClick={resetState}
                        className="mt-3 text-sm text-emerald-600 underline hover:text-emerald-700"
                    >
                        Import another repository
                    </button>
                </div>
            )}
        </div>
    );
}
