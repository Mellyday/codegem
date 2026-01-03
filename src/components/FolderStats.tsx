"use client";

export type FolderStatsData = {
    totalFiles: number;
    filesDone: number;
    totalSections: number;
    goldCount: number;
    gold3StarCount: number;
};

type FolderStatsProps = {
    stats?: FolderStatsData;
};

export function FolderStats({ stats }: FolderStatsProps) {
    if (!stats || stats.totalFiles === 0) {
        return null;
    }

    return (
        <div className="flex items-center gap-2 text-xs">
            {/* Files done / total */}
            <span
                className={`font-medium ${stats.filesDone > 0 ? "text-emerald-600" : "text-slate-400"}`}
                title={`${stats.filesDone}/${stats.totalFiles} files attempted`}
            >
                {stats.filesDone}/{stats.totalFiles}📁
            </span>

            {/* Gold medal count */}
            {stats.totalSections > 0 && (
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
}
