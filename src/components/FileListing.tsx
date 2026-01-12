"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { FileQuizActions, type FileStats } from "./FileQuizActions";
import { FolderStats, type FolderStatsData } from "./FolderStats";

type FileStatsResponse = {
    files: Record<string, FileStats>;
    folders: Record<string, FolderStatsData>;
};

type FileInfo = {
    name: string;
    path: string;
    extension?: string;
    language?: string;
    size?: number;
};

type FileListingProps = {
    kind: "repo" | "project";
    id: string;
    prefix: string;
    dirs: string[];
    files: FileInfo[];
    showDelete?: boolean;
    DeleteButton?: React.ComponentType<{ kind: "repo" | "project"; id: string; path: string; isDir?: boolean; label: string }>;
};

export function FileListing({ kind, id, prefix, dirs, files, showDelete, DeleteButton }: FileListingProps) {
    const [stats, setStats] = useState<FileStatsResponse>({ files: {}, folders: {} });
    const [loadingStats, setLoadingStats] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch(
                    `/api/file-stats?kind=${kind}&id=${encodeURIComponent(id)}&prefix=${encodeURIComponent(prefix)}`
                );
                if (res.ok) {
                    const json = await res.json();
                    setStats(json);
                }
            } catch {
                // Silently fail
            } finally {
                setLoadingStats(false);
            }
        };

        fetchStats();
    }, [kind, id, prefix]);

    const baseHref = `/${kind}/${encodeURIComponent(id)}`;

    return (
        <ul className="mt-4 divide-y divide-cyan-100 rounded-lg border border-cyan-200 bg-white">
            {/* Directories */}
            {dirs.map((d) => {
                const dirPath = [prefix, d].filter(Boolean).join("/");
                return (
                    <li key={`dir:${d}`} className="flex items-center justify-between px-4 py-3">
                        <Link
                            href={`${baseHref}/${dirPath.split("/").map(encodeURIComponent).join("/")}`}
                            className="font-medium text-cyan-700 hover:underline"
                        >
                            {d}/
                        </Link>
                        <div className="flex items-center gap-2">
                            {!loadingStats && stats.folders[d] && (
                                <FolderStats stats={stats.folders[d]} />
                            )}
                            {loadingStats && (
                                <span className="h-3 w-3 animate-pulse rounded-full bg-slate-200" />
                            )}
                            <span className="text-[0.65rem] uppercase tracking-wide text-cyan-500">Folder</span>
                            {showDelete && DeleteButton && (
                                <DeleteButton kind={kind} id={id} path={dirPath} isDir label="×" />
                            )}
                        </div>
                    </li>
                );
            })}

            {/* Files */}
            {files.map((f) => (
                <li key={`file:${f.path}`} className="flex items-center justify-between px-4 py-3">
                    <Link
                        href={`${baseHref}/${f.path.split("/").map(encodeURIComponent).join("/")}`}
                        className="text-slate-800 hover:underline"
                    >
                        {f.name}
                    </Link>
                    <div className="flex items-center gap-2">
                        <FileQuizActions
                            kind={kind}
                            id={id}
                            path={f.path}
                            stats={stats.files[f.path]}
                        />
                        <span className="text-[0.65rem] uppercase tracking-wide text-cyan-500">File</span>
                        {showDelete && DeleteButton && (
                            <DeleteButton kind={kind} id={id} path={f.path} label="×" />
                        )}
                    </div>
                </li>
            ))}

            {/* Empty state */}
            {dirs.length === 0 && files.length === 0 && (
                <li className="px-4 py-6 text-sm italic text-cyan-400">Empty</li>
            )}
        </ul>
    );
}
