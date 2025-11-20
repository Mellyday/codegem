
import { generateEngineSteps, EngineStep } from "./src/lib/pyEngine";

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
                        { type: "integer", startIndex: 8, endIndex: 9, text: "2" }
                    ]
                }
            ]
        }
    ]
};

const code = "x = 1 + 2";

console.log("Running pyEngine verification...");

try {
    const steps = generateEngineSteps(mockRoot, mockRoot, code, {
        profile: "deep",
        grouping: false
    });

    console.log(`Generated ${steps.length} steps.`);

    steps.forEach((step, i) => {
        console.log(`Step ${i}: type=${step.node.type}, role=${step.lesson?.semanticRole}`);
        if (step.quiz) {
            console.log(`  Has ${step.quiz.questions.length} quiz questions.`);
            step.quiz.questions.forEach(q => {
                console.log(`    - ${q.stem} [${q.kind}]`);
            });
        }
    });

    if (steps.length > 0 && steps[0].quiz && steps[0].quiz.questions.length > 0) {
        const q = steps[0].quiz.questions[0];
        if (q.kind === "shallow_ident" || q.kind === "deep_drill") {
            console.log(`SUCCESS: Generated ${q.kind} question.`);
        } else {
            console.log(`FAILURE: Unexpected question kind: ${q.kind}`);
        }
    } else {
        console.log("FAILURE: No quiz questions generated.");
    }

} catch (e) {
    console.error("Error running engine:", e);
}
