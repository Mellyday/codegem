"use client";

import { useState } from "react";
import {
    useGitHubFetchLogs,
    type FetchLog,
    type StreamEventLog,
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
            case 'ignored': return 'text-slate-500';
            default: return 'text-slate-400';
        }
    };

    const getEventText = () => {
        switch (event.type) {
            case 'start': return `Started: ${event.owner}/${event.name}`;
            case 'cloning': return 'Cloning repository...';
            case 'scanning': return 'Scanning files...';
            case 'discovered': return `Found ${event.files.length} files, ${event.ignoredFiles.length} ignored`;
            case 'processing': return `Processing: ${event.file} (${event.index}/${event.total})`;
            case 'parsed': return event.success ? `✓ ${event.file}` : `✗ ${event.file}: ${event.error}`;
            case 'ignored': return `⊘ ${event.file} (${event.reason})`;
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

function LogItem({
    log,
    selected,
    onSelect,
    onDelete,
}: {
    log: FetchLog;
    selected: boolean;
    onSelect: (checked: boolean) => void;
    onDelete: () => void;
}) {
    const [expanded, setExpanded] = useState(false);

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
        <div className="rounded-lg border border-rose-100 bg-white transition hover:border-rose-200">
            <div className="flex items-center gap-3 p-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => onSelect(e.target.checked)}
                    className="h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
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
                <div className="border-t border-rose-100 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-600">
                            Event Log ({log.events.length} events)
                        </span>
                        {log.completedAt && (
                            <span className="text-xs text-slate-500">
                                Completed: {formatDate(log.completedAt)}
                            </span>
                        )}
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded bg-slate-900 p-2">
                        {log.events.length > 0 ? (
                            log.events.map((event, i) => <EventItem key={i} event={event} />)
                        ) : (
                            <p className="text-xs text-slate-500">No events recorded</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function FetchLogsPanel() {
    const { logs, deleteLog, deleteLogs, clearLogs } = useGitHubFetchLogs();
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

    if (logs.length === 0) {
        return (
            <div className="rounded-xl border border-rose-200 bg-white/80 p-6 text-center shadow-sm backdrop-blur">
                <p className="text-sm text-rose-400">No fetch logs yet</p>
            </div>
        );
    }

    const allSelected = logs.length > 0 && selectedIds.size === logs.length;
    const someSelected = selectedIds.size > 0;

    return (
        <div className="rounded-xl border border-rose-200 bg-white/80 p-6 shadow-sm backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-rose-700">Fetch History</h2>

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
                        className="rounded bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-600 
              transition hover:bg-rose-200"
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
                    className="h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
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
                    />
                ))}
            </div>
        </div>
    );
}
