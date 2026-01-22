export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, generateId, toDbDate, toJson, fromJson } from "../../../../src/lib/sqlite";
import { auth } from "@clerk/nextjs/server";
import { getFileAtPath } from "../../../../src/server/browse";
import {
    parseWithTreeSitter,
    canParseWithTreeSitter,
} from "../../../../src/lib/parser/treeSitterServer";
import { getLanguageToolsForFileName } from "../../../../src/lib/languages/registry";

const DEV_USER_ID = "dev-push-project";

type QuizCard = {
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    question?: string;
    generatorRule?: string;
    difficulty?: "easy" | "medium" | "hard";
    sourceRef?: any;
    questionType?: "single" | "multi" | "orderedMulti" | "sequence" | "mapping";
    multiCorrect?: string[];
    multiSelectHint?: number;
    optionPool?: string[];
    pairs?: Array<{ key: string; value: string }>;
    matchlessKeys?: string[];
    keyDistractors?: string[];
    valueDistractors?: string[];
    llmDistractors?: string[];
    revealStart?: number;
    revealEndBeforeChild?: number;
    revealEndAfterChild?: number;
};

/**
 * POST /api/quizzes/auto-generate
 *
 * Automatically generate a shallow quiz for a file.
 * Body: { kind: "repo" | "project", id: string, path: string }
 *
 * Returns: { quizId: string } or { exists: true, quizId: string } if quiz already exists
 */
export async function POST(request: Request) {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { kind, id, path } = body as {
            kind: "repo" | "project";
            id: string;
            path: string;
        };

        if (!kind || !id || !path) {
            return NextResponse.json(
                { error: "Missing kind, id, or path" },
                { status: 400 }
            );
        }

        // Check file extension is supported
        const ext = path.split(".").pop()?.toLowerCase() || "";
        if (!canParseWithTreeSitter(ext)) {
            return NextResponse.json(
                { error: `File type .${ext} is not supported` },
                { status: 400 }
            );
        }

        const db = getDb();


        // Find the file document - user-first, DEV-fallback
        let fileDoc: { id: string } | undefined;
        if (kind === "repo") {
            // User-first
            fileDoc = db.prepare(`
                SELECT id FROM repos WHERE repo_id = ? AND path = ? AND user_id = ? LIMIT 1
            `).get(id, path, clerkUserId) as typeof fileDoc;

            // DEV-fallback
            if (!fileDoc) {
                fileDoc = db.prepare(`
                    SELECT id FROM repos WHERE repo_id = ? AND path = ? AND user_id = ? LIMIT 1
                `).get(id, path, DEV_USER_ID) as typeof fileDoc;
            }
        } else {
            // User-first
            fileDoc = db.prepare(`
                SELECT id FROM files WHERE project_id = ? AND path = ? AND user_id = ? LIMIT 1
            `).get(id, path, clerkUserId) as typeof fileDoc;

            // DEV-fallback
            if (!fileDoc) {
                fileDoc = db.prepare(`
                    SELECT id FROM files WHERE project_id = ? AND path = ? AND user_id = ? LIMIT 1
                `).get(id, path, DEV_USER_ID) as typeof fileDoc;
            }
        }

        if (!fileDoc) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const fileId = fileDoc.id;

        // Check if ANY quiz already exists for this file (any profile)
        const existingQuizCount = db.prepare(`
            SELECT COUNT(*) as count FROM quizzes WHERE user_id = ? AND file_id = ?
        `).get(clerkUserId, fileId) as { count: number };

        // Check if a canonical quiz already exists
        const canonicalQuiz = db.prepare(`
            SELECT id FROM quizzes WHERE user_id = ? AND file_id = ? AND is_canonical = 1 LIMIT 1
        `).get(clerkUserId, fileId) as { id: string } | undefined;

        if (canonicalQuiz) {
            // Canonical quiz exists - return it
            return NextResponse.json({
                exists: true,
                quizId: canonicalQuiz.id,
            });
        }

        if (existingQuizCount.count > 0) {
            // Quizzes exist but no canonical - signal to client
            return NextResponse.json({
                exists: true,
                needsCanonical: true,
            });
        }

        // Fetch file content
        const file = await getFileAtPath({ kind, id, path });
        if (!file) {
            return NextResponse.json(
                { error: "Could not fetch file content" },
                { status: 404 }
            );
        }

        // Parse AST
        const parseResult = await parseWithTreeSitter(file.sourceCode, ext);
        const root = parseResult.ast;

        // Get language tools and generate quiz payload
        const languageTools = getLanguageToolsForFileName(path);
        const { engine } = languageTools;

        // Generate shallow quiz steps
        const steps = engine.generateEngineSteps(root, root, file.sourceCode, {
            profile: "shallow",
            includeNames: false,
            generateQuiz: true,
        }) as any[];

        // Build quiz payload using the engine
        const quizPayload = engine.buildCustomQuizPayload({
            fileKey: { kind, id, path },
            root,
            code: file.sourceCode,
            history: [],
            lessonQueue: steps,
            currentStep: 0,
        }) as any;

        // Prepare document for insertion
        const now = toDbDate(new Date());
        const rootText = file.sourceCode.substring(root.startIndex, root.endIndex);
        const quizId = generateId();

        const cards = quizPayload?.cards?.map((c: QuizCard, idx: number) => ({
            order: c.order ?? idx,
            type: c.type,
            text: String(c.text ?? ""),
            action: c.action || "next",
            ...(c.question ? { question: c.question } : {}),
            ...(c.generatorRule ? { generatorRule: c.generatorRule } : {}),
            ...(c.difficulty ? { difficulty: c.difficulty } : {}),
            ...(c.sourceRef ? { sourceRef: c.sourceRef } : {}),
            ...(c.questionType ? { questionType: c.questionType } : {}),
            ...(Array.isArray(c.multiCorrect) ? { multiCorrect: c.multiCorrect } : {}),
            ...(typeof c.multiSelectHint === "number"
                ? { multiSelectHint: c.multiSelectHint }
                : {}),
            ...(Array.isArray(c.optionPool) ? { optionPool: c.optionPool } : {}),
            ...(Array.isArray(c.pairs) ? { pairs: c.pairs } : {}),
            ...(Array.isArray(c.matchlessKeys) ? { matchlessKeys: c.matchlessKeys } : {}),
            ...(Array.isArray(c.keyDistractors) ? { keyDistractors: c.keyDistractors } : {}),
            ...(Array.isArray(c.valueDistractors) ? { valueDistractors: c.valueDistractors } : {}),
            ...(Array.isArray(c.llmDistractors)
                ? { llmDistractors: c.llmDistractors }
                : {}),
            ...(typeof c.revealStart === "number"
                ? { revealStart: c.revealStart }
                : {}),
            ...(typeof c.revealEndBeforeChild === "number"
                ? { revealEndBeforeChild: c.revealEndBeforeChild }
                : {}),
            ...(typeof c.revealEndAfterChild === "number"
                ? { revealEndAfterChild: c.revealEndAfterChild }
                : {}),
        })) ?? [];

        db.prepare(`
            INSERT INTO quizzes (
                id, user_id, file_id, origin, name, type, root_node, profile,
                is_canonical, cards, section_markers, section_names, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            quizId,
            clerkUserId,
            fileId,
            toJson({ kind, id, path }),
            "Heuristic shallow",
            "CustomQuizV1.1",
            toJson({
                type: root.type,
                text: rootText.slice(0, 500),
                start: root.startIndex,
                end: root.endIndex,
            }),
            "shallow",
            1, // isCanonical = true
            toJson(cards),
            null,
            null,
            now
        );

        return NextResponse.json({
            quizId,
            totalCards: cards.length,
        });
    } catch (error: any) {
        console.error("POST /api/quizzes/auto-generate error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

/**
 * GET /api/quizzes/auto-generate?kind=repo&id=xxx&path=yyy
 *
 * Check if a shallow quiz exists for a file and its distractor status.
 * Returns: { exists: boolean, quizId?: string, distractorStatus?: "complete" | "partial" | "none" }
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
        const path = url.searchParams.get("path");

        if (!kind || !id || !path) {
            return NextResponse.json(
                { error: "Missing kind, id, or path" },
                { status: 400 }
            );
        }

        // Check if file type is supported
        const ext = path.split(".").pop()?.toLowerCase() || "";
        const supported = canParseWithTreeSitter(ext);

        const db = getDb();


        // Find the file document - user-first, DEV-fallback
        let fileDoc: { id: string } | undefined;
        if (kind === "repo") {
            // User-first
            fileDoc = db.prepare(`
                SELECT id FROM repos WHERE repo_id = ? AND path = ? AND user_id = ? LIMIT 1
            `).get(id, path, clerkUserId) as typeof fileDoc;

            // DEV-fallback
            if (!fileDoc) {
                fileDoc = db.prepare(`
                    SELECT id FROM repos WHERE repo_id = ? AND path = ? AND user_id = ? LIMIT 1
                `).get(id, path, DEV_USER_ID) as typeof fileDoc;
            }
        } else {
            // User-first
            fileDoc = db.prepare(`
                SELECT id FROM files WHERE project_id = ? AND path = ? AND user_id = ? LIMIT 1
            `).get(id, path, clerkUserId) as typeof fileDoc;

            // DEV-fallback
            if (!fileDoc) {
                fileDoc = db.prepare(`
                    SELECT id FROM files WHERE project_id = ? AND path = ? AND user_id = ? LIMIT 1
                `).get(id, path, DEV_USER_ID) as typeof fileDoc;
            }
        }

        if (!fileDoc) {
            return NextResponse.json({ exists: false, supported });
        }

        const fileId = fileDoc.id;

        // Check if any quizzes exist for this file
        const quizCount = db.prepare(`
            SELECT COUNT(*) as count FROM quizzes WHERE user_id = ? AND file_id = ?
        `).get(clerkUserId, fileId) as { count: number };

        if (quizCount.count === 0) {
            return NextResponse.json({ exists: false, supported });
        }

        // Find the canonical quiz (any profile)
        const quiz = db.prepare(`
            SELECT id, cards, profile FROM quizzes
            WHERE user_id = ? AND file_id = ? AND is_canonical = 1
            LIMIT 1
        `).get(clerkUserId, fileId) as { id: string; cards: string; profile: string } | undefined;

        if (!quiz) {
            // Quizzes exist but no canonical - signal to hide icon
            return NextResponse.json({
                exists: true,
                needsCanonical: true,
                supported,
            });
        }

        // Calculate distractor status for the canonical quiz
        const cards = fromJson<QuizCard[]>(quiz.cards) || [];
        let withDistractors = 0;
        let total = 0;

        for (const card of cards) {
            if (card.action === "dig") continue;
            if (card.questionType === "mapping") continue;
            total++;
            const isMulti =
                card.questionType === "multi" ||
                card.questionType === "orderedMulti" ||
                card.questionType === "sequence";
            const targetCount = isMulti ? 10 : 6;
            if (
                Array.isArray(card.llmDistractors) &&
                card.llmDistractors.length >= targetCount
            ) {
                withDistractors++;
            }
        }

        let distractorStatus: "complete" | "partial" | "none";
        if (total === 0) {
            distractorStatus = "complete";
        } else if (withDistractors === total) {
            distractorStatus = "complete";
        } else if (withDistractors > 0) {
            distractorStatus = "partial";
        } else {
            distractorStatus = "none";
        }

        return NextResponse.json({
            exists: true,
            quizId: quiz.id,
            profile: quiz.profile,
            totalCards: total,
            distractorStatus,
            cardsWithDistractors: withDistractors,
            supported,
        });
    } catch (error: any) {
        console.error("GET /api/quizzes/auto-generate error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
