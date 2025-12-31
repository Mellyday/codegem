export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
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

    // Sort by date (oldest first)
    relevantAttempts.sort(
        (a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime()
    );

    let currentStars: 1 | 2 | 3 = 1;

    // Check for 2-star upgrade (48 hours = 48 * 60 * 60 * 1000 ms)
    const TWO_STAR_COOLDOWN = 48 * 60 * 60 * 1000;
    if (relevantAttempts.length >= 2) {
        const firstAttempt = relevantAttempts[0];
        const secondAttempt = relevantAttempts[1];
        const timeDiff =
            secondAttempt.attemptedAt.getTime() - firstAttempt.attemptedAt.getTime();
        if (timeDiff >= TWO_STAR_COOLDOWN) {
            currentStars = 2;
        }
    }

    // Check for 3-star upgrade (5 days = 5 * 24 * 60 * 60 * 1000 ms)
    const THREE_STAR_COOLDOWN = 5 * 24 * 60 * 60 * 1000;
    if (currentStars === 2 && relevantAttempts.length >= 3) {
        // Find the first 2-star qualifying attempt
        let twoStarAttempt = null;
        for (let i = 1; i < relevantAttempts.length; i++) {
            const timeDiff =
                relevantAttempts[i].attemptedAt.getTime() -
                relevantAttempts[i - 1].attemptedAt.getTime();
            if (timeDiff >= TWO_STAR_COOLDOWN) {
                twoStarAttempt = relevantAttempts[i];
                break;
            }
        }

        if (twoStarAttempt) {
            // Check if there's a third attempt after the 2-star attempt
            const thirdAttempt = relevantAttempts.find(
                (a) => a.attemptedAt.getTime() > twoStarAttempt!.attemptedAt.getTime()
            );
            if (thirdAttempt) {
                const timeDiff =
                    thirdAttempt.attemptedAt.getTime() -
                    twoStarAttempt.attemptedAt.getTime();
                if (timeDiff >= THREE_STAR_COOLDOWN) {
                    currentStars = 3;
                }
            }
        }
    }

    return currentStars;
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

        const db = await getDb();
        const attempts = db.collection("quiz_attempts");

        const now = new Date();
        const attemptDoc: QuizAttempt = {
            userId: clerkUserId,
            quizId: String(quizId),
            sectionIndex,
            attemptedAt: now,
            totalQuestions,
            correctAnswers,
            score,
            medalEarned,
            createdAt: now,
        };

        await attempts.insertOne(attemptDoc as any);

        // Fetch all attempts for this section to calculate stars
        const allAttempts = await attempts
            .find({
                userId: clerkUserId,
                quizId: String(quizId),
                sectionIndex,
            })
            .sort({ attemptedAt: 1 })
            .toArray();

        // Calculate medals and stars
        const medalMap = new Map<string, { stars: 1 | 2 | 3 }>();
        const attemptsList = allAttempts as unknown as QuizAttempt[];

        for (const medalType of ["bronze", "silver", "gold"] as const) {
            const hasThisMedal = attemptsList.some(
                (a) => a.medalEarned && medalRank[a.medalEarned] >= medalRank[medalType]
            );
            if (hasThisMedal) {
                const stars = calculateStars(attemptsList, medalType);
                medalMap.set(medalType, { stars });
            }
        }

        const medalRank = { bronze: 1, silver: 2, gold: 3 };
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

        const db = await getDb();
        const attempts = db.collection("quiz_attempts");

        // Fetch all attempts for this quiz
        const allAttempts = await attempts
            .find({
                userId: clerkUserId,
                quizId: String(quizId),
            })
            .sort({ attemptedAt: 1 })
            .toArray();

        const attemptsList = allAttempts as unknown as QuizAttempt[];

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
            { medals: MedalInfo[]; lastAttempt?: Date }
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

            result[sectionIndex] = {
                medals: medalsToDisplay,
                lastAttempt,
            };
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("GET /api/quiz-attempts error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
