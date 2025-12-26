"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

type RepoOrProjectItemProps = {
    id: string;
    label: string;
    kind: "repo" | "project";
};

export function RepoProjectItem({ id, label, kind }: RepoOrProjectItemProps) {
    const router = useRouter();
    // Delete confirmation state: 0 = idle, 1 = first confirm, 2 = second confirm
    const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            const endpoint =
                kind === "repo"
                    ? `/api/repos/${encodeURIComponent(id)}`
                    : `/api/projects/${encodeURIComponent(id)}`;
            const res = await fetch(endpoint, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(`Failed to delete: ${data.error || res.statusText}`);
                setIsDeleting(false);
                setDeleteStep(0);
                return;
            }
            // Success - refresh the page to update the list
            router.refresh();
        } catch (err) {
            alert(`Error: ${err}`);
            setIsDeleting(false);
            setDeleteStep(0);
        }
    };

    const baseHref = `/${kind}/${encodeURIComponent(id)}`;

    return (
        <li className="relative">
            {/* Normal view */}
            {deleteStep === 0 && (
                <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-white/70 transition hover:border-rose-300 hover:bg-white">
                    <Link
                        href={baseHref}
                        className="flex-1 px-4 py-3 text-sm font-medium hover:text-rose-700"
                    >
                        {label}
                    </Link>
                    <div className="flex items-center gap-2 pr-2">
                        <Link
                            href={baseHref}
                            className="text-[0.65rem] uppercase tracking-wide text-rose-400 px-2 py-1 rounded hover:bg-rose-100 hover:text-rose-600"
                        >
                            Browse
                        </Link>
                        <button
                            type="button"
                            onClick={() => setDeleteStep(1)}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition"
                            title={`Delete ${kind}`}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            )}

            {/* First confirmation */}
            {deleteStep === 1 && (
                <div className="flex items-center justify-between rounded-lg border border-rose-300 bg-rose-50 px-4 py-3">
                    <span className="text-sm font-medium text-rose-700">
                        Delete &quot;{label}&quot;?
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setDeleteStep(0)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-md border border-slate-200 hover:bg-slate-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => setDeleteStep(2)}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-rose-500 rounded-md hover:bg-rose-600 transition"
                        >
                            Yes, Delete
                        </button>
                    </div>
                </div>
            )}

            {/* Second confirmation (final) */}
            {deleteStep === 2 && (
                <div className="flex items-center justify-between rounded-lg border-2 border-rose-500 bg-rose-100 px-4 py-3">
                    <span className="text-sm font-medium text-rose-800">
                        ⚠️ This cannot be undone!
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setDeleteStep(0)}
                            disabled={isDeleting}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-md border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 rounded-md hover:bg-rose-700 transition disabled:opacity-50 flex items-center gap-1"
                        >
                            <Trash2 className="h-3 w-3" />
                            {isDeleting ? "Deleting..." : "Delete Forever"}
                        </button>
                    </div>
                </div>
            )}
        </li>
    );
}
