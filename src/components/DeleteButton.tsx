"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type DeleteButtonProps = {
    kind: "repo" | "project";
    id: string;
    path: string;
    isDir?: boolean;
    label?: string;
};

export function DeleteButton({ kind, id, path, isDir, label }: DeleteButtonProps) {
    const router = useRouter();
    const [state, setState] = useState<"idle" | "confirm" | "deleting">("idle");

    // Reset confirmation state after 3 seconds
    useEffect(() => {
        if (state === "confirm") {
            const timer = setTimeout(() => setState("idle"), 3000);
            return () => clearTimeout(timer);
        }
    }, [state]);

    const handleClick = async () => {
        if (state === "idle") {
            setState("confirm");
            return;
        }

        if (state === "confirm") {
            setState("deleting");
            try {
                const res = await fetch("/api/fs", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "delete", kind, id, path, isDir }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({} as any));
                    alert(`Failed to delete: ${data.error || res.statusText}`);
                    setState("idle");
                    return;
                }
                // Refresh the page to show updated listing
                router.refresh();
            } catch (err: any) {
                alert(`Failed to delete: ${err.message}`);
                setState("idle");
            }
        }
    };

    const buttonClass = state === "confirm"
        ? "bg-red-600 text-white hover:bg-red-700"
        : state === "deleting"
            ? "bg-gray-400 text-white cursor-wait"
            : "bg-rose-100 text-rose-600 hover:bg-rose-200";

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={state === "deleting"}
            className={`ml-2 rounded px-2 py-0.5 text-[0.65rem] font-medium transition-colors ${buttonClass}`}
            title={isDir ? "Delete folder and contents" : "Delete file"}
        >
            {state === "confirm" ? "Confirm?" : state === "deleting" ? "..." : label || "Delete"}
        </button>
    );
}
