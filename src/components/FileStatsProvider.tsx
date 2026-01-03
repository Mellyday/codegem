"use client";
import { useState, useEffect } from "react";
import { FileQuizActions, type FileStats } from "./FileQuizActions";
import { FolderStats, type FolderStatsData } from "./FolderStats";

type FileStatsResponse = {
    files: Record<string, FileStats>;
    folders: Record<string, FolderStatsData>;
};

type FileStatsProviderProps = {
    kind: "repo" | "project";
    id: string;
    prefix: string;
    children: (data: {
        fileStats: Record<string, FileStats>;
        folderStats: Record<string, FolderStatsData>;
        loading: boolean;
    }) => React.ReactNode;
};

export function FileStatsProvider({ kind, id, prefix, children }: FileStatsProviderProps) {
    const [data, setData] = useState<FileStatsResponse>({ files: {}, folders: {} });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch(
                    `/api/file-stats?kind=${kind}&id=${encodeURIComponent(id)}&prefix=${encodeURIComponent(prefix)}`
                );
                if (res.ok) {
                    const json = await res.json();
                    setData(json);
                }
            } catch {
                // Silently fail
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [kind, id, prefix]);

    return <>{children({ fileStats: data.files, folderStats: data.folders, loading })}</>;
}

// Re-export components for convenience
export { FileQuizActions, FolderStats };
export type { FileStats, FolderStatsData };
