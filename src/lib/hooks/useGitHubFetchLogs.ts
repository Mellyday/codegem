"use client";

import { useState, useEffect, useCallback } from "react";

export type StreamEventLog =
    | { type: 'start'; owner: string; name: string; url: string }
    | { type: 'cloning' }
    | { type: 'cloned'; fileCount: number }
    | { type: 'scanning' }
    | { type: 'discovered'; files: string[]; ignoredFiles: string[] }
    | { type: 'processing'; file: string; index: number; total: number }
    | { type: 'ignored'; file: string; reason: string }
    | { type: 'parsed'; file: string; success: boolean; error?: string }
    | { type: 'complete'; repoId: string; totalFiles: number; parsedFiles: number; failedFiles: number }
    | { type: 'error'; message: string };

export type FetchLog = {
    id: string;
    url: string;
    owner: string;
    name: string;
    status: 'pending' | 'success' | 'failed';
    startedAt: string;
    completedAt?: string;
    events: StreamEventLog[];
    progress?: {
        totalFiles: number;
        parsedFiles: number;
        failedFiles: number;
    };
};

const STORAGE_KEY = "github-fetch-logs";

function loadLogs(): FetchLog[] {
    if (typeof window === "undefined") return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveLogs(logs: FetchLog[]): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

export function useGitHubFetchLogs() {
    const [logs, setLogs] = useState<FetchLog[]>([]);

    // Load logs on mount
    useEffect(() => {
        setLogs(loadLogs());
    }, []);

    const addLog = useCallback((log: FetchLog) => {
        setLogs((prev) => {
            const updated = [log, ...prev];
            saveLogs(updated);
            return updated;
        });
    }, []);

    const updateLog = useCallback((id: string, updates: Partial<FetchLog>) => {
        setLogs((prev) => {
            const updated = prev.map((log) =>
                log.id === id ? { ...log, ...updates } : log
            );
            saveLogs(updated);
            return updated;
        });
    }, []);

    const appendEvent = useCallback((id: string, event: StreamEventLog) => {
        setLogs((prev) => {
            const updated = prev.map((log) =>
                log.id === id ? { ...log, events: [...log.events, event] } : log
            );
            saveLogs(updated);
            return updated;
        });
    }, []);

    const deleteLog = useCallback((id: string) => {
        setLogs((prev) => {
            const updated = prev.filter((log) => log.id !== id);
            saveLogs(updated);
            return updated;
        });
    }, []);

    const deleteLogs = useCallback((ids: string[]) => {
        setLogs((prev) => {
            const idsSet = new Set(ids);
            const updated = prev.filter((log) => !idsSet.has(log.id));
            saveLogs(updated);
            return updated;
        });
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        saveLogs([]);
    }, []);

    return {
        logs,
        addLog,
        updateLog,
        appendEvent,
        deleteLog,
        deleteLogs,
        clearLogs,
    };
}
