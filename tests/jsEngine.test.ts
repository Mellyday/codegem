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

describe("jsx quiz generation", () => {
    it("anchors jsx.children questions after the opening tag", async () => {
        const code = [
            "function X({ children, height, PERIOD_BUTTONS, LIVE_INTERVAL_BUTTONS, chartContainerRef, liveInterval }) {",
            "  return (",
            "    <div id=\"candlestick-chart\">",
            "      <div className=\"chart-header\">",
            "        <div className=\"flex-1\">{children}</div>",
            "        <div className=\"button-group\">",
            "          <span>Period:</span>",
            "          {PERIOD_BUTTONS.map(({ value, label }) => (",
            "            <button key={value}>{label}</button>",
            "          ))}",
            "        </div>",
            "        {liveInterval && (",
            "          <div className=\"button-group\">",
            "            <span>Update Frequency:</span>",
            "            {LIVE_INTERVAL_BUTTONS.map(({ value, label }) => (",
            "              <button key={value}>{label}</button>",
            "            ))}",
            "          </div>",
            "        )}",
            "      </div>",
            "",
            "      <div ref={chartContainerRef} className=\"chart\" style={{ height }} />",
            "    </div>",
            "  );",
            "}",
        ].join("\n");

        const { ast } = await parseWithTreeSitter(code, "tsx");
        const steps = generateEngineSteps(ast, ast, code, {
            profile: "deep",
            generateQuiz: true,
        });

        const questions: any[] = [];
        const collect = (step: any) => {
            if (step.quiz?.questions?.length) questions.push(...step.quiz.questions);
            for (const child of step.lesson?.childSteps || []) collect(child);
        };
        steps.forEach(collect);

        const childQs = questions.filter((q) => q.generatorRule === "jsx.children");
        expect(childQs.length).toBeGreaterThanOrEqual(2);

        const chartHeaderChildQ = childQs.find((q) =>
            (q.sourceRefs?.[0]?.preview || "").includes("chart-header")
        );
        expect(chartHeaderChildQ).toBeDefined();

        const revealEnd = chartHeaderChildQ.revealEndBeforeChild ?? chartHeaderChildQ.sourceRefs?.[0]?.end;
        expect(revealEnd).toBeTypeOf("number");
        // Ensure the opening tag is visible: we should have revealed past the attribute text.
        expect(revealEnd).toBeGreaterThan(code.indexOf("chart-header"));
    });
});
