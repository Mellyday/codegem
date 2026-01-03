"use client";
import { useState, useEffect, useCallback } from "react";

type QuizStatus = {
    exists: boolean;
    quizId?: string;
    distractorStatus?: "complete" | "partial" | "none";
    totalCards?: number;
    cardsWithDistractors?: number;
    supported?: boolean;
    needsCanonical?: boolean; // Quizzes exist but no canonical set
};

type FileQuizActionsProps = {
    kind: "repo" | "project";
    id: string;
    path: string;
};

export function FileQuizActions({ kind, id, path }: FileQuizActionsProps) {
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
            <span className="inline-flex h-6 w-6 items-center justify-center">
                <span className="h-3 w-3 animate-pulse rounded-full bg-slate-300" />
            </span>
        );
    }

    if (status && status.supported === false) {
        return null;
    }

    // Hide icon if quizzes exist but no canonical is set
    // User needs to go to QuizViewer to set a canonical
    if (status?.needsCanonical) {
        return null;
    }

    // Determine icon and tooltip based on status
    let icon: React.ReactNode;
    let title: string;
    let buttonClass = "hover:bg-slate-100";

    if (loading) {
        // Loading spinner
        icon = (
            <svg
                className="h-4 w-4 animate-spin text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                />
                <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
            </svg>
        );
        title = "Processing...";
        buttonClass = "cursor-wait";
    } else if (!status?.exists) {
        // No quiz exists - show lightning bolt to create
        icon = (
            <svg
                className="h-4 w-4 text-purple-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                />
            </svg>
        );
        title = "Create quiz";
        buttonClass = "hover:bg-purple-50";
    } else if (status.distractorStatus === "complete") {
        // Quiz complete - show checkmark
        icon = (
            <svg
                className="h-4 w-4 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                />
            </svg>
        );
        title = "Quiz ready";
        buttonClass = "cursor-default";
    } else {
        // Quiz exists but distractors incomplete - show refresh
        icon = (
            <svg
                className="h-4 w-4 text-amber-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
            </svg>
        );
        const remaining = (status.totalCards || 0) - (status.cardsWithDistractors || 0);
        title = `Generate ${remaining} missing distractor${remaining !== 1 ? "s" : ""}`;
        buttonClass = "hover:bg-amber-50";
    }

    // Don't make complete quizzes clickable
    const isClickable =
        !loading && (!status?.exists || status.distractorStatus !== "complete");

    return (
        <button
            type="button"
            onClick={isClickable ? handleClick : undefined}
            disabled={loading}
            className={`inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${buttonClass}`}
            title={title}
        >
            {icon}
        </button>
    );
}
