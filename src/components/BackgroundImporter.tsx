"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type JobStatus = "pending" | "cloning" | "processing" | "complete" | "failed" | "cancelled";

type ImportJob = {
    id: string;
    url: string;
    owner: string;
    name: string;
    status: JobStatus;
    repoId: string | null;
    totalFiles: number;
    parsedFiles: number;
    failedFiles: number;
    skippedFiles: number;
    currentFile: string | null;
    currentIndex: number;
    error: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
};

type Props = {
    onComplete?: (job: ImportJob) => void;
};

export default function BackgroundImporter({ onComplete }: Props) {
    const [url, setUrl] = useState("");
    const [job, setJob] = useState<ImportJob | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const validateUrl = (input: string): boolean => {
        try {
            const parsed = new URL(input);
            return /^github\.com$/i.test(parsed.hostname);
        } catch {
            return false;
        }
    };

    // Poll for job status
    const pollJob = useCallback(async (jobId: string) => {
        try {
            const response = await fetch(`/api/jobs/${jobId}`);
            if (!response.ok) return;

            const data = await response.json();
            setJob(data);

            // Check if job is complete
            if (["complete", "failed", "cancelled"].includes(data.status)) {
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
                if (data.status === "complete" && onComplete) {
                    onComplete(data);
                }
            }
        } catch {
            // Ignore poll errors
        }
    }, [onComplete]);

    // Start polling when job is created
    useEffect(() => {
        if (job && ["pending", "cloning", "processing"].includes(job.status)) {
            if (!pollIntervalRef.current) {
                pollIntervalRef.current = setInterval(() => {
                    pollJob(job.id);
                }, 2000); // Poll every 2 seconds
            }
        }
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [job, pollJob]);

    const handleSubmit = async () => {
        if (!validateUrl(url)) {
            setError("Please enter a valid GitHub repository URL");
            return;
        }

        setError(null);
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/jobs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Failed to create job");
            }

            const data = await response.json();
            setJob(data);

            // Start polling immediately
            pollJob(data.id);
        } catch (err) {
            setError(String(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCancel = async () => {
        if (!job) return;

        try {
            await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
            // Polling will update the status
        } catch {
            // Ignore cancel errors
        }
    };

    const handleReset = () => {
        setJob(null);
        setError(null);
        setUrl("");
    };

    const isValidUrl = validateUrl(url);
    const isActive = job && ["pending", "cloning", "processing"].includes(job.status);
    const progressPercent = job?.totalFiles
        ? Math.round(((job.parsedFiles + job.failedFiles + job.skippedFiles) / job.totalFiles) * 100)
        : 0;

    return (
        <div className="rounded-xl border border-purple-200 bg-white/80 p-6 shadow-sm backdrop-blur">
            <h2 className="mb-4 text-lg font-semibold text-purple-700">
                Background Import (Large Repos)
            </h2>
            <p className="mb-4 text-sm text-purple-600/80">
                Use this for large repositories. Processing happens in the background with throttling.
            </p>

            {!job ? (
                <>
                    {/* URL Input */}
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => {
                                setUrl(e.target.value);
                                if (error) setError(null);
                            }}
                            placeholder="https://github.com/owner/repo"
                            disabled={isSubmitting}
                            className="flex-1 rounded-lg border border-purple-200 bg-white px-4 py-2.5 text-sm 
                                placeholder:text-purple-400 focus:border-purple-400 focus:outline-none focus:ring-2 
                                focus:ring-purple-100 disabled:bg-purple-50 disabled:text-purple-400"
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={!isValidUrl || isSubmitting}
                            className="rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-medium text-white 
                                transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-purple-300"
                        >
                            {isSubmitting ? "Creating..." : "Start Import"}
                        </button>
                    </div>

                    {url && !isValidUrl && (
                        <p className="mt-2 text-xs text-purple-500">
                            Enter a valid GitHub URL (e.g., https://github.com/owner/repo)
                        </p>
                    )}

                    {error && (
                        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                            {error}
                        </div>
                    )}
                </>
            ) : (
                <div className="space-y-4">
                    {/* Job info */}
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-sm font-medium text-purple-700">
                                {job.owner}/{job.name}
                            </span>
                            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${job.status === "complete" ? "bg-green-100 text-green-700" :
                                    job.status === "failed" ? "bg-red-100 text-red-700" :
                                        job.status === "cancelled" ? "bg-gray-100 text-gray-700" :
                                            "bg-purple-100 text-purple-700"
                                }`}>
                                {job.status}
                            </span>
                        </div>
                        {isActive && (
                            <button
                                onClick={handleCancel}
                                className="text-sm text-purple-600 hover:text-purple-700"
                            >
                                Cancel
                            </button>
                        )}
                    </div>

                    {/* Progress bar */}
                    {job.totalFiles > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-purple-600">
                                    {job.status === "cloning" ? "Cloning repository..." :
                                        job.status === "processing" ? `Processing files...` :
                                            job.status === "complete" ? "Complete!" :
                                                job.status === "failed" ? "Failed" :
                                                    job.status}
                                </span>
                                <span className="text-purple-500">
                                    {job.currentIndex}/{job.totalFiles} ({progressPercent}%)
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-purple-100">
                                <div
                                    className="h-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all duration-300"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Current file */}
                    {job.currentFile && isActive && (
                        <div className="rounded-lg bg-purple-50 p-3">
                            <p className="truncate text-xs text-purple-500">
                                <span className="font-medium">Processing:</span> {job.currentFile}
                            </p>
                        </div>
                    )}

                    {/* Stats */}
                    <div className="flex gap-4 text-xs">
                        <span className="text-emerald-600">✓ Parsed: {job.parsedFiles}</span>
                        <span className="text-red-500">✗ Failed: {job.failedFiles}</span>
                        <span className="text-gray-500">⊘ Skipped: {job.skippedFiles}</span>
                    </div>

                    {/* Error message */}
                    {job.error && (
                        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                            {job.error}
                        </div>
                    )}

                    {/* Success/reset button */}
                    {["complete", "failed", "cancelled"].includes(job.status) && (
                        <button
                            onClick={handleReset}
                            className="text-sm text-purple-600 underline hover:text-purple-700"
                        >
                            Import another repository
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
