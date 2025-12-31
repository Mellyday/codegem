import React from "react";

type MedalInfo = {
    type: "bronze" | "silver" | "gold";
    stars: 1 | 2 | 3;
};

type MedalBadgeProps = {
    medals: MedalInfo[];
    className?: string;
};

const MEDAL_COLORS = {
    bronze: {
        bg: "bg-amber-100",
        text: "text-amber-800",
        border: "border-amber-300",
    },
    silver: {
        bg: "bg-slate-100",
        text: "text-slate-700",
        border: "border-slate-300",
    },
    gold: {
        bg: "bg-yellow-100",
        text: "text-yellow-800",
        border: "border-yellow-400",
    },
};

const MEDAL_EMOJI = {
    bronze: "🥉",
    silver: "🥈",
    gold: "🥇",
};

export function MedalBadge({ medals, className = "" }: MedalBadgeProps) {
    if (medals.length === 0) return null;

    return (
        <div className={`flex items-center gap-1.5 ${className}`}>
            {medals.map((medal, index) => {
                const colors = MEDAL_COLORS[medal.type];
                const emoji = MEDAL_EMOJI[medal.type];
                const stars = "★".repeat(medal.stars);

                return (
                    <div
                        key={`${medal.type}-${index}`}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${colors.bg} ${colors.text} ${colors.border}`}
                        title={`${medal.type.charAt(0).toUpperCase() + medal.type.slice(1)} - ${medal.stars} star${medal.stars > 1 ? "s" : ""}`}
                    >
                        <span className="text-sm">{emoji}</span>
                        <span className="text-yellow-600">{stars}</span>
                    </div>
                );
            })}
        </div>
    );
}
