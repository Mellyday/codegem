"use client";

import { useState } from "react";
import {
    useGitHubFetchLogs,
    type FetchLog,
    type StreamEventLog,
    type FileTypeSummary,
} from "@/src/lib/hooks/useGitHubFetchLogs";

function formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
}

function EventItem({ event }: { event: StreamEventLog }) {
    const getEventColor = () => {
        switch (event.type) {
            case 'start': return 'text-blue-400';
            case 'cloning': case 'scanning': return 'text-amber-400';
            case 'complete': return 'text-emerald-400';
            case 'error': return 'text-red-400';
            case 'parsed': return event.success ? 'text-emerald-400' : 'text-red-400';
            case 'ignored':
            case 'ignored_chunk':
                return 'text-slate-500';
            case 'progress': return 'text-cyan-400';
            default: return 'text-slate-400';
        }
    };

    const getEventText = () => {
        switch (event.type) {
            case 'start': return `Started: ${event.owner}/${event.name}`;
            case 'cloning': return 'Cloning repository...';
            case 'scanning': return 'Scanning files...';
            case 'discovered_summary':
                return `Found ${event.parsableCount} files, ${event.ignoredCount} ignored`;
            case 'discovered_chunk':
                return `Discovered ${event.files.length} files`;
            case 'processing': return `Processing: ${event.file} (${event.index}/${event.total})`;
            case 'parsed': return event.success ? `✓ ${event.file}` : `✗ ${event.file}: ${event.error}`;
            case 'ignored': return `⊘ ${event.file} (${event.reason})`;
            case 'ignored_chunk':
                return `⊘ ${event.files.length} files (${event.reason})`;
            case 'progress':
                return `Progress: ${event.parsedFiles} parsed, ${event.failedFiles} failed, ${event.skippedFiles} skipped (${event.index}/${event.total})`;
            case 'complete': return `Complete! ${event.parsedFiles} parsed, ${event.failedFiles} failed`;
            case 'error': return `Error: ${event.message}`;
            default: return JSON.stringify(event);
        }
    };

    return (
        <div className={`truncate text-xs ${getEventColor()}`}>
            <span className="text-slate-600">[{event.type}]</span> {getEventText()}
        </div>
    );
}

/** Display file type summary with color-coded bars */
function FileTypeSummaryDisplay({ summary }: { summary: FileTypeSummary }) {
    // Sort by count descending
    const entries = Object.entries(summary).sort((a, b) => b[1].count - a[1].count);

    if (entries.length === 0) return null;

    const maxCount = Math.max(...entries.map(([, v]) => v.count));

    return (
        <div className="mt-3 space-y-1.5">
            <div className="text-xs font-medium text-slate-600">Files by Language</div>
            <div className="space-y-1">
                {entries.map(([lang, data]) => {
                    const barWidth = (data.count / maxCount) * 100;
                    const successRate = data.count > 0 ? (data.parsed / data.count) * 100 : 0;

                    return (
                        <div key={lang} className="flex items-center gap-2">
                            <div className="w-20 truncate text-xs text-slate-500" title={lang}>
                                {lang}
                            </div>
                            <div className="relative h-4 flex-1 overflow-hidden rounded bg-slate-200">
                                <div
                                    className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-emerald-400 to-emerald-500"
                                    style={{ width: `${barWidth * (successRate / 100)}%` }}
                                />
                                {data.failed > 0 && (
                                    <div
                                        className="absolute inset-y-0 rounded bg-red-400"
                                        style={{
                                            left: `${barWidth * (successRate / 100)}%`,
                                            width: `${barWidth * ((100 - successRate) / 100)}%`
                                        }}
                                    />
                                )}
                            </div>
                            <div className="w-16 text-right text-xs text-slate-500">
                                <span className="text-emerald-600">{data.parsed}</span>
                                {data.failed > 0 && (
                                    <span className="text-red-500">/{data.failed}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function LogItem({
    log,
    selected,
    onSelect,
    onDelete,
    onRetry,
}: {
    log: FetchLog;
    selected: boolean;
    onSelect: (checked: boolean) => void;
    onDelete: () => void;
    onRetry?: () => Promise<void>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [showEvents, setShowEvents] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [retryResult, setRetryResult] = useState<{ succeeded: number; stillFailed: number } | null>(null);

    const handleRetry = async () => {
        if (!onRetry) return;
        setIsRetrying(true);
        setRetryResult(null);
        try {
            await onRetry();
        } finally {
            setIsRetrying(false);
        }
    };

    const statusColor = {
        pending: 'bg-amber-100 text-amber-700',
        success: 'bg-emerald-100 text-emerald-700',
        failed: 'bg-red-100 text-red-700',
    }[log.status];

    const statusIcon = {
        pending: '⏳',
        success: '✓',
        failed: '✗',
    }[log.status];

    return (
        <div className="rounded-lg border border-cyan-100 bg-white transition hover:border-cyan-200">
            <div className="flex items-center gap-3 p-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => onSelect(e.target.checked)}
                    className="h-4 w-4 rounded border-cyan-300 text-cyan-600 focus:ring-cyan-500"
                />

                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex flex-1 items-center gap-3 text-left"
                >
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                        {statusIcon}
                    </span>

                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                            {log.owner}/{log.name || 'Unknown'}
                        </p>
                        <p className="truncate text-xs text-slate-500">{log.url}</p>
                    </div>

                    <div className="hidden text-right text-xs text-slate-400 sm:block">
                        <p>{formatDate(log.startedAt)}</p>
                        {log.progress && (
                            <p className="text-slate-500">
                                {log.progress.parsedFiles}/{log.progress.totalFiles} files
                            </p>
                        )}
                    </div>

                    <svg
                        className={`h-4 w-4 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {/* Retry button - show if there are failed files */}
                {log.progress && log.progress.failedFiles > 0 && log.repoId && (
                    <button
                        onClick={handleRetry}
                        disabled={isRetrying}
                        className="rounded p-1 text-amber-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
                        title={isRetrying ? "Retrying..." : `Retry ${log.progress.failedFiles} failed files`}
                    >
                        {isRetrying ? (
                            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                        ) : (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        )}
                    </button>
                )}

                <button
                    onClick={onDelete}
                    className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    title="Delete log"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="border-t border-cyan-100 bg-slate-50 p-3">
                    {/* File Type Summary */}
                    {log.fileTypeSummary && Object.keys(log.fileTypeSummary).length > 0 && (
                        <FileTypeSummaryDisplay summary={log.fileTypeSummary} />
                    )}

                    {/* Event Log Toggle */}
                    <div className="mt-3 flex items-center justify-between">
                        <button
                            onClick={() => setShowEvents(!showEvents)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800"
                        >
                            <svg
                                className={`h-3 w-3 transition ${showEvents ? 'rotate-90' : ''}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            Event Log ({log.events.length} events)
                        </button>
                        {log.completedAt && (
                            <span className="text-xs text-slate-500">
                                Completed: {formatDate(log.completedAt)}
                            </span>
                        )}
                    </div>

                    {/* Event Log Content */}
                    {showEvents && (
                        <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded bg-slate-900 p-2">
                            {log.events.length > 0 ? (
                                log.events.map((event, i) => <EventItem key={i} event={event} />)
                            ) : (
                                <p className="text-xs text-slate-500">No events recorded</p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function FetchLogsPanel() {
    const { logs, isLoading, deleteLog, deleteLogs, clearLogs, updateLog } = useGitHubFetchLogs();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const handleSelect = (id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(logs.map((l) => l.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleDeleteSelected = () => {
        deleteLogs(Array.from(selectedIds));
        setSelectedIds(new Set());
    };

    const handleClearAll = () => {
        if (confirm('Are you sure you want to delete all logs?')) {
            clearLogs();
            setSelectedIds(new Set());
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="rounded-xl border border-cyan-200 bg-white/80 p-6 text-center shadow-sm backdrop-blur">
                <div className="flex items-center justify-center gap-2 text-sm text-cyan-400">
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading fetch history...
                </div>
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <div className="rounded-xl border border-cyan-200 bg-white/80 p-6 text-center shadow-sm backdrop-blur">
                <p className="text-sm text-cyan-400">No fetch logs yet</p>
            </div>
        );
    }

    const allSelected = logs.length > 0 && selectedIds.size === logs.length;
    const someSelected = selectedIds.size > 0;

    return (
        <div className="rounded-xl border border-cyan-200 bg-white/80 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-cyan-700">Fetch History</h2>

                <div className="flex items-center gap-2">
                    {someSelected && (
                        <button
                            onClick={handleDeleteSelected}
                            className="rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-600 
                transition hover:bg-red-200"
                        >
                            Delete Selected ({selectedIds.size})
                        </button>
                    )}
                    <button
                        onClick={handleClearAll}
                        className="rounded bg-cyan-100 px-3 py-1.5 text-xs font-medium text-cyan-600 
              transition hover:bg-cyan-200"
                    >
                        Clear All
                    </button>
                </div>
            </div>

            {/* Select all checkbox */}
            <div className="mb-3 flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="h-4 w-4 rounded border-cyan-300 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-xs text-slate-500">Select all</span>
            </div>

            {/* Log list */}
            <div className="space-y-2">
                {logs.map((log) => (
                    <LogItem
                        key={log.id}
                        log={log}
                        selected={selectedIds.has(log.id)}
                        onSelect={(checked) => handleSelect(log.id, checked)}
                        onDelete={() => deleteLog(log.id)}
                        onRetry={log.repoId && log.progress && log.progress.failedFiles > 0 ? async () => {
                            const res = await fetch(`/api/repos/${log.repoId}/retry`, { method: 'POST' });
                            const data = await res.json();
                            if (data.succeeded > 0) {
                                // Update the log to reflect new success count
                                updateLog(log.id, {
                                    progress: {
                                        totalFiles: log.progress!.totalFiles,
                                        parsedFiles: log.progress!.parsedFiles + data.succeeded,
                                        failedFiles: data.stillFailed,
                                    }
                                });
                            }
                        } : undefined}
                    />
                ))}
            </div>
        </div>
    );
}
