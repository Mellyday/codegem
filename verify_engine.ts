import fs from "fs";
import path from "path";
import {
    generateEngineSteps,
    type EngineStep,
    type QuizQuestion,
} from "./src/lib/pyEngine";
import { parseWithTreeSitter } from "./src/lib/parser/treeSitterServer";

// Mock AST Node
const mockRoot: any = {
    type: "module",
    startIndex: 0,
    endIndex: 5,
    namedChildren: [
        {
            type: "assignment",
            startIndex: 0,
            endIndex: 5,
            namedChildren: [
                { type: "identifier", startIndex: 0, endIndex: 1, text: "x" },
                {
                    type: "binary_operator",
                    startIndex: 4,
                    endIndex: 9,
                    text: "1 + 2",
                    namedChildren: [
                        { type: "integer", startIndex: 4, endIndex: 5, text: "1" },
                        { type: "integer", startIndex: 8, endIndex: 9, text: "2" },
                    ],
                },
            ],
        },
    ],
};

const code = "x = 1 + 2";

type QuestionSpan = { span: { start: number; end: number }; question: QuizQuestion };

const collectQuestions = (steps: EngineStep[]): QuizQuestion[] => {
    const out: QuizQuestion[] = [];
    const visit = (step: EngineStep) => {
        if (step.quiz?.questions?.length) {
            out.push(...step.quiz.questions);
        }
        const children = step.lesson?.childSteps || [];
        if (children.length) children.forEach(visit);
    };
    steps.forEach(visit);
    return out;
};

const spanForQuestion = (
    q: QuizQuestion
): { start: number; end: number } | undefined => {
    if (
        typeof q.revealEndBeforeChild === "number" &&
        typeof q.revealEndAfterChild === "number" &&
        Number.isFinite(q.revealEndBeforeChild) &&
        Number.isFinite(q.revealEndAfterChild) &&
        q.revealEndAfterChild >= q.revealEndBeforeChild
    ) {
        return {
            start: q.revealEndBeforeChild,
            end: q.revealEndAfterChild,
        };
    }
    if (Array.isArray(q.sourceRefs) && q.sourceRefs.length > 0) {
        let best = q.sourceRefs[0];
        for (const ref of q.sourceRefs) {
            if (ref.end - ref.start < best.end - best.start) best = ref;
        }
        return { start: best.start, end: best.end };
    }
    return undefined;
};

const findContainedSpan = (
    entries: QuestionSpan[]
): { outer: QuestionSpan; inner: QuestionSpan } | undefined => {
    for (let i = 0; i < entries.length; i++) {
        for (let j = 0; j < entries.length; j++) {
            if (i === j) continue;
            const outer = entries[i];
            const inner = entries[j];
            const contains =
                outer.span.start <= inner.span.start &&
                outer.span.end >= inner.span.end &&
                (outer.span.start < inner.span.start || outer.span.end > inner.span.end);
            if (contains) {
                return { outer, inner };
            }
        }
    }
    return undefined;
};

const runSearchMatrixQuizSpanTest = async () => {
    const filePath = path.join(process.cwd(), "code_sandbox", "twod_matrix.py");
    const source = fs.readFileSync(filePath, "utf8");
    const parsed = await parseWithTreeSitter(source, "py");
    const steps = generateEngineSteps(parsed.ast, parsed.ast, source, {
        profile: "deep",
        grouping: false,
    });

    const entries = collectQuestions(steps)
        .map((q) => {
            const span = spanForQuestion(q);
            return span ? { question: q, span } : undefined;
        })
        .filter(
            (entry): entry is QuestionSpan => Boolean(entry)
        );

    const contained = findContainedSpan(entries);
    if (contained) {
        console.log(
            `FAILURE: Quiz span ${contained.outer.span.start}-${contained.outer.span.end} contains ${contained.inner.span.start}-${contained.inner.span.end}.`
        );
        console.log(
            `  Outer: ${contained.outer.question.stem} [${contained.outer.question.generatorRule}]`
        );
        console.log(
            `  Inner: ${contained.inner.question.stem} [${contained.inner.question.generatorRule}]`
        );
        process.exitCode = 1;
        return;
    }
    console.log("SUCCESS: No quiz answer spans contain other quiz answer spans.");
};

const run = async () => {
    console.log("Running pyEngine verification...");

    try {
        const steps = generateEngineSteps(mockRoot, mockRoot, code, {
            profile: "deep",
            grouping: false,
        });

        console.log(`Generated ${steps.length} steps.`);

        steps.forEach((step, i) => {
            console.log(
                `Step ${i}: type=${step.node.type}, role=${step.lesson?.semanticRole}`
            );
            if (step.quiz) {
                console.log(`  Has ${step.quiz.questions.length} quiz questions.`);
                step.quiz.questions.forEach((q) => {
                    console.log(`    - ${q.stem} [${q.kind}]`);
                });
            }
        });

        const types = steps.map((s) => s.node.type);
        const unexpected = types.filter((t) => t !== "assignment");
        if (steps.length !== 1 || unexpected.length > 0) {
            console.log(
                `FAILURE: Expected only 1 assignment step, got: ${types.join(", ")}`
            );
            process.exitCode = 1;
        } else {
            console.log("SUCCESS: Anchor-only steps (assignment only; no subexpression steps).");
        }

        const first = steps[0];
        if (first?.quiz?.questions?.length) {
            console.log(
                `SUCCESS: Assignment has ${first.quiz.questions.length} quiz question(s).`
            );
        } else {
            console.log("FAILURE: No quiz questions generated for assignment.");
            process.exitCode = 1;
        }
    } catch (e) {
        console.error("Error running engine:", e);
        process.exitCode = 1;
    }

    console.log("Running quiz span regression (searchMatrix)...");
    try {
        await runSearchMatrixQuizSpanTest();
    } catch (e) {
        console.error("Error running quiz span regression:", e);
        process.exitCode = 1;
    }
};

run().catch((e) => {
    console.error("Error running verification:", e);
    process.exitCode = 1;
});
