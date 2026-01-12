"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Folder, FileText, Star, Trophy, RefreshCw, Sparkles } from "lucide-react";

interface SegmentDetail {
    sectionIndex: number;
    loc: number;
    isFirstTime: boolean;
    isGold: boolean;
}

interface FileDetail {
    loc: number;
    segments: SegmentDetail[];
}

interface RepoDetail {
    repoName: string;
    kind: "repo" | "project";
    totalLoc: number;
    files: Record<string, FileDetail>;
}

interface DailyReviewData {
    date: string;
    summary: {
        totalLoc: number;
        firstTimeLoc: number;
        repeatLoc: number;
        goldLoc: number;
        totalSegments: number;
        firstTimeSegments: number;
        repeatSegments: number;
        goldSegments: number;
    };
    byRepo: Record<string, RepoDetail>;
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function StatCard({
    label,
    value,
    subValue,
    icon: Icon,
    colorClass,
}: {
    label: string;
    value: number;
    subValue?: string;
    icon: React.ComponentType<{ className?: string }>;
    colorClass: string;
}) {
    return (
        <div className={`rounded-xl border p-4 ${colorClass}`}>
            <div className="flex items-center gap-3">
                <div className="rounded-lg bg-white/50 p-2">
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <div className="text-2xl font-bold">{value.toLocaleString()}</div>
                    <div className="text-sm opacity-80">{label}</div>
                    {subValue && <div className="text-xs opacity-60">{subValue}</div>}
                </div>
            </div>
        </div>
    );
}

function FileTreeItem({
    path,
    detail,
    depth = 0,
}: {
    path: string;
    detail: FileDetail;
    depth?: number;
}) {
    const [expanded, setExpanded] = useState(false);
    const fileName = path.split("/").pop() || path;

    return (
        <div style={{ marginLeft: depth * 16 }}>
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100"
            >
                <FileText className="h-4 w-4 text-slate-400" />
                <span className="flex-1 truncate font-mono text-sm text-slate-700">
                    {fileName}
                </span>
                <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                    {detail.loc} LOC
                </span>
                {detail.segments.some((s) => s.isGold) && (
                    <Trophy className="h-4 w-4 text-amber-500" />
                )}
                {detail.segments.some((s) => s.isFirstTime) && (
                    <Sparkles className="h-4 w-4 text-emerald-500" />
                )}
            </button>

            {expanded && (
                <div className="ml-6 mt-1 space-y-1 border-l-2 border-slate-100 pl-3">
                    {detail.segments.map((seg) => (
                        <div
                            key={seg.sectionIndex}
                            className="flex items-center gap-2 py-1 text-xs text-slate-500"
                        >
                            <span>Section {seg.sectionIndex + 1}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">
                                {seg.loc} LOC
                            </span>
                            {seg.isFirstTime && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
                                    New
                                </span>
                            )}
                            {!seg.isFirstTime && (
                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                                    Review
                                </span>
                            )}
                            {seg.isGold && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                                    Gold
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function RepoSection({
    repoId,
    detail,
}: {
    repoId: string;
    detail: RepoDetail;
}) {
    const [expanded, setExpanded] = useState(true);

    // Group files by folder path
    const filesByFolder = new Map<string, Array<[string, FileDetail]>>();
    for (const [path, file] of Object.entries(detail.files)) {
        const parts = path.split("/");
        const folderPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
        if (!filesByFolder.has(folderPath)) {
            filesByFolder.set(folderPath, []);
        }
        filesByFolder.get(folderPath)!.push([path, file]);
    }

    // Sort folders and files
    const sortedFolders = [...filesByFolder.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    return (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-slate-50"
            >
                <Folder className="h-5 w-5 text-rose-500" />
                <div className="flex-1">
                    <div className="font-semibold text-slate-900">{detail.repoName}</div>
                    <div className="text-xs text-slate-500">
                        {detail.kind === "repo" ? "Repository" : "Project"} • {Object.keys(detail.files).length} files
                    </div>
                </div>
                <span className="rounded-lg bg-rose-100 px-3 py-1 text-sm font-medium text-rose-700">
                    {detail.totalLoc} LOC
                </span>
            </button>

            {expanded && (
                <div className="border-t border-slate-100 p-3">
                    {sortedFolders.map(([folderPath, files]) => (
                        <div key={folderPath || "_root"} className="mb-2">
                            {folderPath && (
                                <div className="mb-1 flex items-center gap-1 px-3 py-1 text-xs text-slate-400">
                                    <Folder className="h-3 w-3" />
                                    <span className="font-mono">{folderPath}/</span>
                                </div>
                            )}
                            <div className="space-y-0.5">
                                {files
                                    .sort((a, b) => a[0].localeCompare(b[0]))
                                    .map(([path, file]) => (
                                        <FileTreeItem
                                            key={path}
                                            path={path}
                                            detail={file}
                                            depth={folderPath ? 1 : 0}
                                        />
                                    ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function ReviewPage() {
    const [date, setDate] = useState(() => {
        const today = new Date();
        return today.toISOString().split("T")[0];
    });
    const [data, setData] = useState<DailyReviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async (targetDate: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/daily-review?date=${targetDate}`);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const json = await res.json();
            setData(json);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(date);
    }, [date]);

    // Helper to format date as YYYY-MM-DD in local timezone
    const formatLocalDate = (d: Date): string => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    };

    const goToPrevDay = () => {
        const d = new Date(date + "T00:00:00");
        d.setDate(d.getDate() - 1);
        setDate(formatLocalDate(d));
    };

    const goToNextDay = () => {
        const d = new Date(date + "T00:00:00");
        d.setDate(d.getDate() + 1);
        const today = formatLocalDate(new Date());
        const newDate = formatLocalDate(d);
        if (newDate <= today) {
            setDate(newDate);
        }
    };

    const isToday = date === formatLocalDate(new Date());

    return (
        <main className="min-h-screen bg-rose-50 text-slate-900">
            <section className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
                {/* Header */}
                <header className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-rose-700">Daily Review</h1>
                        <p className="text-sm text-rose-500">{formatDate(date)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={goToPrevDay}
                            className="rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:bg-slate-50"
                        >
                            <ChevronLeft className="h-5 w-5 text-slate-600" />
                        </button>
                        <button
                            type="button"
                            onClick={goToNextDay}
                            disabled={isToday}
                            className="rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:bg-slate-50 disabled:opacity-50"
                        >
                            <ChevronRight className="h-5 w-5 text-slate-600" />
                        </button>
                    </div>
                </header>

                {/* Loading / Error states */}
                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-rose-200 border-t-rose-500" />
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        Failed to load data: {error}
                    </div>
                )}

                {!loading && !error && data && (
                    <>
                        {/* Summary Cards */}
                        {data.summary.totalLoc === 0 ? (
                            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                                    <RefreshCw className="h-8 w-8 text-slate-400" />
                                </div>
                                <h2 className="text-lg font-semibold text-slate-700">No learning recorded</h2>
                                <p className="mt-1 text-sm text-slate-500">
                                    Complete some quizzes to see your progress here!
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                                    <StatCard
                                        label="Total LOC"
                                        value={data.summary.totalLoc}
                                        subValue={`${data.summary.totalSegments} segments`}
                                        icon={Star}
                                        colorClass="border-rose-200 bg-rose-100 text-rose-800"
                                    />
                                    <StatCard
                                        label="First Time"
                                        value={data.summary.firstTimeLoc}
                                        subValue={`${data.summary.firstTimeSegments} new`}
                                        icon={Sparkles}
                                        colorClass="border-emerald-200 bg-emerald-100 text-emerald-800"
                                    />
                                    <StatCard
                                        label="Review"
                                        value={data.summary.repeatLoc}
                                        subValue={`${data.summary.repeatSegments} repeat`}
                                        icon={RefreshCw}
                                        colorClass="border-blue-200 bg-blue-100 text-blue-800"
                                    />
                                    <StatCard
                                        label="Gold Medal"
                                        value={data.summary.goldLoc}
                                        subValue={`${data.summary.goldSegments} perfect`}
                                        icon={Trophy}
                                        colorClass="border-amber-200 bg-amber-100 text-amber-800"
                                    />
                                </div>

                                {/* Repo breakdown */}
                                <div className="space-y-4">
                                    <h2 className="text-lg font-semibold text-slate-700">By Repository</h2>
                                    {Object.entries(data.byRepo)
                                        .sort((a, b) => b[1].totalLoc - a[1].totalLoc)
                                        .map(([repoId, repo]) => (
                                            <RepoSection key={repoId} repoId={repoId} detail={repo} />
                                        ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </section>
        </main>
    );
}
