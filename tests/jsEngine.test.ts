import { describe, it, expect } from "vitest";
import { parseWithTreeSitter } from "../src/lib/parser/treeSitterServer";
import { generateEngineSteps } from "../src/lib/languages/javascript/jsEngine";

describe("shallow profile quiz generation", () => {
    it("preserves useEffect call question with header span", async () => {
        const code = [
            "useEffect(() => {",
            '  const container = document.querySelector("#chart");',
            "  const chart = createChart(container);",
            "  chart.timeScale().fitContent();",
            "});",
        ].join("\n");

        const { ast } = await parseWithTreeSitter(code, "js");
        const steps = generateEngineSteps(ast, ast, code, {
            profile: "shallow",
            generateQuiz: true,
        });

        // Collect all questions from the step tree
        const questions: any[] = [];
        const collect = (step: any) => {
            if (step.quiz?.questions?.length) {
                questions.push(...step.quiz.questions);
            }
            const children = step.lesson?.childSteps || [];
            for (const child of children) collect(child);
        };
        steps.forEach(collect);

        // Find the useEffect call question
        const useEffectQuestion = questions.find(
            (q) => q.generatorRule === "call.full" && q.answerLabel === "useEffect"
        );

        expect(useEffectQuestion).toBeDefined();

        // Verify the span ends before the arguments
        const useEffectStart = code.indexOf("useEffect");
        const argsStart = code.indexOf("(", useEffectStart);
        expect(argsStart).toBeGreaterThan(useEffectStart);

        const revealEnd =
            useEffectQuestion.revealEndAfterChild ??
            useEffectQuestion.revealEndBeforeChild ??
            useEffectQuestion.sourceRefs?.[0]?.end;

        expect(revealEnd).toBeTypeOf("number");
        expect(revealEnd).toBeLessThanOrEqual(argsStart);
    });
});
