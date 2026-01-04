export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, generateId, toDbDate } from "../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

type MedalType = "bronze" | "silver" | "gold" | null;

type QuizAttempt = {
    userId: string;
    quizId: string;
    sectionIndex: number;
    attemptedAt: Date;
    totalQuestions: number;
    correctAnswers: number;
    score: number;
    medalEarned: MedalType;
    createdAt: Date;
};

type MedalInfo = {
    type: "bronze" | "silver" | "gold";
    stars: 1 | 2 | 3;
};

// Calculate medal type based on score percentage
function calculateMedal(score: number): MedalType {
    if (score >= 100) return "gold";
    if (score >= 95) return "silver";
    if (score >= 80) return "bronze";
    return null;
}

// Calculate star level based on attempt history and time-gating
// Uses time since LAST ATTEMPT (any attempt, regardless of result) as the reference
function calculateStars(
    attempts: QuizAttempt[],
    medalType: "bronze" | "silver" | "gold"
): 1 | 2 | 3 {
    // Filter attempts that earned this medal or better
    const medalRank = { bronze: 1, silver: 2, gold: 3 };
    const relevantAttempts = attempts.filter((a) => {
        if (!a.medalEarned) return false;
        return medalRank[a.medalEarned] >= medalRank[medalType];
    });

    if (relevantAttempts.length === 0) return 1;

    // Sort all attempts by date (oldest first)
    const allAttemptsSorted = [...attempts].sort(
        (a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime()
    );

    // Get last attempt of any kind
    const lastAttempt = allAttemptsSorted[allAttemptsSorted.length - 1];
    const now = new Date();

    let currentStars: 1 | 2 | 3 = 1;

    // Check for 2-star upgrade (48 hours = 48 * 60 * 60 * 1000 ms)
    // Time from last attempt (any attempt) to now must be >= 48 hours
    const TWO_STAR_COOLDOWN = 48 * 60 * 60 * 1000;
    const timeSinceLastAttempt = now.getTime() - lastAttempt.attemptedAt.getTime();

    if (timeSinceLastAttempt >= TWO_STAR_COOLDOWN) {
        currentStars = 2;
    }

    // Check for 3-star upgrade (5 days = 5 * 24 * 60 * 60 * 1000 ms)
    const THREE_STAR_COOLDOWN = 5 * 24 * 60 * 60 * 1000;
    if (currentStars === 2 && timeSinceLastAttempt >= THREE_STAR_COOLDOWN) {
        currentStars = 3;
    }

    return currentStars;
}

// Calculate gold upgrade info (time remaining until next star upgrade)
// Only applies to gold medals that aren't at 3 stars yet
type GoldUpgradeInfo = {
    currentStars: 1 | 2 | 3;
    lastAttemptAt: Date;
    nextUpgradeAt: Date | null;
    msRemaining: number | null;
};

function calculateGoldUpgradeInfo(
    attempts: QuizAttempt[],
    goldStars: 1 | 2 | 3
): GoldUpgradeInfo | null {
    if (attempts.length === 0) return null;
    if (goldStars === 3) return null; // Already at max stars

    // Get the last attempt of any kind
    const sortedAttempts = [...attempts].sort(
        (a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime()
    );
    const lastAttempt = sortedAttempts[sortedAttempts.length - 1];
    const now = new Date();

    // Calculate cooldown based on current stars
    const TWO_STAR_COOLDOWN = 48 * 60 * 60 * 1000; // 48 hours
    const THREE_STAR_COOLDOWN = 5 * 24 * 60 * 60 * 1000; // 5 days

    const targetCooldown = goldStars === 1 ? TWO_STAR_COOLDOWN : THREE_STAR_COOLDOWN;
    const nextUpgradeAt = new Date(lastAttempt.attemptedAt.getTime() + targetCooldown);
    const msRemaining = nextUpgradeAt.getTime() - now.getTime();

    return {
        currentStars: goldStars,
        lastAttemptAt: lastAttempt.attemptedAt,
        nextUpgradeAt: msRemaining > 0 ? nextUpgradeAt : null,
        msRemaining: msRemaining > 0 ? msRemaining : null,
    };
}

// Determine which medals to display based on the rules
function getMedalsToDisplay(
    allMedals: Map<string, { stars: 1 | 2 | 3 }>
): MedalInfo[] {
    const medalRank = { bronze: 1, silver: 2, gold: 3 };
    const medalsArray = Array.from(allMedals.entries()).map(([type, info]) => ({
        type: type as "bronze" | "silver" | "gold",
        stars: info.stars,
    }));

    if (medalsArray.length === 0) return [];

    // Find highest medal and highest stars
    let highestMedal = medalsArray[0];
    let highestStars = medalsArray[0];

    for (const medal of medalsArray) {
        if (medalRank[medal.type] > medalRank[highestMedal.type]) {
            highestMedal = medal;
        }
        if (medal.stars > highestStars.stars) {
            highestStars = medal;
        }
    }

    // If highest medal also has highest stars, show only that one
    if (
        highestMedal.type === highestStars.type &&
        highestMedal.stars === highestStars.stars
    ) {
        return [highestMedal];
    }

    // Otherwise show both
    return [highestStars, highestMedal];
}

// POST /api/quiz-attempts - Record a quiz attempt
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { quizId, sectionIndex, totalQuestions, correctAnswers } = body;

        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (
            !quizId ||
            typeof sectionIndex !== "number" ||
            typeof totalQuestions !== "number" ||
            typeof correctAnswers !== "number"
        ) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        const score = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
        const medalEarned = calculateMedal(score);

        const db = getDb();
        const now = toDbDate(new Date());

        db.prepare(`
            INSERT INTO quiz_attempts (
                id, user_id, quiz_id, section_index, attempted_at,
                total_questions, correct_answers, score, medal_earned, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            generateId(),
            clerkUserId,
            String(quizId),
            sectionIndex,
            now,
            totalQuestions,
            correctAnswers,
            score,
            medalEarned,
            now
        );

        // Fetch all attempts for this section to calculate stars
        const rows = db.prepare(`
            SELECT user_id, quiz_id, section_index, attempted_at, total_questions,
                   correct_answers, score, medal_earned, created_at
            FROM quiz_attempts
            WHERE user_id = ? AND quiz_id = ? AND section_index = ?
            ORDER BY attempted_at ASC
        `).all(clerkUserId, String(quizId), sectionIndex) as Array<{
            user_id: string;
            quiz_id: string;
            section_index: number;
            attempted_at: string;
            total_questions: number;
            correct_answers: number;
            score: number;
            medal_earned: string | null;
            created_at: string;
        }>;

        // Calculate medals and stars
        const medalRank = { bronze: 1, silver: 2, gold: 3 };
        const medalMap = new Map<string, { stars: 1 | 2 | 3 }>();
        const attemptsList: QuizAttempt[] = rows.map(r => ({
            userId: r.user_id,
            quizId: r.quiz_id,
            sectionIndex: r.section_index,
            attemptedAt: new Date(r.attempted_at),
            totalQuestions: r.total_questions,
            correctAnswers: r.correct_answers,
            score: r.score,
            medalEarned: r.medal_earned as MedalType,
            createdAt: new Date(r.created_at),
        }));

        for (const medalType of ["bronze", "silver", "gold"] as const) {
            const hasThisMedal = attemptsList.some(
                (a) => a.medalEarned && medalRank[a.medalEarned] >= medalRank[medalType]
            );
            if (hasThisMedal) {
                const stars = calculateStars(attemptsList, medalType);
                medalMap.set(medalType, { stars });
            }
        }

        const medalsToDisplay = getMedalsToDisplay(medalMap);

        return NextResponse.json({
            success: true,
            medalEarned,
            score: Math.round(score * 10) / 10,
            medals: medalsToDisplay,
        });
    } catch (error) {
        console.error("POST /api/quiz-attempts error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

// GET /api/quiz-attempts/medals - Fetch medals for all sections of a quiz
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const quizId = url.searchParams.get("quizId");

        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!quizId) {
            return NextResponse.json({ error: "Missing quizId" }, { status: 400 });
        }

        const db = getDb();

        // Fetch all attempts for this quiz
        const rows = db.prepare(`
            SELECT user_id, quiz_id, section_index, attempted_at, total_questions,
                   correct_answers, score, medal_earned, created_at
            FROM quiz_attempts
            WHERE user_id = ? AND quiz_id = ?
            ORDER BY attempted_at ASC
        `).all(clerkUserId, String(quizId)) as Array<{
            user_id: string;
            quiz_id: string;
            section_index: number;
            attempted_at: string;
            total_questions: number;
            correct_answers: number;
            score: number;
            medal_earned: string | null;
            created_at: string;
        }>;

        const attemptsList: QuizAttempt[] = rows.map(r => ({
            userId: r.user_id,
            quizId: r.quiz_id,
            sectionIndex: r.section_index,
            attemptedAt: new Date(r.attempted_at),
            totalQuestions: r.total_questions,
            correctAnswers: r.correct_answers,
            score: r.score,
            medalEarned: r.medal_earned as MedalType,
            createdAt: new Date(r.created_at),
        }));

        // Group by section
        const bySectionIndex = new Map<number, QuizAttempt[]>();
        for (const attempt of attemptsList) {
            const sectionAttempts = bySectionIndex.get(attempt.sectionIndex) || [];
            sectionAttempts.push(attempt);
            bySectionIndex.set(attempt.sectionIndex, sectionAttempts);
        }

        const medalRank = { bronze: 1, silver: 2, gold: 3 };

        // Calculate medals for each section
        const result: Record<
            number,
            { medals: MedalInfo[]; lastAttempt?: Date; goldUpgradeInfo?: { msRemaining: number } | null }
        > = {};

        for (const [sectionIndex, sectionAttempts] of bySectionIndex.entries()) {
            const medalMap = new Map<string, { stars: 1 | 2 | 3 }>();

            for (const medalType of ["bronze", "silver", "gold"] as const) {
                const hasThisMedal = sectionAttempts.some(
                    (a) =>
                        a.medalEarned && medalRank[a.medalEarned] >= medalRank[medalType]
                );
                if (hasThisMedal) {
                    const stars = calculateStars(sectionAttempts, medalType);
                    medalMap.set(medalType, { stars });
                }
            }

            const medalsToDisplay = getMedalsToDisplay(medalMap);
            const lastAttempt = sectionAttempts[sectionAttempts.length - 1]?.attemptedAt;

            // Calculate gold upgrade info if applicable
            let goldUpgradeInfo: { msRemaining: number } | null = null;
            const goldMedal = medalMap.get("gold");
            if (goldMedal && goldMedal.stars < 3) {
                const upgradeInfo = calculateGoldUpgradeInfo(sectionAttempts, goldMedal.stars);
                if (upgradeInfo?.msRemaining && upgradeInfo.msRemaining > 0) {
                    goldUpgradeInfo = { msRemaining: upgradeInfo.msRemaining };
                }
            }

            result[sectionIndex] = {
                medals: medalsToDisplay,
                lastAttempt,
                goldUpgradeInfo,
            };
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("GET /api/quiz-attempts error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
