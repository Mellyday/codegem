"use client";

import { useEffect, useState, useCallback } from "react";
import {
    getRunLogs,
    deleteRun,
    clearAllRuns,
    DistractorRunLog,
    BatchLogEntry,
} from "@/src/lib/distractorDebugStore";

// ============================================================================
// Components
// ============================================================================

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        running: "bg-blue-100 text-blue-700 border-blue-200",
        pending: "bg-slate-100 text-slate-600 border-slate-200",
        success: "bg-emerald-100 text-emerald-700 border-emerald-200",
        completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
        error: "bg-rose-100 text-rose-700 border-rose-200",
        failed: "bg-rose-100 text-rose-700 border-rose-200",
    };
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors[status] || colors.pending}`}
        >
            {status}
        </span>
    );
}

function BatchCard({
    batch,
    isExpanded,
    onToggle,
}: {
    batch: BatchLogEntry;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const [activeTab, setActiveTab] = useState<"requests" | "responses" | "prompt">("responses");

    // Calculate total tokens for the batch
    const totalUsage = batch.responses.reduce(
        (acc, res) => {
            if (res.usage) {
                acc.promptTokens += res.usage.promptTokens || 0;
                acc.completionTokens += res.usage.completionTokens || 0;
                acc.cacheHit += res.usage.promptCacheHitTokens || 0;
                acc.cacheMiss += res.usage.promptCacheMissTokens || 0;
            }
            return acc;
        },
        { promptTokens: 0, completionTokens: 0, cacheHit: 0, cacheMiss: 0 }
    );

    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
            >
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-slate-700">
                        Batch {batch.batchIndex}/{batch.batchTotal}
                    </span>
                    <StatusBadge status={batch.status} />
                    <span className="text-xs text-slate-400">
                        {batch.requests.length} card{batch.requests.length !== 1 ? "s" : ""}
                    </span>
                    {totalUsage.promptTokens > 0 && (
                        <span className="text-[10px] text-slate-400">
                            {totalUsage.promptTokens} in / {totalUsage.completionTokens} out
                        </span>
                    )}
                </div>
                <svg
                    className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3">
                    {/* Token Summary */}
                    {totalUsage.promptTokens > 0 && (
                        <div className="mb-3 rounded-lg bg-blue-50 border border-blue-100 p-2">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-blue-600 mb-1">
                                Token Usage Summary
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-xs">
                                <div>
                                    <span className="text-blue-500">Input:</span>
                                    <span className="ml-1 font-medium text-blue-700">{totalUsage.promptTokens}</span>
                                </div>
                                <div>
                                    <span className="text-blue-500">Output:</span>
                                    <span className="ml-1 font-medium text-blue-700">{totalUsage.completionTokens}</span>
                                </div>
                                <div>
                                    <span className="text-emerald-500">Cache Hit:</span>
                                    <span className="ml-1 font-medium text-emerald-700">{totalUsage.cacheHit}</span>
                                </div>
                                <div>
                                    <span className="text-amber-500">Cache Miss:</span>
                                    <span className="ml-1 font-medium text-amber-700">{totalUsage.cacheMiss}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1">
                        {(["requests", "responses", "prompt"] as const).map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${activeTab === tab
                                    ? "bg-white text-slate-700 shadow-sm"
                                    : "text-slate-500 hover:text-slate-700"
                                    }`}
                            >
                                {tab === "prompt" ? "Full Prompt" : tab}
                            </button>
                        ))}
                    </div>

                    {/* Tab Content */}
                    <div className="max-h-[500px] overflow-auto rounded-lg bg-slate-50 p-3">
                        {activeTab === "requests" && (
                            <div className="space-y-2">
                                {batch.requests.map((req) => (
                                    <div key={req.cardIndex} className="rounded border border-slate-200 bg-white p-2">
                                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                            Card #{req.cardIndex}
                                        </div>
                                        <div className="text-xs text-slate-700">{req.question}</div>
                                        <div className="mt-1 text-[10px] text-slate-500">
                                            <span className="font-medium">Correct:</span> {req.correctAnswers.join(", ")}
                                        </div>
                                        {req.snippet && (
                                            <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-1 text-[10px] text-slate-600">
                                                {req.snippet}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === "responses" && (
                            <div className="space-y-2">
                                {batch.responses.length === 0 ? (
                                    <div className="text-center text-xs italic text-slate-400">No responses yet</div>
                                ) : (
                                    batch.responses.map((res) => (
                                        <div key={res.cardIndex} className="rounded border border-slate-200 bg-white p-2">
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                                                    Card #{res.cardIndex}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    {res.usage && (
                                                        <span className="text-[9px] text-slate-400">
                                                            {res.usage.promptTokens}→{res.usage.completionTokens} tokens
                                                            {res.usage.promptCacheHitTokens ? (
                                                                <span className="text-emerald-500 ml-1">
                                                                    ({res.usage.promptCacheHitTokens} cached)
                                                                </span>
                                                            ) : null}
                                                        </span>
                                                    )}
                                                    {res.error && (
                                                        <span className="text-[10px] font-medium text-rose-500">Error</span>
                                                    )}
                                                </div>
                                            </div>
                                            {res.error ? (
                                                <div className="text-xs text-rose-600">{res.error}</div>
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {res.distractors.map((d, i) => (
                                                        <span
                                                            key={i}
                                                            className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                                                        >
                                                            {d}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {/* Token Details */}
                                            {res.usage && (
                                                <div className="mt-2 grid grid-cols-5 gap-1 text-[9px] rounded bg-slate-100 p-1.5">
                                                    <div><span className="text-slate-400">In:</span> <span className="font-medium">{res.usage.promptTokens}</span></div>
                                                    <div><span className="text-slate-400">Out:</span> <span className="font-medium">{res.usage.completionTokens}</span></div>
                                                    <div><span className="text-slate-400">Total:</span> <span className="font-medium">{res.usage.totalTokens}</span></div>
                                                    <div><span className="text-emerald-500">Hit:</span> <span className="font-medium">{res.usage.promptCacheHitTokens ?? "—"}</span></div>
                                                    <div><span className="text-amber-500">Miss:</span> <span className="font-medium">{res.usage.promptCacheMissTokens ?? "—"}</span></div>
                                                </div>
                                            )}
                                            {/* Individual Prompt */}
                                            {res.promptPayload && (
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer text-[10px] text-blue-500 hover:text-blue-700">
                                                        View Full Prompt
                                                    </summary>
                                                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-blue-50 p-1 text-[9px] text-slate-600">
                                                        {JSON.stringify(res.promptPayload, null, 2)}
                                                    </pre>
                                                </details>
                                            )}
                                            {res.rawResponse && (
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer text-[10px] text-slate-400 hover:text-slate-600">
                                                        Raw Response
                                                    </summary>
                                                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-100 p-1 text-[9px] text-slate-600">
                                                        {JSON.stringify(res.rawResponse, null, 2)}
                                                    </pre>
                                                </details>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === "prompt" && (
                            <div className="space-y-3">
                                {batch.fullPromptPayload ? (
                                    <>
                                        <div className="text-[10px] font-medium uppercase tracking-wide text-blue-600">
                                            Full API Payload
                                        </div>
                                        <pre className="whitespace-pre-wrap text-[10px] text-slate-600 bg-white p-2 rounded border border-slate-200">
                                            {JSON.stringify(batch.fullPromptPayload, null, 2)}
                                        </pre>
                                    </>
                                ) : batch.prompt ? (
                                    <>
                                        <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                            Sample Prompt (Card-level)
                                        </div>
                                        <pre className="whitespace-pre-wrap text-[11px] text-slate-600">
                                            {batch.prompt}
                                        </pre>
                                    </>
                                ) : (
                                    <div className="text-center text-xs italic text-slate-400">No prompt captured</div>
                                )}
                            </div>
                        )}
                    </div>

                    {batch.errorMessage && (
                        <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-600">
                            {batch.errorMessage}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function RunCard({
    run,
    isSelected,
    onSelect,
    onDelete,
}: {
    run: DistractorRunLog;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
}) {
    const completedBatches = run.batches.filter((b) => b.status !== "pending").length;
    const totalBatches = run.batches.length || Math.ceil(run.totalCards / run.batchSize);
    const progress = totalBatches > 0 ? Math.round((completedBatches / totalBatches) * 100) : 0;

    return (
        <div
            className={`group cursor-pointer rounded-lg border p-3 transition ${isSelected
                ? "border-amber-300 bg-amber-50"
                : "border-slate-200 bg-white hover:border-slate-300"
                }`}
            onClick={onSelect}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-700">{run.quizId}</span>
                        <StatusBadge status={run.status} />
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">
                        {new Date(run.startedAt).toLocaleString()}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                        {run.totalCards} cards · {run.batchSize}/batch · {run.provider}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    className="rounded p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                    </svg>
                </button>
            </div>

            {run.status === "running" && (
                <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                            className="h-full rounded-full bg-amber-500 transition-all"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="mt-1 text-right text-[10px] text-slate-400">
                        {completedBatches}/{totalBatches} batches
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Main Page
// ============================================================================

export default function DistractorDebugPage() {
    const [runs, setRuns] = useState<DistractorRunLog[]>([]);
    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set());

    const loadRuns = useCallback(() => {
        setRuns(getRunLogs());
    }, []);

    // Auto-refresh every 2 seconds
    useEffect(() => {
        loadRuns();
        const interval = setInterval(loadRuns, 2000);
        return () => clearInterval(interval);
    }, [loadRuns]);

    const selectedRun = runs.find((r) => r.runId === selectedRunId);

    const handleDeleteRun = (runId: string) => {
        deleteRun(runId);
        if (selectedRunId === runId) setSelectedRunId(null);
        loadRuns();
    };

    const handleClearAll = () => {
        clearAllRuns();
        setSelectedRunId(null);
        loadRuns();
    };

    const toggleBatch = (batchIndex: number) => {
        setExpandedBatches((prev) => {
            const next = new Set(prev);
            if (next.has(batchIndex)) {
                next.delete(batchIndex);
            } else {
                next.add(batchIndex);
            }
            return next;
        });
    };

    return (
        <div className="flex min-h-screen bg-slate-100">
            {/* Sidebar */}
            <div className="flex w-80 flex-col border-r border-slate-200 bg-white">
                {/* Header */}
                <div className="border-b border-slate-200 p-4">
                    <h1 className="text-lg font-semibold text-slate-800">Distractor Debug</h1>
                    <p className="mt-1 text-xs text-slate-500">
                        Monitor batch distractor generation
                        <span className="ml-2 inline-flex items-center gap-1 text-emerald-500">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
                            Auto-refreshing
                        </span>
                    </p>
                </div>

                {/* Run List */}
                <div className="flex-1 overflow-auto p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Runs ({runs.length})
                        </h2>
                        {runs.length > 0 && (
                            <button
                                type="button"
                                onClick={handleClearAll}
                                className="text-[10px] text-slate-400 hover:text-rose-500"
                            >
                                Clear All
                            </button>
                        )}
                    </div>
                    {runs.length === 0 ? (
                        <p className="text-center text-xs italic text-slate-400">No runs yet</p>
                    ) : (
                        <div className="space-y-2">
                            {[...runs].reverse().map((run) => (
                                <RunCard
                                    key={run.runId}
                                    run={run}
                                    isSelected={selectedRunId === run.runId}
                                    onSelect={() => setSelectedRunId(run.runId)}
                                    onDelete={() => handleDeleteRun(run.runId)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto p-6">
                {selectedRun ? (
                    <div className="mx-auto max-w-3xl">
                        {/* Run Header */}
                        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-lg font-semibold text-slate-800">{selectedRun.quizId}</h2>
                                        <StatusBadge status={selectedRun.status} />
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        Started: {new Date(selectedRun.startedAt).toLocaleString()}
                                        {selectedRun.completedAt && (
                                            <> · Completed: {new Date(selectedRun.completedAt).toLocaleString()}</>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="text-right text-xs text-slate-500">
                                        <div>{selectedRun.provider} / {selectedRun.model}</div>
                                        <div>{selectedRun.totalCards} cards · {selectedRun.batchSize}/batch</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard.writeText(JSON.stringify(selectedRun, null, 2));
                                            // Brief visual feedback could be added here
                                        }}
                                        className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                                        title="Copy run data as JSON"
                                    >
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                        Copy JSON
                                    </button>
                                </div>
                            </div>

                            {/* Overall Progress */}
                            {selectedRun.status === "running" && (
                                <div className="mt-4">
                                    <div className="flex items-center justify-between text-xs text-slate-500">
                                        <span>Overall Progress</span>
                                        <span>
                                            {selectedRun.batches.filter((b) => b.status !== "pending").length}/
                                            {selectedRun.batches.length || "?"} batches
                                        </span>
                                    </div>
                                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                                        <div
                                            className="h-full rounded-full bg-amber-500 transition-all"
                                            style={{
                                                width: `${selectedRun.batches.length
                                                    ? Math.round(
                                                        (selectedRun.batches.filter((b) => b.status !== "pending").length /
                                                            selectedRun.batches.length) *
                                                        100
                                                    )
                                                    : 0
                                                    }%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Code Context */}
                            {selectedRun.fullCodeContext && (
                                <details className="mt-4">
                                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                                        Full Code Context
                                    </summary>
                                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-600">
                                        {selectedRun.fullCodeContext}
                                    </pre>
                                </details>
                            )}
                        </div>

                        {/* Batches */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Batches ({selectedRun.batches.length})
                            </h3>
                            {selectedRun.batches.length === 0 ? (
                                <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
                                    <p className="text-sm text-slate-400">No batches yet</p>
                                </div>
                            ) : (
                                selectedRun.batches.map((batch) => (
                                    <BatchCard
                                        key={batch.batchIndex}
                                        batch={batch}
                                        isExpanded={expandedBatches.has(batch.batchIndex)}
                                        onToggle={() => toggleBatch(batch.batchIndex)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <div className="text-center">
                            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-slate-200 p-4 text-slate-400">
                                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.5}
                                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                                    />
                                </svg>
                            </div>
                            <p className="text-sm text-slate-500">Select a run to view details</p>
                            <p className="mt-1 text-xs text-slate-400">
                                Or run a mock test to see the debug output
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
