export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb } from "../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";

type MedalType = "bronze" | "silver" | "gold" | null;

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

function coerceId(id: string): any {
    try {
        return new ObjectId(id);
    } catch {
        return id as any;
    }
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

        const db = await getDb();
        const quizzes = db.collection("quizzes");
        const attempts = db.collection("quiz_attempts");
        const filesCol = db.collection("files");
        const reposCol = db.collection("repos");

        const idAsObject = coerceId(id);

        // Build match for files
        const fileMatch: any = {};
        let col = filesCol as any;
        if (kind === "repo") {
            fileMatch.repoId = idAsObject;
            col = reposCol;
        } else {
            fileMatch.projectId = idAsObject;
        }

        // Fetch all files under this path (including subdirectories)
        const pathPrefix = prefix ? `${prefix}/` : "";
        const fileQuery = prefix
            ? { ...fileMatch, path: { $regex: `^${pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } }
            : fileMatch;

        // Also include files at the exact prefix level
        const or: any[] = [fileQuery];
        if (!prefix) {
            // At root, get all files
        }

        const allFiles = await col
            .find(fileQuery, { projection: { _id: 1, path: 1 } })
            .toArray();

        // Get file IDs
        const fileIdToPath = new Map<string, string>();
        for (const f of allFiles) {
            fileIdToPath.set(String(f._id), f.path);
        }
        const fileIds = Array.from(fileIdToPath.keys()).map((id) => {
            try {
                return new ObjectId(id);
            } catch {
                return id;
            }
        });

        if (fileIds.length === 0) {
            return NextResponse.json({ files: {}, folders: {} });
        }

        // Find all canonical quizzes for these files
        const canonicalQuizzes = await quizzes
            .find({
                userId: clerkUserId,
                fileId: { $in: fileIds },
                isCanonical: true,
            })
            .toArray();

        // Build fileId -> quiz mapping
        const fileIdToQuiz = new Map<string, any>();
        const quizIds: string[] = [];
        for (const quiz of canonicalQuizzes) {
            const fid = String(quiz.fileId);
            fileIdToQuiz.set(fid, quiz);
            quizIds.push(String(quiz._id));
        }

        // Fetch all attempts for these quizzes
        const allAttempts = await attempts
            .find({
                userId: clerkUserId,
                quizId: { $in: quizIds },
            })
            .toArray();

        // Group attempts by quizId and sectionIndex
        type AttemptInfo = { attemptedAt: Date; medalEarned: MedalType };
        const attemptsByQuizSection = new Map<string, Map<number, AttemptInfo[]>>();
        for (const a of allAttempts) {
            const qid = String(a.quizId);
            if (!attemptsByQuizSection.has(qid)) {
                attemptsByQuizSection.set(qid, new Map());
            }
            const sectionMap = attemptsByQuizSection.get(qid)!;
            const sectionIndex = a.sectionIndex ?? 0;
            if (!sectionMap.has(sectionIndex)) {
                sectionMap.set(sectionIndex, []);
            }
            sectionMap.get(sectionIndex)!.push({
                attemptedAt: new Date(a.attemptedAt),
                medalEarned: a.medalEarned as MedalType,
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
            const quizId = String(quiz._id);
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
