import React from "react";

type MedalInfo = {
    type: "bronze" | "silver" | "gold";
    stars: 1 | 2 | 3;
};

type MedalBadgeProps = {
    medals: MedalInfo[];
    className?: string;
    /** Countdown info for gold medal upgrade (milliseconds remaining) */
    goldUpgradeInfo?: { msRemaining: number } | null;
};

// Medal color configurations
const MEDAL_COLORS = {
    bronze: {
        primary: "#CD7F32",
        secondary: "#A0522D",
        ribbon: "#8B4513",
    },
    silver: {
        primary: "#C0C0C0",
        secondary: "#A8A8A8",
        ribbon: "#6B7280",
    },
    gold: {
        primary: "#FFD700",
        secondary: "#DAA520",
        ribbon: "#B8860B",
    },
};

// Medal ranking for determining the best medal
const MEDAL_RANK = {
    bronze: 1,
    silver: 2,
    gold: 3,
};

// Custom SVG medal icon with star below
function MedalIcon({ type, stars }: { type: "bronze" | "silver" | "gold"; stars: 1 | 2 | 3 }) {
    const colors = MEDAL_COLORS[type];
    const starColor = type === "gold" ? "#FFA500" : type === "silver" ? "#4B5563" : "#D97706";

    return (
        <svg
            width="28"
            height="38"
            viewBox="0 0 28 38"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-sm"
        >
            {/* Ribbon */}
            <path
                d="M8 0L14 8L20 0L20 12L8 12L8 0Z"
                fill={colors.ribbon}
            />
            {/* Medal circle */}
            <circle cx="14" cy="18" r="10" fill={colors.primary} stroke={colors.secondary} strokeWidth="2" />
            {/* Inner circle */}
            <circle cx="14" cy="18" r="6" fill={colors.secondary} opacity="0.3" />
            {/* Star icon inside medal */}
            <path
                d="M14 13L15.2 16.2L18.6 16.4L16 18.6L16.8 22L14 20.2L11.2 22L12 18.6L9.4 16.4L12.8 16.2L14 13Z"
                fill={type === "gold" ? "#FFFFFF" : type === "silver" ? "#FFFFFF" : "#FFF8DC"}
                opacity="0.9"
            />
            {/* Stars below the medal */}
            {[...Array(stars)].map((_, i) => {
                const starWidth = 6;
                const spacing = 7;
                const totalWidth = stars * starWidth + (stars - 1) * (spacing - starWidth);
                const startX = 14 - totalWidth / 2 + i * spacing;
                return (
                    <path
                        key={i}
                        d={`M${startX + 3} ${31}L${startX + 3.7} ${32.8}L${startX + 5.6} ${32.9}L${startX + 4.2} ${34.2}L${startX + 4.5} ${36}L${startX + 3} ${34.9}L${startX + 1.5} ${36}L${startX + 1.8} ${34.2}L${startX + 0.4} ${32.9}L${startX + 2.3} ${32.8}L${startX + 3} ${31}Z`}
                        fill={starColor}
                    />
                );
            })}
        </svg>
    );
}

// Get non-dominated (Pareto-optimal) medals
// A medal is dominated if another medal has >= tier AND >= stars
// Example: gold★ dominates bronze★, but gold★ and silver★★ are both shown
function getNonDominatedMedals(medals: MedalInfo[]): MedalInfo[] {
    if (medals.length === 0) return [];

    // Remove exact duplicates first
    const unique = medals.filter((m, i, arr) =>
        arr.findIndex(x => x.type === m.type && x.stars === m.stars) === i
    );

    // Filter out dominated medals
    return unique.filter(medal => {
        const dominated = unique.some(other => {
            if (other === medal) return false;
            const medalRank = MEDAL_RANK[medal.type];
            const otherRank = MEDAL_RANK[other.type];
            // Other dominates medal if it's >= in both tier and stars, and strictly > in at least one
            const tierGe = otherRank >= medalRank;
            const starsGe = other.stars >= medal.stars;
            const strictlyBetter = otherRank > medalRank || other.stars > medal.stars;
            return tierGe && starsGe && strictlyBetter;
        });
        return !dominated;
    });
}

// Format milliseconds to human-readable countdown
function formatCountdown(ms: number): string {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    if (hours >= 1) {
        return `${hours} hr${hours === 1 ? '' : 's'}`;
    }
    return `${minutes} min${minutes === 1 ? '' : 's'}`;
}

export function MedalBadge({ medals, className = "", goldUpgradeInfo }: MedalBadgeProps) {
    const displayMedals = getNonDominatedMedals(medals);
    if (displayMedals.length === 0) return null;

    // Sort by tier (gold first) then by stars (descending)
    const sorted = [...displayMedals].sort((a, b) => {
        const tierDiff = MEDAL_RANK[b.type] - MEDAL_RANK[a.type];
        if (tierDiff !== 0) return tierDiff;
        return b.stars - a.stars;
    });

    // Check if there's a gold medal with countdown
    const hasGoldWithCountdown = goldUpgradeInfo?.msRemaining && goldUpgradeInfo.msRemaining > 0 &&
        sorted.some(m => m.type === "gold" && m.stars < 3);

    return (
        <div className={`inline-flex items-center gap-1 ${className}`}>
            {sorted.map((medal, index) => (
                <div
                    key={`${medal.type}-${medal.stars}-${index}`}
                    title={`${medal.type.charAt(0).toUpperCase() + medal.type.slice(1)} - ${medal.stars} star${medal.stars > 1 ? "s" : ""}`}
                >
                    <MedalIcon type={medal.type} stars={medal.stars} />
                </div>
            ))}
            {hasGoldWithCountdown && (
                <span className="text-xs font-medium text-amber-600 whitespace-nowrap">
                    {formatCountdown(goldUpgradeInfo!.msRemaining!)}
                </span>
            )}
        </div>
    );
}
