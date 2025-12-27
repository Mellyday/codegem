"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { openDB, type IDBPDatabase } from "idb";

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

/** Summary of files processed by language/extension */
export type FileTypeSummary = {
    [extension: string]: {
        count: number;
        parsed: number;
        failed: number;
    };
};

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
    /** MongoDB repoId for retry functionality */
    repoId?: string;
    /** Summary of parsed files by file type */
    fileTypeSummary?: FileTypeSummary;
};

const DB_NAME = "codegem-fetch-logs";
const DB_VERSION = 1;
const STORE_NAME = "logs";

/** File extensions mapped to readable language names */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
    ".py": "Python",
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "React TSX",
    ".jsx": "React JSX",
    ".go": "Go",
    ".rs": "Rust",
    ".rb": "Ruby",
    ".java": "Java",
    ".kt": "Kotlin",
    ".swift": "Swift",
    ".c": "C",
    ".cpp": "C++",
    ".h": "C Header",
    ".hpp": "C++ Header",
    ".cs": "C#",
    ".php": "PHP",
    ".lua": "Lua",
    ".zig": "Zig",
};

/**
 * Get the language display name for a file path
 */
function getLanguageFromFile(filePath: string): string {
    const lastDot = filePath.lastIndexOf(".");
    if (lastDot === -1) return "Other";
    const ext = filePath.slice(lastDot).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] || ext;
}

/**
 * Initialize or get the IndexedDB database
 */
async function getDB(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("startedAt", "startedAt");
            }
        },
    });
}

/**
 * Load all logs from IndexedDB, sorted by startedAt descending
 */
async function loadLogsFromDB(): Promise<FetchLog[]> {
    try {
        const db = await getDB();
        const all = await db.getAll(STORE_NAME);
        // Sort by startedAt descending (most recent first)
        return all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    } catch (err) {
        console.error("[useGitHubFetchLogs] Failed to load from IndexedDB:", err);
        return [];
    }
}

/**
 * Save or update a single log in IndexedDB
 */
async function saveLogToDB(log: FetchLog): Promise<void> {
    try {
        const db = await getDB();
        await db.put(STORE_NAME, log);
    } catch (err) {
        console.error("[useGitHubFetchLogs] Failed to save to IndexedDB:", err);
    }
}

/**
 * Delete a single log from IndexedDB
 */
async function deleteLogFromDB(id: string): Promise<void> {
    try {
        const db = await getDB();
        await db.delete(STORE_NAME, id);
    } catch (err) {
        console.error("[useGitHubFetchLogs] Failed to delete from IndexedDB:", err);
    }
}

/**
 * Delete multiple logs from IndexedDB
 */
async function deleteLogsFromDB(ids: string[]): Promise<void> {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        await Promise.all(ids.map((id) => tx.store.delete(id)));
        await tx.done;
    } catch (err) {
        console.error("[useGitHubFetchLogs] Failed to delete logs from IndexedDB:", err);
    }
}

/**
 * Clear all logs from IndexedDB
 */
async function clearLogsFromDB(): Promise<void> {
    try {
        const db = await getDB();
        await db.clear(STORE_NAME);
    } catch (err) {
        console.error("[useGitHubFetchLogs] Failed to clear IndexedDB:", err);
    }
}

/**
 * Hook to manage GitHub fetch logs stored in IndexedDB.
 * Supports much larger data than localStorage (IndexedDB limit is typically 50MB+).
 */
export function useGitHubFetchLogs() {
    const [logs, setLogs] = useState<FetchLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Use a ref to track current in-memory log state for async operations
    const logsRef = useRef<Map<string, FetchLog>>(new Map());

    // Load logs on mount
    useEffect(() => {
        loadLogsFromDB().then((loaded) => {
            setLogs(loaded);
            // Populate the ref map
            logsRef.current.clear();
            for (const log of loaded) {
                logsRef.current.set(log.id, log);
            }
            setIsLoading(false);
        });
    }, []);

    const addLog = useCallback((log: FetchLog) => {
        // Add to in-memory state
        setLogs((prev) => [log, ...prev]);
        logsRef.current.set(log.id, log);
        // Persist to IndexedDB (async, non-blocking)
        saveLogToDB(log);
    }, []);

    const updateLog = useCallback((id: string, updates: Partial<FetchLog>) => {
        setLogs((prev) => {
            const updated = prev.map((log) => {
                if (log.id !== id) return log;
                const newLog = { ...log, ...updates };
                logsRef.current.set(id, newLog);
                // Persist updated log (async)
                saveLogToDB(newLog);
                return newLog;
            });
            return updated;
        });
    }, []);

    /**
     * Append an event to a log and update file type summary for parsed events.
     * Uses a batched approach to avoid excessive IndexedDB writes.
     */
    const appendEvent = useCallback((id: string, event: StreamEventLog) => {
        setLogs((prev) => {
            const updated = prev.map((log) => {
                if (log.id !== id) return log;

                // Update file type summary if this is a parsed event
                let fileTypeSummary = log.fileTypeSummary ? { ...log.fileTypeSummary } : {};

                if (event.type === "parsed") {
                    const language = getLanguageFromFile(event.file);
                    if (!fileTypeSummary[language]) {
                        fileTypeSummary[language] = { count: 0, parsed: 0, failed: 0 };
                    }
                    fileTypeSummary[language] = {
                        count: fileTypeSummary[language].count + 1,
                        parsed: fileTypeSummary[language].parsed + (event.success ? 1 : 0),
                        failed: fileTypeSummary[language].failed + (event.success ? 0 : 1),
                    };
                }

                const newLog: FetchLog = {
                    ...log,
                    events: [...log.events, event],
                    fileTypeSummary,
                };

                logsRef.current.set(id, newLog);

                // Persist to IndexedDB - batch by only saving on certain events
                // to avoid hammering the DB with every parsed event
                const shouldPersist =
                    event.type === "start" ||
                    event.type === "complete" ||
                    event.type === "error" ||
                    event.type === "discovered" ||
                    // Persist every 50 parsed events or on completion
                    (event.type === "parsed" && (newLog.events.length % 50 === 0));

                if (shouldPersist) {
                    saveLogToDB(newLog);
                }

                return newLog;
            });
            return updated;
        });
    }, []);

    /**
     * Ensure final state is persisted when a fetch completes
     */
    const finalizeLog = useCallback((id: string) => {
        const log = logsRef.current.get(id);
        if (log) {
            saveLogToDB(log);
        }
    }, []);

    const deleteLog = useCallback((id: string) => {
        setLogs((prev) => prev.filter((log) => log.id !== id));
        logsRef.current.delete(id);
        deleteLogFromDB(id);
    }, []);

    const deleteLogs = useCallback((ids: string[]) => {
        const idsSet = new Set(ids);
        setLogs((prev) => prev.filter((log) => !idsSet.has(log.id)));
        for (const id of ids) {
            logsRef.current.delete(id);
        }
        deleteLogsFromDB(ids);
    }, []);

    const clearLogs = useCallback(() => {
        setLogs([]);
        logsRef.current.clear();
        clearLogsFromDB();
    }, []);

    return {
        logs,
        isLoading,
        addLog,
        updateLog,
        appendEvent,
        finalizeLog,
        deleteLog,
        deleteLogs,
        clearLogs,
    };
}
