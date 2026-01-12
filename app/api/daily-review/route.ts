export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, fromJson } from "../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

type MedalType = "bronze" | "silver" | "gold" | null;

interface SourceRef {
    nodeType: string;
    start: number;
    end: number;
    path: number[];
    fieldName?: string;
    textHash?: string;
    preview?: string;
}

interface QuizCard {
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    sourceRef?: SourceRef;
    // Other fields not needed for LOC calculation
}

interface SegmentInfo {
    quizId: string;
    sectionIndex: number;
    loc: number;
    isFirstTime: boolean;
    isGold: boolean;
    filePath: string;
    repoId: string;
    repoName: string;
    kind: "repo" | "project";
}

interface DailyReviewResponse {
    date: string;
    summary: {
        totalLoc: number;
        firstTimeLoc: number;
        repeatLoc: number;
        goldLoc: number;
        totalSegments: number;
        firstTimeSegments: number;
        repeatSegments: number;
        goldSegments: number;
    };
    byRepo: {
        [repoId: string]: {
            repoName: string;
            kind: "repo" | "project";
            totalLoc: number;
            files: {
                [filePath: string]: {
                    loc: number;
                    segments: Array<{
                        sectionIndex: number;
                        loc: number;
                        isFirstTime: boolean;
                        isGold: boolean;
                    }>;
                };
            };
        };
    };
}

// SQLite parameter limit - use chunks smaller than 999
const SQLITE_PARAM_CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// Count lines of code from byte range in source
function countLoc(sourceCode: string, startByte: number, endByte: number): number {
    if (!sourceCode || startByte >= endByte) return 0;
    const slice = sourceCode.substring(startByte, endByte);
    // Count lines (newlines + 1, but at minimum 1 if there's any content)
    const newlineCount = (slice.match(/\n/g) || []).length;
    return newlineCount + 1;
}

// Get cards for a specific section based on section markers
function getCardsForSection(
    cards: QuizCard[],
    sectionMarkers: number[],
    sectionIndex: number
): QuizCard[] {
    if (!cards || cards.length === 0) return [];

    // Sort cards by order
    const sortedCards = [...cards].sort((a, b) => a.order - b.order);

    if (sectionMarkers.length === 0) {
        // No markers = single section containing all cards
        return sectionIndex === 0 ? sortedCards : [];
    }

    // Determine start and end card indices for this section
    const startCardOrder = sectionMarkers[sectionIndex] ?? 0;
    const endCardOrder = sectionMarkers[sectionIndex + 1] ?? cards.length;

    return sortedCards.filter(c => c.order >= startCardOrder && c.order < endCardOrder);
}

// Calculate LOC for a section from card sourceRefs
function calculateSectionLoc(
    cards: QuizCard[],
    sectionMarkers: number[],
    sectionIndex: number,
    sourceCode: string
): number {
    const sectionCards = getCardsForSection(cards, sectionMarkers, sectionIndex);
    if (sectionCards.length === 0) return 0;

    // Find min start and max end from all card sourceRefs
    let minStart = Infinity;
    let maxEnd = 0;

    for (const card of sectionCards) {
        if (card.sourceRef) {
            if (card.sourceRef.start < minStart) minStart = card.sourceRef.start;
            if (card.sourceRef.end > maxEnd) maxEnd = card.sourceRef.end;
        }
    }

    if (minStart === Infinity || maxEnd === 0) {
        // No valid sourceRefs, estimate from card count
        return sectionCards.length;
    }

    return countLoc(sourceCode, minStart, maxEnd);
}

/**
 * GET /api/daily-review?date=YYYY-MM-DD
 * 
 * Returns daily learning statistics with LOC breakdown
 */
export async function GET(request: Request) {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const dateParam = url.searchParams.get("date");

        // Parse date or default to today
        const targetDate = dateParam ? new Date(dateParam) : new Date();
        const dateStr = targetDate.toISOString().split("T")[0]; // YYYY-MM-DD

        // Date range for the day (start of day to end of day)
        const dayStart = `${dateStr}T00:00:00.000Z`;
        const dayEnd = `${dateStr}T23:59:59.999Z`;

        const db = getDb();

        // 1. Get all quiz attempts for this user on this date
        const attempts = db.prepare(`
            SELECT DISTINCT quiz_id, section_index, medal_earned
            FROM quiz_attempts
            WHERE user_id = ? AND attempted_at >= ? AND attempted_at <= ?
        `).all(clerkUserId, dayStart, dayEnd) as Array<{
            quiz_id: string;
            section_index: number;
            medal_earned: string | null;
        }>;

        if (attempts.length === 0) {
            // Return empty response
            const emptyResponse: DailyReviewResponse = {
                date: dateStr,
                summary: {
                    totalLoc: 0,
                    firstTimeLoc: 0,
                    repeatLoc: 0,
                    goldLoc: 0,
                    totalSegments: 0,
                    firstTimeSegments: 0,
                    repeatSegments: 0,
                    goldSegments: 0,
                },
                byRepo: {},
            };
            return NextResponse.json(emptyResponse);
        }

        // 2. Dedupe: group by (quiz_id, section_index), check if any attempt was gold
        const segmentMap = new Map<string, { quizId: string; sectionIndex: number; isGold: boolean }>();
        for (const a of attempts) {
            const key = `${a.quiz_id}:${a.section_index}`;
            const existing = segmentMap.get(key);
            const isGold = a.medal_earned === "gold";
            if (!existing) {
                segmentMap.set(key, { quizId: a.quiz_id, sectionIndex: a.section_index, isGold });
            } else if (isGold && !existing.isGold) {
                existing.isGold = true;
            }
        }

        // 3. Get quiz data for all unique quiz IDs
        const uniqueQuizIds = [...new Set(Array.from(segmentMap.values()).map(s => s.quizId))];

        const quizData = new Map<string, {
            fileId: string;
            cards: QuizCard[];
            sectionMarkers: number[];
            origin: { kind: "repo" | "project"; id: string; path: string } | null;
        }>();

        for (const chunk of chunkArray(uniqueQuizIds, SQLITE_PARAM_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => "?").join(",");
            const rows = db.prepare(`
                SELECT id, file_id, cards, section_markers, origin
                FROM quizzes
                WHERE id IN (${placeholders})
            `).all(...chunk) as Array<{
                id: string;
                file_id: string;
                cards: string;
                section_markers: string | null;
                origin: string | null;
            }>;

            for (const row of rows) {
                quizData.set(row.id, {
                    fileId: row.file_id,
                    cards: fromJson<QuizCard[]>(row.cards) || [],
                    sectionMarkers: fromJson<number[]>(row.section_markers) || [],
                    origin: fromJson<{ kind: "repo" | "project"; id: string; path: string }>(row.origin),
                });
            }
        }

        // 4. Get file data (source code) for LOC calculation
        const fileIds = [...new Set(Array.from(quizData.values()).map(q => q.fileId))];
        const fileData = new Map<string, {
            sourceCode: string;
            path: string;
            repoId: string;
            repoName: string;
            kind: "repo" | "project";
        }>();

        for (const chunk of chunkArray(fileIds, SQLITE_PARAM_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => "?").join(",");

            // Check repos table
            const repoRows = db.prepare(`
                SELECT id, source_code, path, repo_id, name
                FROM repos
                WHERE id IN (${placeholders})
            `).all(...chunk) as Array<{
                id: string;
                source_code: string;
                path: string;
                repo_id: string;
                name: string;
            }>;

            for (const row of repoRows) {
                fileData.set(row.id, {
                    sourceCode: row.source_code || "",
                    path: row.path,
                    repoId: row.repo_id,
                    repoName: row.name || row.repo_id,
                    kind: "repo",
                });
            }

            // Check files table for any not found in repos
            const missingIds = chunk.filter(id => !fileData.has(id));
            if (missingIds.length > 0) {
                const missingPlaceholders = missingIds.map(() => "?").join(",");
                const fileRows = db.prepare(`
                    SELECT id, source_code, path, project_id, project_name
                    FROM files
                    WHERE id IN (${missingPlaceholders})
                `).all(...missingIds) as Array<{
                    id: string;
                    source_code: string;
                    path: string;
                    project_id: string;
                    project_name: string;
                }>;

                for (const row of fileRows) {
                    fileData.set(row.id, {
                        sourceCode: row.source_code || "",
                        path: row.path,
                        repoId: row.project_id,
                        repoName: row.project_name || row.project_id,
                        kind: "project",
                    });
                }
            }
        }

        // 5. Check for first-time vs repeat: look for attempts before this date
        const segmentInfos: SegmentInfo[] = [];

        for (const [key, segment] of segmentMap.entries()) {
            const quiz = quizData.get(segment.quizId);
            if (!quiz) continue;

            const file = fileData.get(quiz.fileId);
            if (!file) continue;

            // Check if there were earlier attempts
            const earlierAttempt = db.prepare(`
                SELECT 1 FROM quiz_attempts
                WHERE user_id = ? AND quiz_id = ? AND section_index = ? AND attempted_at < ?
                LIMIT 1
            `).get(clerkUserId, segment.quizId, segment.sectionIndex, dayStart);

            const isFirstTime = !earlierAttempt;

            // Calculate LOC for this section
            const loc = calculateSectionLoc(
                quiz.cards,
                quiz.sectionMarkers,
                segment.sectionIndex,
                file.sourceCode
            );

            segmentInfos.push({
                quizId: segment.quizId,
                sectionIndex: segment.sectionIndex,
                loc,
                isFirstTime,
                isGold: segment.isGold,
                filePath: file.path,
                repoId: file.repoId,
                repoName: file.repoName,
                kind: file.kind,
            });
        }

        // 6. Build the response
        const summary = {
            totalLoc: 0,
            firstTimeLoc: 0,
            repeatLoc: 0,
            goldLoc: 0,
            totalSegments: 0,
            firstTimeSegments: 0,
            repeatSegments: 0,
            goldSegments: 0,
        };

        const byRepo: DailyReviewResponse["byRepo"] = {};

        for (const seg of segmentInfos) {
            // Update summary
            summary.totalLoc += seg.loc;
            summary.totalSegments++;

            if (seg.isFirstTime) {
                summary.firstTimeLoc += seg.loc;
                summary.firstTimeSegments++;
            } else {
                summary.repeatLoc += seg.loc;
                summary.repeatSegments++;
            }

            if (seg.isGold) {
                summary.goldLoc += seg.loc;
                summary.goldSegments++;
            }

            // Group by repo
            if (!byRepo[seg.repoId]) {
                byRepo[seg.repoId] = {
                    repoName: seg.repoName,
                    kind: seg.kind,
                    totalLoc: 0,
                    files: {},
                };
            }
            byRepo[seg.repoId].totalLoc += seg.loc;

            // Group by file within repo
            if (!byRepo[seg.repoId].files[seg.filePath]) {
                byRepo[seg.repoId].files[seg.filePath] = {
                    loc: 0,
                    segments: [],
                };
            }
            byRepo[seg.repoId].files[seg.filePath].loc += seg.loc;
            byRepo[seg.repoId].files[seg.filePath].segments.push({
                sectionIndex: seg.sectionIndex,
                loc: seg.loc,
                isFirstTime: seg.isFirstTime,
                isGold: seg.isGold,
            });
        }

        const response: DailyReviewResponse = {
            date: dateStr,
            summary,
            byRepo,
        };

        return NextResponse.json(response);
    } catch (error: any) {
        console.error("GET /api/daily-review error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
