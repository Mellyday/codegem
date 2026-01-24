import { describe, it, expect } from "vitest";
import { parseWithTreeSitter } from "../src/lib/parser/treeSitterServer";
import { generateEngineSteps } from "../src/lib/languages/javascript/jsEngine";
import { revealAfterForQuestion } from "../src/components/QuizViewer";

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

        // Use the same reveal logic as the UI
        const revealEnd = revealAfterForQuestion(useEffectQuestion);

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
        expect(chartHeaderChildQ.questionType).toBe("sequence");
        expect(chartHeaderChildQ.multiCorrect).toEqual(["div", "div", "EXPR(div?)"]);

        const buttonGroupChildQ = childQs.find((q) =>
            (q.sourceRefs?.[0]?.preview || "").includes("button-group")
        );
        expect(buttonGroupChildQ).toBeDefined();
        expect(buttonGroupChildQ.questionType).toBe("sequence");
        expect(buttonGroupChildQ.multiCorrect).toEqual(["span", "EXPR(button*)"]);

        // Use the same reveal logic as the UI
        const revealEnd = revealAfterForQuestion(chartHeaderChildQ);
        expect(revealEnd).toBeTypeOf("number");
        // Ensure the opening tag is visible: we should have revealed past the attribute text.
        expect(revealEnd).toBeGreaterThan(code.indexOf("chart-header"));
    });

    it("treats all className tokens as correct for className token questions", async () => {
        const code = [
            "function X() {",
            "  return (",
            "    <div>",
            "      <span className=\"text-sm mx-2 font-medium text-purple-100/50\">Period</span>",
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

        const classNameQuestion = questions.find(
            (q) => q.generatorRule === "jsx.className.token"
        );

        expect(classNameQuestion).toBeDefined();
        expect(classNameQuestion.questionType).toBe("multi");
        expect(classNameQuestion.multiCorrect).toEqual([
            "text-sm",
            "mx-2",
            "font-medium",
            "text-purple-100/50",
        ]);
        expect(classNameQuestion.multiSelectHint).toBe(4);
    });
});

describe("import question generation", () => {
    const importCode = [
        "'use client';",
        "",
        "import { useEffect, useRef, useState, useTransition } from 'react';",
        "import {",
        "  getCandlestickConfig,",
        "  getChartConfig,",
        "  LIVE_INTERVAL_BUTTONS,",
        "  PERIOD_BUTTONS,",
        "  PERIOD_CONFIG,",
        "} from '@/constants';",
        "import { CandlestickSeries, createChart, IChartApi, ISeriesApi } from 'lightweight-charts';",
        "import { fetcher } from '@/lib/coingecko.actions';",
        "import { convertOHLCData } from '@/lib/utils';",
    ].join("\n");

    it("generates correct modules question with all module specifiers", async () => {
        const { ast } = await parseWithTreeSitter(importCode, "tsx");
        const steps = generateEngineSteps(ast, ast, importCode, {
            profile: "shallow",
            generateQuiz: true,
        });

        const questions: any[] = [];
        const collect = (step: any) => {
            if (step.quiz?.questions?.length) questions.push(...step.quiz.questions);
            for (const child of step.lesson?.childSteps || []) collect(child);
        };
        steps.forEach(collect);

        const modulesQuestion = questions.find(
            (q) => q.generatorRule === "import_run.modules"
        );

        expect(modulesQuestion).toBeDefined();
        expect(modulesQuestion.questionType).toBe("multi");
        expect(modulesQuestion.multiCorrect).toEqual(
            expect.arrayContaining([
                "react",
                "@/constants",
                "lightweight-charts",
                "@/lib/coingecko.actions",
                "@/lib/utils",
            ])
        );
        expect(modulesQuestion.multiCorrect).toHaveLength(5);
    });

    it("generates correct bindings questions for each module", async () => {
        const { ast } = await parseWithTreeSitter(importCode, "tsx");
        const steps = generateEngineSteps(ast, ast, importCode, {
            profile: "shallow",
            generateQuiz: true,
        });

        const questions: any[] = [];
        const collect = (step: any) => {
            if (step.quiz?.questions?.length) questions.push(...step.quiz.questions);
            for (const child of step.lesson?.childSteps || []) collect(child);
        };
        steps.forEach(collect);

        // Check react bindings
        const reactBindings = questions.find(
            (q) => q.kind === "import_run.bindings:react"
        );
        expect(reactBindings).toBeDefined();
        expect(reactBindings.multiCorrect).toEqual(
            expect.arrayContaining(["useEffect", "useRef", "useState", "useTransition"])
        );

        // Check @/constants bindings
        const constantsBindings = questions.find(
            (q) => q.kind === "import_run.bindings:@/constants"
        );
        expect(constantsBindings).toBeDefined();
        expect(constantsBindings.multiCorrect).toEqual(
            expect.arrayContaining([
                "getCandlestickConfig",
                "getChartConfig",
                "LIVE_INTERVAL_BUTTONS",
                "PERIOD_BUTTONS",
                "PERIOD_CONFIG",
            ])
        );

        // Check lightweight-charts bindings
        const lightweightBindings = questions.find(
            (q) => q.kind === "import_run.bindings:lightweight-charts"
        );
        expect(lightweightBindings).toBeDefined();
        expect(lightweightBindings.multiCorrect).toEqual(
            expect.arrayContaining(["CandlestickSeries", "createChart", "IChartApi", "ISeriesApi"])
        );

        // Check @/lib/coingecko.actions bindings
        const coingeckoBindings = questions.find(
            (q) => q.kind === "import_run.bindings:@/lib/coingecko.actions"
        );
        expect(coingeckoBindings).toBeDefined();
        expect(coingeckoBindings.multiCorrect).toEqual(["fetcher"]);

        // Check @/lib/utils bindings
        const utilsBindings = questions.find(
            (q) => q.kind === "import_run.bindings:@/lib/utils"
        );
        expect(utilsBindings).toBeDefined();
        expect(utilsBindings.multiCorrect).toEqual(["convertOHLCData"]);
    });
});

describe("import progressive reveal", () => {
    const importCode = [
        "'use client';",
        "",
        "import { useEffect, useRef, useState, useTransition } from 'react';",
        "import {",
        "  getCandlestickConfig,",
        "  getChartConfig,",
        "  LIVE_INTERVAL_BUTTONS,",
        "  PERIOD_BUTTONS,",
        "  PERIOD_CONFIG,",
        "} from '@/constants';",
        "import { CandlestickSeries, createChart, IChartApi, ISeriesApi } from 'lightweight-charts';",
        "import { fetcher } from '@/lib/coingecko.actions';",
        "import { convertOHLCData } from '@/lib/utils';",
    ].join("\n");

    it("modules question reveals nothing new (zero-width span)", async () => {
        const { ast } = await parseWithTreeSitter(importCode, "tsx");
        const steps = generateEngineSteps(ast, ast, importCode, {
            profile: "shallow",
            generateQuiz: true,
        });

        const questions: any[] = [];
        const collect = (step: any) => {
            if (step.quiz?.questions?.length) questions.push(...step.quiz.questions);
            for (const child of step.lesson?.childSteps || []) collect(child);
        };
        steps.forEach(collect);

        const modulesQuestion = questions.find(
            (q) => q.generatorRule === "import_run.modules"
        );

        expect(modulesQuestion).toBeDefined();

        // The modules question should have a zero-width reveal span
        // This means revealStart === revealEndBeforeChild === revealEndAfterChild
        const revealStart = modulesQuestion.revealStart;
        const revealEndBefore = modulesQuestion.revealEndBeforeChild;
        const revealEndAfter = modulesQuestion.revealEndAfterChild;

        expect(revealStart).toBeTypeOf("number");
        expect(revealEndBefore).toBe(revealStart);
        expect(revealEndAfter).toBe(revealStart);
    });

    it("bindings questions reveal their respective import statement lines", async () => {
        const { ast } = await parseWithTreeSitter(importCode, "tsx");
        const steps = generateEngineSteps(ast, ast, importCode, {
            profile: "shallow",
            generateQuiz: true,
        });

        const questions: any[] = [];
        const collect = (step: any) => {
            if (step.quiz?.questions?.length) questions.push(...step.quiz.questions);
            for (const child of step.lesson?.childSteps || []) collect(child);
        };
        steps.forEach(collect);

        // Check react bindings reveal span
        const reactBindings = questions.find(
            (q) => q.kind === "import_run.bindings:react"
        );
        expect(reactBindings).toBeDefined();

        const reactLine = importCode.indexOf("import { useEffect");
        const reactLineEnd = importCode.indexOf("from 'react';") + "from 'react';".length;

        expect(reactBindings.revealStart).toBe(reactLine);
        expect(reactBindings.revealEndAfterChild).toBe(reactLineEnd);

        // Check @/constants bindings - multi-line import
        const constantsBindings = questions.find(
            (q) => q.kind === "import_run.bindings:@/constants"
        );
        expect(constantsBindings).toBeDefined();

        const constantsStart = importCode.indexOf("import {\n  getCandlestickConfig");
        const constantsEnd = importCode.indexOf("} from '@/constants';") + "} from '@/constants';".length;

        expect(constantsBindings.revealStart).toBe(constantsStart);
        expect(constantsBindings.revealEndAfterChild).toBe(constantsEnd);

        // Check @/lib/utils bindings (last import)
        const utilsBindings = questions.find(
            (q) => q.kind === "import_run.bindings:@/lib/utils"
        );
        expect(utilsBindings).toBeDefined();

        const utilsStart = importCode.indexOf("import { convertOHLCData }");
        const utilsEnd = importCode.indexOf("from '@/lib/utils';") + "from '@/lib/utils';".length;

        expect(utilsBindings.revealStart).toBe(utilsStart);
        expect(utilsBindings.revealEndAfterChild).toBe(utilsEnd);
    });
});

describe("multiselect question splitting", () => {
    it("splits arrow function parameter questions into multiple questions when >6 correct answers", async () => {
        // CandlestickChart-style component with 9 parameters
        const code = [
            "const CandlestickChart = ({",
            "  children,",
            "  data,",
            "  coinId,",
            "  height = 360,",
            "  initialPeriod = 'daily',",
            "  liveOhlcv = null,",
            "  mode = 'historical',",
            "  liveInterval,",
            "  setLiveInterval,",
            "}: CandlestickChartProps) => {",
            "  return <div>{children}</div>;",
            "};",
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

        // Find all arrow.params questions
        const paramQuestions = questions.filter((q) => q.generatorRule === "arrow.params");

        // Should be split into 2 questions (9 parameters > 6)
        expect(paramQuestions.length).toBeGreaterThanOrEqual(2);

        // Collect all correct answers across all split questions
        const allCorrectAnswers: string[] = [];
        for (const q of paramQuestions) {
            expect(q.questionType).toBe("multi");
            expect(q.multiCorrect).toBeDefined();
            expect(Array.isArray(q.multiCorrect)).toBe(true);

            // Each question should have at most 6 correct answers
            expect(q.multiCorrect.length).toBeLessThanOrEqual(6);
            expect(q.multiCorrect.length).toBeGreaterThan(0);

            allCorrectAnswers.push(...q.multiCorrect);
        }

        // No duplicates between questions
        const uniqueAnswers = new Set(allCorrectAnswers);
        expect(uniqueAnswers.size).toBe(allCorrectAnswers.length);

        // All answers should come from the expected parameter list
        const expectedParams = [
            "children",
            "data",
            "coinId",
            "height",
            "initialPeriod",
            "liveOhlcv",
            "mode",
            "liveInterval",
            "setLiveInterval",
        ];
        for (const answer of allCorrectAnswers) {
            expect(expectedParams).toContain(answer);
        }

        // All expected parameters should be covered
        expect(uniqueAnswers.size).toBe(expectedParams.length);
    });

    it("does not split when <=6 correct answers", async () => {
        const code = [
            "const Component = ({",
            "  prop1,",
            "  prop2,",
            "  prop3,",
            "}: Props) => {",
            "  return <div />;",
            "};",
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

        const paramQuestions = questions.filter((q) => q.generatorRule === "arrow.params");

        // Should NOT be split (3 parameters <= 6)
        expect(paramQuestions.length).toBe(1);
        expect(paramQuestions[0].multiCorrect).toHaveLength(3);
    });
});

describe("if statement quiz generation", () => {
    it("splits keyword and condition into separate questions", async () => {
        const code = [
            "if (ready) {",
            "  doThing();",
            "}",
        ].join("\n");

        const { ast } = await parseWithTreeSitter(code, "js");
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

        const keywordQuestion = questions.find((q) => q.generatorRule === "if.keyword");
        expect(keywordQuestion).toBeDefined();
        expect(keywordQuestion.answerLabel).toBe("if");

        const conditionQuestion = questions.find((q) => q.generatorRule === "if.condition");
        expect(conditionQuestion).toBeDefined();
        expect(conditionQuestion.answerLabel).toBe("(ready)");
    });

    it("splits complex conditions left to right", async () => {
        const code = [
            "if (a && b || c) {",
            "  doThing();",
            "}",
        ].join("\n");

        const { ast } = await parseWithTreeSitter(code, "js");
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

        const partQuestions = questions.filter((q) => q.generatorRule === "if.condition.part");
        expect(partQuestions.length).toBe(3);
        expect(partQuestions.map((q) => q.answerLabel)).toEqual(["a", "b", "c"]);
    });

    it("splits logical condition parts without breaking comparisons", async () => {
        const code = [
            "if (lastHistoricalCandle && lastHistoricalCandle[0] === liveTimestamp) {",
            "  doThing();",
            "}",
        ].join("\n");

        const { ast } = await parseWithTreeSitter(code, "js");
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

        const partQuestions = questions.filter((q) => q.generatorRule === "if.condition.part");
        expect(partQuestions.length).toBe(2);
        expect(partQuestions.map((q) => q.answerLabel)).toEqual([
            "lastHistoricalCandle",
            "lastHistoricalCandle[0] === liveTimestamp",
        ]);
    });

    it("splits OR condition with comparison on the right side", async () => {
        const code = [
            "if (dataChanged || mode === 'historical') {",
            "  chartRef.current?.timeScale().fitContent();",
            "}",
        ].join("\n");

        const { ast } = await parseWithTreeSitter(code, "js");
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

        const partQuestions = questions.filter((q) => q.generatorRule === "if.condition.part");
        expect(partQuestions.length).toBe(2);
        expect(partQuestions.map((q) => q.answerLabel)).toEqual([
            "dataChanged",
            "mode === 'historical'",
        ]);
    });
});

describe("progressive reveal for split multiselect questions", () => {
    it("first split question reveals less than last split question", async () => {
        // CandlestickChart-style component with 9 parameters - will be split into 2 questions
        const code = [
            "const CandlestickChart = ({",
            "  children,",
            "  data,",
            "  coinId,",
            "  height = 360,",
            "  initialPeriod = 'daily',",
            "  liveOhlcv = null,",
            "  mode = 'historical',",
            "  liveInterval,",
            "  setLiveInterval,",
            "}: CandlestickChartProps) => {",
            "  return <div>{children}</div>;",
            "};",
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

        const paramQuestions = questions.filter((q) => q.generatorRule === "arrow.params");

        // Should be at least 2 questions
        expect(paramQuestions.length).toBeGreaterThanOrEqual(2);

        // Use the same reveal logic as the UI (imported from QuizViewer)

        // Key positions in the code
        const firstParamStart = code.indexOf("children");  // Where parameters start
        const headerEnd = code.indexOf(") => {") + ") =>".length;  // Full header end

        // First split question should reveal BEFORE the parameters start
        const firstQ = paramQuestions[0];
        const firstRevealEnd = revealAfterForQuestion(firstQ);
        expect(firstRevealEnd).toBeDefined();
        expect(firstRevealEnd).toBeLessThan(firstParamStart);

        // Last split question should reveal the FULL header (including all parameters)
        const lastQ = paramQuestions[paramQuestions.length - 1];
        const lastRevealEnd = revealAfterForQuestion(lastQ);
        expect(lastRevealEnd).toBeDefined();
        expect(lastRevealEnd).toBeGreaterThanOrEqual(headerEnd);

        // Verify first reveals less than last
        expect(firstRevealEnd).toBeLessThan(lastRevealEnd!);
    });
});
