export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, fromJson } from "../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";

type MedalType = "bronze" | "silver" | "gold" | null;

// SQLite parameter limit - use chunks smaller than 999
const SQLITE_PARAM_CHUNK_SIZE = 500;

// Helper to chunk arrays for SQLite IN queries (issue #6 fix)
function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// Calculate star level based on time since last attempt
function calculateStars(
    attempts: Array<{ attemptedAt: Date; medalEarned: MedalType }>,
    medalType: "bronze" | "silver" | "gold"
): 1 | 2 | 3 {
    const medalRank = { bronze: 1, silver: 2, gold: 3 };
    const relevantAttempts = attempts.filter((a) => {
        if (!a.medalEarned) return false;
        return medalRank[a.medalEarned] >= medalRank[medalType];
    });

    if (relevantAttempts.length === 0) return 1;

    const allAttemptsSorted = [...attempts].sort(
        (a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime()
    );
    const lastAttempt = allAttemptsSorted[allAttemptsSorted.length - 1];
    const now = new Date();

    let currentStars: 1 | 2 | 3 = 1;

    const TWO_STAR_COOLDOWN = 48 * 60 * 60 * 1000;
    const timeSinceLastAttempt = now.getTime() - lastAttempt.attemptedAt.getTime();

    if (timeSinceLastAttempt >= TWO_STAR_COOLDOWN) {
        currentStars = 2;
    }

    const THREE_STAR_COOLDOWN = 5 * 24 * 60 * 60 * 1000;
    if (currentStars === 2 && timeSinceLastAttempt >= THREE_STAR_COOLDOWN) {
        currentStars = 3;
    }

    return currentStars;
}

type FileStats = {
    isFresh: boolean;
    totalSections: number;
    goldCount: number;
    gold3StarCount: number;
};

type FolderStats = {
    totalFiles: number;
    filesDone: number;
    totalSections: number;
    goldCount: number;
    gold3StarCount: number;
};

/**
 * GET /api/file-stats?kind=repo&id=xxx&prefix=yyy
 *
 * Returns stats for all files and folders at a given path level
 */
export async function GET(request: Request) {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const kind = url.searchParams.get("kind") as "repo" | "project" | null;
        const id = url.searchParams.get("id");
        const prefix = url.searchParams.get("prefix") || "";

        if (!kind || !id) {
            return NextResponse.json(
                { error: "Missing kind or id" },
                { status: 400 }
            );
        }

        const db = getDb();

        // Fetch all files under this path
        const pathPrefix = prefix ? `${prefix}/` : "";
        let allFiles: Array<{ id: string; path: string }>;

        if (kind === "repo") {
            if (prefix) {
                allFiles = db.prepare(`
                    SELECT id, path FROM repos WHERE repo_id = ? AND path LIKE ?
                `).all(id, `${pathPrefix}%`) as typeof allFiles;
            } else {
                allFiles = db.prepare(`
                    SELECT id, path FROM repos WHERE repo_id = ?
                `).all(id) as typeof allFiles;
            }
        } else {
            if (prefix) {
                allFiles = db.prepare(`
                    SELECT id, path FROM files WHERE project_id = ? AND path LIKE ?
                `).all(id, `${pathPrefix}%`) as typeof allFiles;
            } else {
                allFiles = db.prepare(`
                    SELECT id, path FROM files WHERE project_id = ?
                `).all(id) as typeof allFiles;
            }
        }

        // Get file IDs
        const fileIdToPath = new Map<string, string>();
        for (const f of allFiles) {
            fileIdToPath.set(f.id, f.path);
        }
        const fileIds = Array.from(fileIdToPath.keys());

        if (fileIds.length === 0) {
            return NextResponse.json({ files: {}, folders: {} });
        }

        // Issue #6 fix: Chunk file IDs to avoid SQLite parameter limit
        const fileIdChunks = chunkArray(fileIds, SQLITE_PARAM_CHUNK_SIZE);

        // Find all canonical quizzes for these files (chunked)
        const canonicalQuizzes: Array<{
            id: string;
            file_id: string;
            section_markers: string | null;
        }> = [];

        for (const chunk of fileIdChunks) {
            const placeholders = chunk.map(() => '?').join(',');
            const chunkResults = db.prepare(`
                SELECT id, file_id, section_markers
                FROM quizzes
                WHERE user_id = ? AND file_id IN (${placeholders}) AND is_canonical = 1
            `).all(clerkUserId, ...chunk) as typeof canonicalQuizzes;
            canonicalQuizzes.push(...chunkResults);
        }

        // Build fileId -> quiz mapping
        const fileIdToQuiz = new Map<string, { id: string; sectionMarkers: number[] }>();
        const quizIds: string[] = [];
        for (const quiz of canonicalQuizzes) {
            const fid = quiz.file_id;
            fileIdToQuiz.set(fid, {
                id: quiz.id,
                sectionMarkers: fromJson<number[]>(quiz.section_markers) || [],
            });
            quizIds.push(quiz.id);
        }

        // Issue #6 fix: Chunk quiz IDs for attempts query
        let allAttempts: Array<{
            quiz_id: string;
            section_index: number;
            attempted_at: string;
            medal_earned: string | null;
        }> = [];

        if (quizIds.length > 0) {
            const quizIdChunks = chunkArray(quizIds, SQLITE_PARAM_CHUNK_SIZE);
            for (const chunk of quizIdChunks) {
                const placeholders = chunk.map(() => '?').join(',');
                const chunkResults = db.prepare(`
                    SELECT quiz_id, section_index, attempted_at, medal_earned
                    FROM quiz_attempts
                    WHERE user_id = ? AND quiz_id IN (${placeholders})
                `).all(clerkUserId, ...chunk) as typeof allAttempts;
                allAttempts.push(...chunkResults);
            }
        }

        // Group attempts by quizId and sectionIndex
        type AttemptInfo = { attemptedAt: Date; medalEarned: MedalType };
        const attemptsByQuizSection = new Map<string, Map<number, AttemptInfo[]>>();
        for (const a of allAttempts) {
            const qid = a.quiz_id;
            if (!attemptsByQuizSection.has(qid)) {
                attemptsByQuizSection.set(qid, new Map());
            }
            const sectionMap = attemptsByQuizSection.get(qid)!;
            const sectionIndex = a.section_index ?? 0;
            if (!sectionMap.has(sectionIndex)) {
                sectionMap.set(sectionIndex, []);
            }
            sectionMap.get(sectionIndex)!.push({
                attemptedAt: new Date(a.attempted_at),
                medalEarned: a.medal_earned as MedalType,
            });
        }

        // Calculate stats per file
        const fileStats: Record<string, FileStats> = {};
        const folderStats: Record<string, FolderStats> = {};

        // Normalize prefix for comparison
        const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");

        for (const [fileId, path] of fileIdToPath.entries()) {
            // Determine relative path from prefix
            const relativePath = normalizedPrefix
                ? path.startsWith(normalizedPrefix + "/")
                    ? path.slice(normalizedPrefix.length + 1)
                    : path === normalizedPrefix
                        ? ""
                        : null
                : path;

            if (relativePath === null) continue;

            const parts = relativePath.split("/").filter((p) => p.length > 0);
            if (parts.length === 0) continue;

            const quiz = fileIdToQuiz.get(fileId);
            if (!quiz) continue; // No canonical quiz for this file

            // Calculate section count
            const sectionMarkers = quiz.sectionMarkers || [];
            const sectionCount = sectionMarkers.length > 0 ? sectionMarkers.length + 1 : 1;

            // Get attempts for this quiz
            const quizId = quiz.id;
            const sectionAttempts = attemptsByQuizSection.get(quizId) || new Map();

            // Calculate medal stats
            let hasAnyAttempt = false;
            let goldCount = 0;
            let gold3StarCount = 0;

            for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
                const sectionAttemptsList: AttemptInfo[] = sectionAttempts.get(sectionIndex) || [];
                if (sectionAttemptsList.length > 0) {
                    hasAnyAttempt = true;
                    // Check if any attempt earned gold
                    const hasGold = sectionAttemptsList.some((a) => a.medalEarned === "gold");
                    if (hasGold) {
                        goldCount++;
                        const stars = calculateStars(sectionAttemptsList, "gold");
                        if (stars === 3) {
                            gold3StarCount++;
                        }
                    }
                }
            }

            // Determine if this is a direct child file or in a subfolder
            const isDirectChild = parts.length === 1;

            if (isDirectChild) {
                // Direct file at this level
                fileStats[path] = {
                    isFresh: !hasAnyAttempt,
                    totalSections: sectionCount,
                    goldCount,
                    gold3StarCount,
                };
            }

            // Aggregate into folder stats
            const folderName = parts[0];
            if (parts.length > 1 || !isDirectChild) {
                // This file is inside a folder
                if (!folderStats[folderName]) {
                    folderStats[folderName] = {
                        totalFiles: 0,
                        filesDone: 0,
                        totalSections: 0,
                        goldCount: 0,
                        gold3StarCount: 0,
                    };
                }
                const folder = folderStats[folderName];
                folder.totalFiles++;
                if (hasAnyAttempt) folder.filesDone++;
                folder.totalSections += sectionCount;
                folder.goldCount += goldCount;
                folder.gold3StarCount += gold3StarCount;
            }
        }

        return NextResponse.json({ files: fileStats, folders: folderStats });
    } catch (error: any) {
        console.error("GET /api/file-stats error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
