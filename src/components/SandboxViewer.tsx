"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Zap, BookOpen, FolderOpen } from "lucide-react";

// Server now reads file and passes code; no client-side loader
import { AstTree } from "./AstTree";
import { AstChildrenSidebar } from "./AstChildrenSidebar";
import { parseCodeToAst, type ParseResult } from "../lib/ast";
import type { TreeSitterAstNode } from "../lib/treeSitter";
import { QuizViewer } from "./QuizViewer";
import { LessonViewer } from "./LessonViewer";

type SandboxViewerProps = {
  sandboxId: string;
  fileName: string;
  initialCode: string;
};

type LoadingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; code: string }
  | { status: "error"; message: string };

export const SandboxViewer = ({
  sandboxId,
  fileName,
  initialCode,
}: SandboxViewerProps) => {
  // Derive fileKey from sandboxId: format "repo/<id>/<path>" or "project/<id>/<path>"
  const fileKey = useMemo(() => {
    try {
      const parts = sandboxId.split("/");
      const kind = parts[0] as "repo" | "project";
      const id = parts[1];
      const path = parts.slice(2).join("/");
      if ((kind === "repo" || kind === "project") && id && path) {
        return { kind, id, path } as const;
      }
    } catch { }
    return undefined;
  }, [sandboxId]);
  const [state, setState] = useState<LoadingState>({ status: "idle" });
  const [parseResult, setParseResult] = useState<ParseResult | undefined>(
    undefined
  );
  const [isParsing, setIsParsing] = useState(false);
  const [selectedTsNode, setSelectedTsNode] = useState<
    TreeSitterAstNode | undefined
  >(undefined);
  const [hoveredTsNode, setHoveredTsNode] = useState<
    TreeSitterAstNode | undefined
  >(undefined);
  // Consolidated view mode for AST, Quiz, and Lesson
  const [viewMode, setViewMode] = useState<
    "ast" | "quiz_setup" | "quiz_active" | "quiz_complete" | "lesson"
  >("ast");
  // Persist view mode across remounts per file to avoid unexpected resets
  const storageKey = useMemo(
    () => (fileName ? `sandbox-viewer:${sandboxId}:${fileName}` : undefined),
    [sandboxId, fileName]
  );
  // Unified reveal state used by both Quiz and Lesson: absolute end index in file
  const [revealEndIndex, setRevealEndIndex] = useState<number | undefined>(
    undefined
  );
  // Mask ranges (absolute indices) to hide structural keywords in lesson view
  const [maskRanges, setMaskRanges] = useState<
    { start: number; end: number }[]
  >([]);
  // Ref to the scrollable code container so we can control scroll position
  const codeScrollRef = useRef<HTMLDivElement | null>(null);
  // Zoom state for Tree-sitter AST: stack of previous roots and current zoom root
  const [zoomStackTs, setZoomStackTs] = useState<TreeSitterAstNode[]>([]);
  const [zoomRootTs, setZoomRootTs] = useState<TreeSitterAstNode | undefined>(
    undefined
  );

  // Quiz metadata for medal tracking
  const [currentQuizId, setCurrentQuizId] = useState<string | undefined>(undefined);
  const [currentSectionIndex, setCurrentSectionIndex] = useState<number>(0);

  // Compute parent folder URL based on fileKey
  const parentFolderUrl = useMemo(() => {
    if (!fileKey) return "/";
    const { kind, id, path } = fileKey;
    const pathParts = path.split("/");
    // Remove the file name to get the parent folder
    pathParts.pop();
    if (pathParts.length === 0) {
      // File is at root of repo/project
      return `/${kind}/${encodeURIComponent(id)}`;
    }
    return `/${kind}/${encodeURIComponent(id)}/${pathParts.map(encodeURIComponent).join("/")}`;
  }, [fileKey]);

  useEffect(() => {
    if (!fileName || !initialCode) {
      setState({
        status: "error",
        message: "Unable to load the sandbox file.",
      });
      return;
    }
    setState({ status: "loaded", code: initialCode });
  }, [fileName, initialCode]);

  useEffect(() => {
    if (state.status !== "loaded" || !fileName) {
      setParseResult(undefined);
      setIsParsing(false);
      return;
    }

    let cancelled = false;
    setParseResult(undefined);
    setIsParsing(true);

    parseCodeToAst(state.code, fileName)
      .then((result) => {
        if (!cancelled) {
          setParseResult(result);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : "Unknown error while parsing code.";
          setParseResult({ status: "error", message });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsParsing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state, fileName]);

  // Reset selection/hover whenever a new AST is produced or mode changes
  useEffect(() => {
    setSelectedTsNode(undefined);
    setHoveredTsNode(undefined);
  }, [parseResult?.status, viewMode]);

  // Reset zoom when AST changes
  useEffect(() => {
    setZoomStackTs([]);
    setZoomRootTs(undefined);
  }, [parseResult?.status]);

  // Clear selection/hover when zoom root or mode changes; reset reveal and masks on AST view
  useEffect(() => {
    setSelectedTsNode(undefined);
    setHoveredTsNode(undefined);
    if (viewMode === "ast") {
      setRevealEndIndex(undefined);
      setMaskRanges([]);
    }
  }, [zoomRootTs, viewMode]);

  // Restore persisted view mode on mount/prop change
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (
          data &&
          typeof data.viewMode === "string" &&
          [
            "ast",
            "quiz_setup",
            "quiz_active",
            "quiz_complete",
            "lesson",
          ].includes(data.viewMode)
        ) {
          setViewMode(data.viewMode as typeof viewMode);
        }
        if (
          data &&
          (typeof data.revealEndIndex === "number" ||
            typeof data.revealEndIndex === "undefined")
        ) {
          setRevealEndIndex(data.revealEndIndex);
        }
        if (data && Array.isArray(data.maskRanges)) {
          setMaskRanges(
            data.maskRanges.filter(
              (r: any) =>
                r && typeof r.start === "number" && typeof r.end === "number"
            )
          );
        }
      }
    } catch {
      // ignore restore errors
    }
    // We only want to run on storageKey changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist view mode and reveal/mask state so accidental remounts don't reset context
  useEffect(() => {
    if (!storageKey) return;
    try {
      const payload = {
        viewMode,
        revealEndIndex,
        maskRanges,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // ignore persist errors
    }
  }, [storageKey, viewMode, revealEndIndex, maskRanges]);

  // When in quiz mode, keep the code view scrolled to the bottom (show latest lines)
  useEffect(() => {
    if (
      (viewMode === "quiz_active" || viewMode === "quiz_complete") &&
      codeScrollRef.current
    ) {
      const el = codeScrollRef.current;
      // Use requestAnimationFrame to ensure DOM updates are flushed
      requestAnimationFrame(() => {
        try {
          el.scrollTop = el.scrollHeight;
        } catch {
          // ignore scroll errors
        }
      });
    }
  }, [viewMode, revealEndIndex]);

  // Helper: check if a Tree-sitter node covers a given row
  const nodeCoversRow = (node: TreeSitterAstNode, row: number): boolean =>
    row >= node.startPosition.row && row <= node.endPosition.row;

  // Helper: find the smallest Tree-sitter node that covers a given row
  const findSmallestCoveringNode = (
    node: TreeSitterAstNode,
    row: number
  ): TreeSitterAstNode | undefined => {
    if (!nodeCoversRow(node, row)) return undefined;
    for (const child of node.namedChildren || []) {
      const found = findSmallestCoveringNode(child, row);
      if (found) return found;
    }
    return node;
  };

  // Active Tree-sitter root: either zoomed root or top-level AST (Tree-sitter only)
  const activeTsRoot: TreeSitterAstNode | undefined = useMemo(() => {
    if (zoomRootTs) return zoomRootTs;
    if (
      parseResult?.status === "success" &&
      parseResult.parser === "tree-sitter"
    ) {
      return parseResult.ast as TreeSitterAstNode;
    }
    return undefined;
  }, [zoomRootTs, parseResult]);



  // When zoomed, restrict the displayed code precisely to the node's character span,
  // and when in quiz mode, further clip to the currently revealed prefix.
  const codeSlice = useMemo(() => {
    if (state.status !== "loaded") {
      return { lines: [] as string[], baseRow: 0 };
    }

    // Determine slice bounds (zoomed or full file)
    const sliceStart = zoomRootTs?.startIndex ?? 0;
    const sliceEnd = zoomRootTs?.endIndex ?? state.code.length;
    const baseRow = zoomRootTs?.startPosition.row ?? 0;
    let visible = state.code.substring(sliceStart, sliceEnd);

    // Apply reveal clipping for lesson/quiz modes
    if (viewMode !== "ast" && typeof revealEndIndex === "number") {
      const relativeLimit = Math.max(
        0,
        Math.min(visible.length, revealEndIndex - sliceStart)
      );
      visible = visible.substring(0, relativeLimit);
    }

    // Apply masking after clipping to avoid leaking keywords like "while"/"if"
    if (viewMode !== "ast" && maskRanges.length) {
      const chars = Array.from(visible);
      for (const { start, end } of maskRanges) {
        const s = Math.max(0, start - sliceStart);
        const e = Math.min(visible.length, end - sliceStart);
        for (let i = s; i < e; i++) {
          if (chars[i] !== "\n") chars[i] = " ";
        }
      }
      visible = chars.join("");
    }

    return { lines: visible.split("\n"), baseRow };
  }, [
    state.status,
    state.status === "loaded" ? state.code : undefined,
    zoomRootTs,
    viewMode,
    revealEndIndex,
    maskRanges,
  ]);

  // Responsive, content-sized line number gutter width (in ch units)
  const lineDigits = useMemo(() => {
    const count = codeSlice.lines.length || 0;
    const digits = Math.max(2, String(count).length);
    return digits;
  }, [codeSlice.lines.length]);

  // Character-range helpers (slice-relative) for precise highlighting
  const selectedCharRange = useMemo(() => {
    if (!selectedTsNode) return undefined;
    // If not zoomed, the slice starts at 0. If zoomed, it starts at the root's index.
    const sliceStartIndex = zoomRootTs?.startIndex ?? 0;

    const start = selectedTsNode.startIndex - sliceStartIndex;
    const end = selectedTsNode.endIndex - sliceStartIndex;

    return { start, end };
  }, [selectedTsNode, zoomRootTs]);

  const hoveredCharRange = useMemo(() => {
    if (!hoveredTsNode) return undefined;
    const sliceStartIndex = zoomRootTs?.startIndex ?? 0;

    const start = hoveredTsNode.startIndex - sliceStartIndex;
    const end = hoveredTsNode.endIndex - sliceStartIndex;

    return { start, end };
  }, [hoveredTsNode, zoomRootTs]);

  return (
    <div className="min-h-screen bg-[#E8EBF0] px-8 py-12">
      <div className="mx-auto max-w-7xl">
        {/* Header Card */}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-blue-50">
              <FileText className="h-8 w-8 text-blue-500" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {fileName ? 'File Path' : 'Sandbox'}
              </p>
              <h1 className="mt-1 text-xl font-semibold text-slate-900">
                {fileName || sandboxId}
              </h1>
              {fileName && (
                <p className="mt-0.5 font-mono text-sm text-slate-600">
                  {sandboxId}
                </p>
              )}
            </div>
          </div>
        </div>

        {state.status === "loading" && (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <p className="text-slate-600">Loading sandbox contents…</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <div className="space-y-2">
              <h3 className="font-semibold text-rose-600">
                Unable to load file
              </h3>
              <p className="text-sm text-slate-600">{state.message}</p>
            </div>
          </div>
        )}

        {state.status === "loaded" && (
          <div className={viewMode === "quiz_setup" ? "" : "grid grid-cols-1 gap-6 lg:grid-cols-2"}>
            {/* Main Content - AST / Quiz / Lesson */}
            <div className={viewMode === "quiz_setup" ? "rounded-xl bg-white p-6 shadow-sm flex flex-col" : "order-2 lg:order-1 rounded-xl bg-white p-6 shadow-sm flex flex-col"}>
              {viewMode === "ast" && (
                <>
                  <div className="mb-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-800">
                          AST
                        </h2>
                        {parseResult?.status === "success" && (
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Parsed with {parseResult.language} via{" "}
                            tree-sitter
                          </p>
                        )}
                      </div>
                      {parseResult?.status === "success" &&
                        parseResult.parser === "tree-sitter" && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-blue-600"
                              onClick={() => setViewMode("lesson")}
                            >
                              <BookOpen className="h-3.5 w-3.5" /> Teach Me
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-amber-600"
                              onClick={() => setViewMode("quiz_setup")}
                            >
                              Quiz Me
                            </button>
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="max-h-[600px] overflow-auto">
                    {(parseResult === undefined || isParsing) && (
                      <p className="text-sm text-slate-500">Parsing code…</p>
                    )}

                    {parseResult?.status === "unsupported" && (
                      <div className="space-y-2">
                        <p className="text-sm text-amber-600">
                          {parseResult.reason}. AST visualisation is not yet
                          available for this file type.
                        </p>
                      </div>
                    )}

                    {parseResult?.status === "error" && (
                      <div className="space-y-2">
                        <p className="text-sm text-rose-600">
                          Failed to parse file: {parseResult.message}
                        </p>
                      </div>
                    )}

                    {parseResult?.status === "success" &&
                      (parseResult.parser === "tree-sitter" ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-slate-600">
                              {zoomRootTs ? (
                                <span>
                                  Zoomed into:{" "}
                                  <span
                                    className="font-mono"
                                    onMouseEnter={() =>
                                      setHoveredTsNode(zoomRootTs)
                                    }
                                    onMouseLeave={() =>
                                      setHoveredTsNode(undefined)
                                    }
                                  >
                                    {zoomRootTs.type}
                                  </span>
                                </span>
                              ) : (
                                <span>Top level</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={
                                  "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm " +
                                  (zoomStackTs.length === 0
                                    ? "opacity-50 cursor-not-allowed"
                                    : "hover:bg-slate-50")
                                }
                                disabled={zoomStackTs.length === 0}
                                onClick={() => {
                                  setZoomRootTs(() => {
                                    if (zoomStackTs.length === 0)
                                      return undefined;
                                    const next =
                                      zoomStackTs[zoomStackTs.length - 1];
                                    setZoomStackTs((stack) =>
                                      stack.slice(0, -1)
                                    );
                                    // Clear selection on zoom out
                                    setSelectedTsNode(undefined);
                                    setHoveredTsNode(undefined);
                                    return next;
                                  });
                                }}
                              >
                                Back
                              </button>
                              <button
                                type="button"
                                className={
                                  "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm " +
                                  (!zoomRootTs
                                    ? "opacity-50 cursor-not-allowed"
                                    : "hover:bg-slate-50")
                                }
                                disabled={!zoomRootTs}
                                onClick={() => {
                                  if (!zoomRootTs) return;
                                  setZoomRootTs(undefined);
                                  setZoomStackTs([]);
                                  setSelectedTsNode(undefined);
                                  setHoveredTsNode(undefined);
                                }}
                              >
                                Return to Top
                              </button>
                            </div>
                          </div>
                          <AstChildrenSidebar
                            ast={
                              (activeTsRoot as TreeSitterAstNode) ??
                              (parseResult.ast as TreeSitterAstNode)
                            }
                            languageLabel={`${parseResult.language} via Tree-sitter`}
                            code={state.code}
                            fileName={fileName}
                            selectedNode={selectedTsNode}
                            hoveredNode={hoveredTsNode}
                            flattenRoot
                            onSelectNode={(n) => {
                              // Zoom into the clicked node
                              if (activeTsRoot) {
                                setZoomStackTs((stack) => [
                                  ...stack,
                                  activeTsRoot,
                                ]);
                              }
                              setZoomRootTs(n);
                              // Do not carry selection into zoomed view; clear highlights
                              setSelectedTsNode(undefined);
                              setHoveredTsNode(undefined);
                            }}
                            onHoverNode={(n) => setHoveredTsNode(n)}
                          />
                        </div>
                      ) : (
                        <AstTree root={parseResult.ast} defaultOpenDepth={2} />
                      ))}
                  </div>
                </>
              )}

              {(viewMode === "quiz_setup" ||
                viewMode === "quiz_active" ||
                viewMode === "quiz_complete") &&
                parseResult?.status === "success" && (
                  <QuizViewer
                    root={
                      (activeTsRoot as TreeSitterAstNode) ??
                      (parseResult.ast as TreeSitterAstNode)
                    }
                    code={state.code}
                    fileKey={fileKey}
                    fileName={fileName}
                    mode={
                      viewMode.replace("quiz_", "") as
                      | "setup"
                      | "active"
                      | "complete"
                    }
                    onCancel={() => setViewMode("ast")}
                    onStart={() => setViewMode("quiz_active")}
                    onComplete={() => setViewMode("quiz_complete")}
                    onReturnToAst={() => setViewMode("ast")}
                    onRevealChange={setRevealEndIndex}
                    quizId={currentQuizId}
                    sectionIndex={currentSectionIndex}
                    onQuizMetadataChange={(quizId, sectionIndex) => {
                      setCurrentQuizId(quizId);
                      setCurrentSectionIndex(sectionIndex);
                    }}
                  />
                )}

              {viewMode === "lesson" &&
                parseResult?.status === "success" && (
                  <LessonViewer
                    root={
                      (activeTsRoot as TreeSitterAstNode) ??
                      (parseResult.ast as TreeSitterAstNode)
                    }
                    code={state.code}
                    fileKey={fileKey}
                    fileName={fileName}
                    onReturnToAst={() => setViewMode("ast")}
                    onRevealEndIndexChange={setRevealEndIndex}
                    onMaskRangesChange={setMaskRanges}
                  />
                )}
            </div>

            {/* Right Column - Source Code (hidden in quiz_setup mode) */}
            {viewMode !== "quiz_setup" && (
              <div className="order-1 lg:order-2 rounded-xl bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-slate-800">
                  SOURCE CODE
                </h2>
                <div
                  ref={codeScrollRef}
                  className="min-h-[45vh] overflow-auto rounded-lg bg-slate-50 p-4 lg:min-h-0 lg:max-h-[600px]"
                >
                  {/*
                  Use a normal div with explicit whitespace + monospace so the
                  inner line <div>s don't break <pre> semantics on some browsers.
                  This fixes jagged line numbers and collapsed indentation,
                  especially on mobile Safari.
                */}
                  <div className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] tabular-nums [tab-size:4]">
                    {(() => {
                      let charIndex = 0; // slice-relative character index
                      const activeRange = selectedCharRange ?? hoveredCharRange;

                      return codeSlice.lines.map((line: string, i: number) => {
                        const lineStart = charIndex;
                        const lineEnd = lineStart + line.length;
                        charIndex += line.length + 1; // +1 for the newline character

                        const getHighlightClasses = (isFullLine: boolean) => {
                          if (!activeRange) return "";
                          const isSelected = !!selectedCharRange;
                          if (isFullLine) {
                            return isSelected ? "bg-amber-100/70" : "bg-amber-50";
                          }
                          return isSelected
                            ? "bg-amber-200/80 rounded"
                            : "bg-amber-100 rounded";
                        };

                        const handleLineClick = () => {
                          if (
                            parseResult?.status === "success" &&
                            parseResult.parser === "tree-sitter"
                          ) {
                            const root =
                              activeTsRoot ??
                              (parseResult.ast as TreeSitterAstNode);
                            const absoluteRow = i + codeSlice.baseRow;
                            const found = findSmallestCoveringNode(
                              root,
                              absoluteRow
                            );
                            if (found) setSelectedTsNode(found);
                          }
                        };

                        // Case 1: No active highlight on this line
                        if (
                          !activeRange ||
                          lineEnd < activeRange.start ||
                          lineStart > activeRange.end
                        ) {
                          return (
                            <div
                              key={i}
                              className="flex items-start cursor-pointer"
                              onClick={handleLineClick}
                            >
                              <span
                                className="mr-2 sm:mr-3 md:mr-4 shrink-0 select-none text-right text-slate-400 font-mono tabular-nums text-[10px] sm:text-xs"
                                style={{ width: `${lineDigits}ch` }}
                              >
                                {i + 1}
                              </span>
                              <code className="flex-1 text-slate-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {line || " "}
                              </code>
                            </div>
                          );
                        }

                        // Case 2: The entire line is inside the highlight
                        if (
                          lineStart >= activeRange.start &&
                          lineEnd <= activeRange.end
                        ) {
                          return (
                            <div
                              key={i}
                              className={`flex items-start cursor-pointer ${getHighlightClasses(
                                true
                              )}`}
                              onClick={handleLineClick}
                            >
                              <span
                                className="mr-2 sm:mr-3 md:mr-4 shrink-0 select-none text-right text-slate-400 font-mono tabular-nums text-[10px] sm:text-xs"
                                style={{ width: `${lineDigits}ch` }}
                              >
                                {i + 1}
                              </span>
                              <code className="flex-1 text-slate-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {line || " "}
                              </code>
                            </div>
                          );
                        }

                        // Case 3: Partial highlight
                        const startHighlight = Math.max(
                          lineStart,
                          activeRange.start
                        );
                        const endHighlight = Math.min(lineEnd, activeRange.end);
                        const startIndexInLine = startHighlight - lineStart;
                        const endIndexInLine = endHighlight - lineStart;

                        const before = line.substring(0, startIndexInLine);
                        const highlighted = line.substring(
                          startIndexInLine,
                          endIndexInLine
                        );
                        const after = line.substring(endIndexInLine);

                        return (
                          <div
                            key={i}
                            className="flex items-start cursor-pointer"
                            onClick={handleLineClick}
                          >
                            <span
                              className="mr-2 sm:mr-3 md:mr-4 shrink-0 select-none text-right text-slate-400 font-mono tabular-nums text-[10px] sm:text-xs"
                              style={{ width: `${lineDigits}ch` }}
                            >
                              {i + 1}
                            </span>
                            <code className="flex-1 text-slate-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {before && <span>{before}</span>}
                              {highlighted && (
                                <span className={getHighlightClasses(false)}>
                                  {highlighted}
                                </span>
                              )}
                              {after && <span>{after}</span>}
                              {!before && !highlighted && !after && " "}
                            </code>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer and Navigation */}
        <div className="mt-8 flex items-end justify-between">
          {/* Navigation Buttons */}
          <div className="flex items-center gap-3">
            {/* Back to File - shown when in lesson or quiz views */}
            {viewMode !== "ast" && (
              <button
                onClick={() => setViewMode("ast")}
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow"
              >
                <FileText className="h-4 w-4" />
                Back to File
              </button>
            )}
            {/* Back to Folder - goes to parent folder */}
            <Link
              href={parentFolderUrl}
              className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow"
            >
              <FolderOpen className="h-4 w-4" />
              Back to Folder
            </Link>
          </div>

          {/* Made with Gemini Badge */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Made with Gemini</span>
            <Zap className="h-4 w-4 fill-amber-400 text-amber-400" />
          </div>
        </div>
      </div>
    </div>
  );
};
