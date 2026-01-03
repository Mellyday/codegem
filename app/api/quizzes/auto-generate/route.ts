export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";
import { getFileAtPath } from "../../../../src/server/browse";
import {
    parseWithTreeSitter,
    canParseWithTreeSitter,
} from "../../../../src/lib/parser/treeSitterServer";
import { getLanguageToolsForFileName } from "../../../../src/lib/languages/registry";

type QuizCard = {
    order: number;
    type: string;
    text: string;
    action: "next" | "dig";
    question?: string;
    generatorRule?: string;
    difficulty?: "easy" | "medium" | "hard";
    sourceRef?: any;
    questionType?: "single" | "multi" | "orderedMulti";
    multiCorrect?: string[];
    multiSelectHint?: number;
    optionPool?: string[];
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

        const db = await getDb();
        const quizzes = db.collection("quizzes");
        const filesCol = db.collection("files");
        const reposCol = db.collection("repos");

        // Convert id to ObjectId if possible
        let idAsObject: any = id;
        try {
            idAsObject = new ObjectId(String(id));
        } catch {
            idAsObject = id;
        }

        // Find the file document
        const match: any = { path };
        let col = filesCol as any;
        if (kind === "repo") {
            match.repoId = idAsObject;
            col = reposCol;
        } else {
            match.projectId = idAsObject;
        }

        // Try with ObjectId first, then raw string
        let fileDoc = await col.findOne(match, { projection: { _id: 1 } });
        if (!fileDoc && kind === "repo") {
            fileDoc = await col.findOne(
                { ...match, repoId: id },
                { projection: { _id: 1 } }
            );
        } else if (!fileDoc && kind === "project") {
            fileDoc = await col.findOne(
                { ...match, projectId: id },
                { projection: { _id: 1 } }
            );
        }

        if (!fileDoc) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const fileId = fileDoc._id;

        // Check if ANY quiz already exists for this file (any profile)
        const existingQuizCount = await quizzes.countDocuments({
            userId: clerkUserId,
            fileId,
        });

        // Check if a canonical quiz already exists
        const canonicalQuiz = await quizzes.findOne({
            userId: clerkUserId,
            fileId,
            isCanonical: true,
        });

        if (canonicalQuiz) {
            // Canonical quiz exists - return it
            return NextResponse.json({
                exists: true,
                quizId: String(canonicalQuiz._id),
            });
        }

        if (existingQuizCount > 0) {
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
        const now = new Date();
        const rootText = file.sourceCode.substring(root.startIndex, root.endIndex);
        const doc = {
            userId: clerkUserId,
            fileId,
            origin: { kind, id, path },
            name: "Heuristic shallow",
            type: "CustomQuizV1.1",
            profile: "shallow" as const,
            rootNode: {
                type: root.type,
                text: rootText.slice(0, 500), // Limit stored text
                start: root.startIndex,
                end: root.endIndex,
            },
            cards:
                quizPayload?.cards?.map((c: QuizCard, idx: number) => ({
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
                })) ?? [],
            isCanonical: true, // First quiz for this file becomes canonical
            createdAt: now,
        };

        const result = await quizzes.insertOne(doc);
        const quizId = String(result.insertedId);

        return NextResponse.json({
            quizId,
            totalCards: doc.cards.length,
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

        const db = await getDb();
        const quizzes = db.collection("quizzes");
        const filesCol = db.collection("files");
        const reposCol = db.collection("repos");

        // Convert id to ObjectId if possible
        let idAsObject: any = id;
        try {
            idAsObject = new ObjectId(String(id));
        } catch {
            idAsObject = id;
        }

        // Find the file document
        const match: any = { path };
        let col = filesCol as any;
        if (kind === "repo") {
            match.repoId = idAsObject;
            col = reposCol;
        } else {
            match.projectId = idAsObject;
        }

        let fileDoc = await col.findOne(match, { projection: { _id: 1 } });
        if (!fileDoc && kind === "repo") {
            fileDoc = await col.findOne(
                { ...match, repoId: id },
                { projection: { _id: 1 } }
            );
        } else if (!fileDoc && kind === "project") {
            fileDoc = await col.findOne(
                { ...match, projectId: id },
                { projection: { _id: 1 } }
            );
        }

        if (!fileDoc) {
            return NextResponse.json({ exists: false, supported });
        }

        const fileId = fileDoc._id;

        // Check if any quizzes exist for this file
        const quizCount = await quizzes.countDocuments({
            userId: clerkUserId,
            fileId,
        });

        if (quizCount === 0) {
            return NextResponse.json({ exists: false, supported });
        }

        // Find the canonical quiz (any profile)
        const quiz = await quizzes.findOne({
            userId: clerkUserId,
            fileId,
            isCanonical: true,
        });

        if (!quiz) {
            // Quizzes exist but no canonical - signal to hide icon
            return NextResponse.json({
                exists: true,
                needsCanonical: true,
                supported,
            });
        }

        // Calculate distractor status for the canonical quiz
        const cards = (quiz.cards || []) as QuizCard[];
        let withDistractors = 0;
        let total = 0;

        for (const card of cards) {
            if (card.action === "dig") continue;
            total++;
            const isMulti =
                card.questionType === "multi" || card.questionType === "orderedMulti";
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
            quizId: String(quiz._id),
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
