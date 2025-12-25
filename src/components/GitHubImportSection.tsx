"use client";

import dynamic from "next/dynamic";

// Dynamic imports to avoid SSR issues with localStorage
const GitHubFetcher = dynamic(
    () => import("@/src/components/GitHubFetcher"),
    { ssr: false }
);

const FetchLogsPanel = dynamic(
    () => import("@/src/components/FetchLogsPanel"),
    { ssr: false }
);

export default function GitHubImportSection() {
    return (
        <div className="space-y-6">
            <GitHubFetcher />
            <FetchLogsPanel />
        </div>
    );
}
