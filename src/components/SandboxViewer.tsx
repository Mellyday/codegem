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

  // Zoom state for Tree-sitter AST: stack of previous roots and current zoom root
  const [zoomStackTs, setZoomStackTs] = useState<TreeSitterAstNode[]>([]);
  const [zoomRootTs, setZoomRootTs] = useState<TreeSitterAstNode | undefined>(
    undefined
  );

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
          <div>
            {/* Main Content - AST / Quiz / Lesson */}
            <div className="rounded-xl bg-white p-6 shadow-sm flex flex-col">
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
          </div>
        )}

        {/* Footer and Navigation */}
        <div className="mt-8 flex items-end justify-between">
          {/* Back Button - goes to parent folder */}
          <Link
            href={parentFolderUrl}
            className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:shadow"
          >
            <FolderOpen className="h-4 w-4" />
            Back to Folder
          </Link>

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
