"use client";
import { useState, useEffect, useCallback } from "react";

type QuizStatus = {
    exists: boolean;
    quizId?: string;
    distractorStatus?: "complete" | "partial" | "none";
    totalCards?: number;
    cardsWithDistractors?: number;
    supported?: boolean;
    needsCanonical?: boolean;
};

export type FileStats = {
    isFresh: boolean;
    totalSections: number;
    goldCount: number;
    gold3StarCount: number;
};

type FileQuizActionsProps = {
    kind: "repo" | "project";
    id: string;
    path: string;
    stats?: FileStats; // Pre-fetched stats from parent
};

export function FileQuizActions({ kind, id, path, stats }: FileQuizActionsProps) {
    const [status, setStatus] = useState<QuizStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);

    // Check quiz status on mount
    const checkStatus = useCallback(async () => {
        try {
            const res = await fetch(
                `/api/quizzes/auto-generate?kind=${kind}&id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`
            );
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch {
            // Silently fail
        } finally {
            setChecking(false);
        }
    }, [kind, id, path]);

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (loading) return;
        setLoading(true);

        try {
            if (!status?.exists) {
                // Create new quiz
                const res = await fetch("/api/quizzes/auto-generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind, id, path }),
                });

                if (!res.ok) {
                    console.error("Failed to create quiz");
                    return;
                }

                const data = await res.json();
                const quizId = data.quizId;

                // Now trigger distractor generation
                if (quizId) {
                    await generateDistractors(quizId);
                }
            } else if (status.distractorStatus !== "complete" && status.quizId) {
                // Regenerate missing distractors
                await generateDistractors(status.quizId);
            }

            // Refresh status
            await checkStatus();
        } catch (error) {
            console.error("Quiz action failed:", error);
        } finally {
            setLoading(false);
        }
    };

    const generateDistractors = async (quizId: string) => {
        const missingOnly = status?.distractorStatus === "partial";
        const url = `/api/quizzes/${quizId}/distractors${missingOnly ? "?missingOnly=1" : ""}`;

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });

        if (!res.ok) {
            console.error("Failed to generate distractors");
        }
    };

    // Don't show for unsupported file types
    if (checking) {
        return (
            <span className="inline-flex h-6 items-center justify-center gap-1">
                <span className="h-3 w-3 animate-pulse rounded-full bg-slate-300" />
            </span>
        );
    }

    if (status && status.supported === false) {
        return null;
    }

    // Hide icon if quizzes exist but no canonical is set
    if (status?.needsCanonical) {
        return null;
    }

    // Render the action button and stats
    let actionIcon: React.ReactNode;
    let title: string;
    let buttonClass = "hover:bg-slate-100";

    if (loading) {
        actionIcon = (
            <svg className="h-4 w-4 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
        );
        title = "Processing...";
        buttonClass = "cursor-wait";
    } else if (!status?.exists) {
        actionIcon = (
            <svg className="h-4 w-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
        );
        title = "Create quiz";
        buttonClass = "hover:bg-purple-50";
    } else if (status.distractorStatus === "complete") {
        actionIcon = (
            <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
        );
        title = "Quiz ready";
        buttonClass = "cursor-default";
    } else {
        actionIcon = (
            <svg className="h-4 w-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
        );
        const remaining = (status.totalCards || 0) - (status.cardsWithDistractors || 0);
        title = `Generate ${remaining} missing distractor${remaining !== 1 ? "s" : ""}`;
        buttonClass = "hover:bg-amber-50";
    }

    const isClickable = !loading && (!status?.exists || status.distractorStatus !== "complete");

    // Render stats if available
    const renderStats = () => {
        if (!stats) return null;

        return (
            <div className="flex items-center gap-2 text-xs">
                {/* Fresh indicator - NEW badge for files never attempted */}
                {stats.isFresh && (
                    <span
                        className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700"
                        title="Fresh - never attempted"
                    >
                        New
                    </span>
                )}
                {/* Gold medal count */}
                {stats.totalSections > 0 && !stats.isFresh && (
                    <span
                        className={`font-medium ${stats.goldCount > 0 ? "text-yellow-600" : "text-slate-400"}`}
                        title={`${stats.goldCount}/${stats.totalSections} gold medals`}
                    >
                        {stats.goldCount}/{stats.totalSections}🥇
                    </span>
                )}
                {/* 3-star gold count */}
                {stats.gold3StarCount > 0 && (
                    <span className="font-medium text-yellow-500" title={`${stats.gold3StarCount} 3-star golds`}>
                        {stats.gold3StarCount}⭐
                    </span>
                )}
            </div>
        );
    };

    return (
        <div className="inline-flex items-center gap-1.5">
            {renderStats()}
            <button
                type="button"
                onClick={isClickable ? handleClick : undefined}
                disabled={loading}
                className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${buttonClass}`}
                title={title}
            >
                {actionIcon}
            </button>
        </div>
    );
}
