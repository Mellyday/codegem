"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { FileText, FolderOpen, TreeDeciduous, Code, GraduationCap, HelpCircle, ChevronRight, Copy, ExternalLink, PanelLeft, PanelRight } from "lucide-react";
import {
  GoIcon,
  PythonIcon,
  RubyIcon,
  JavaIcon,
  JavaScriptIcon,
  TypeScriptIcon,
  CIcon,
  CppIcon,
  KotlinIcon,
  PHPIcon,
  RustIcon,
  HTMLIcon,
  CSSIcon,
  JSONIcon,
  MarkdownIcon,
  GenericFileIcon,
} from "./icons/LanguageIcons";

// Server now reads file and passes code; no client-side loader
import { AstTree } from "./AstTree";
import { AstChildrenSidebar } from "./AstChildrenSidebar";
import { parseCodeToAst, type ParseResult } from "../lib/ast";
import type { TreeSitterAstNode } from "../lib/treeSitter";
import { QuizViewer } from "./QuizViewer";
import { LessonViewer } from "./LessonViewer";
import { getNodeDisplayName } from "../lib/astDisplayNames";
import { getLanguageIdFromFileName } from "../lib/languages/registry";

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

type LineSpan = { start: number; end: number; className: string };
type LineHL = undefined | { start: number; end: number; selected: boolean };

const scopeClass = (scope: string) => {
  switch (scope) {
    case "comment":
      return "text-slate-500 italic";
    case "string":
      return "text-emerald-700";
    case "keyword":
      return "text-fuchsia-700 font-semibold";
    case "function":
      return "text-cyan-700";
    case "type":
      return "text-indigo-700";
    case "number":
      return "text-amber-700";
    default:
      return "text-slate-700";
  }
};

const nodeCoversRow = (node: TreeSitterAstNode, row: number): boolean =>
  row >= node.startPosition.row && row <= node.endPosition.row;

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

const CodeLine = memo(function CodeLine(props: {
  line: string;
  lineIndex: number;
  lineNo: number;
  lineDigits: number;
  spans: LineSpan[];
  hl: LineHL;
  onLineClick: (lineIndex: number) => void;
}) {
  const { line, lineIndex, lineNo, lineDigits, spans, hl, onLineClick } = props;

  const pieces: {
    text: string;
    className?: string;
    hl?: boolean;
    selected?: boolean;
  }[] = [];
  const push = (
    text: string,
    className?: string,
    hlFlag?: boolean,
    sel?: boolean
  ) => {
    if (text.length) pieces.push({ text, className, hl: hlFlag, selected: sel });
  };

  const cuts = new Set<number>([0, line.length]);
  for (const s of spans) {
    cuts.add(s.start);
    cuts.add(s.end);
  }
  if (hl) {
    cuts.add(hl.start);
    cuts.add(hl.end);
  }
  const boundaries = Array.from(cuts).sort((a, b) => a - b);

  let spanIdx = 0;
  for (let k = 0; k < boundaries.length - 1; k++) {
    const a = boundaries[k];
    const b = boundaries[k + 1];
    if (b <= a) continue;

    while (spanIdx < spans.length && spans[spanIdx].end <= a) spanIdx++;
    const span =
      spanIdx < spans.length &&
        spans[spanIdx].start <= a &&
        spans[spanIdx].end >= b
        ? spans[spanIdx]
        : undefined;

    const inHL = hl ? a < hl.end && b > hl.start : false;
    const text = line.slice(a, b);

    push(text, span?.className, inHL, hl?.selected);
  }

  return (
    <div className="flex items-start cursor-pointer hover:bg-cyan-100/50 transition-colors px-4" onClick={() => onLineClick(lineIndex)}>
      <span
        className="shrink-0 select-none text-right pr-4 text-cyan-600/60 tabular-nums whitespace-nowrap"
        style={{ width: `${lineDigits + 2}ch` }}
      >
        {lineNo}
      </span>
      <code className="flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-slate-700">
        {pieces.length
          ? pieces.map((p, idx) => (
            <span
              key={idx}
              className={[
                p.className ?? "",
                p.hl
                  ? p.selected
                    ? "bg-amber-200/80 rounded"
                    : "bg-amber-100 rounded"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {p.text}
            </span>
          ))
          : line || " "}
      </code>
    </div>
  );

});



type FileInfo = {
  icon: ReactNode;
  language: string;
  iconContainerClass: string; // full tailwind classes for the icon container
  badgeClass: string; // full tailwind classes for the language badge
};

const getFileInfo = (fileName: string): FileInfo => {
  // Go - Cyan "GO" text
  if (fileName.endsWith(".go")) return {
    icon: <GoIcon className="h-8 w-8" />,
    language: "Go",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-cyan-500/10 text-cyan-600"
  };
  // TypeScript - Blue "TS" shield
  if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) return {
    icon: <TypeScriptIcon className="h-8 w-8" />,
    language: "TypeScript",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-blue-500/10 text-blue-600"
  };
  // JavaScript - Yellow "JS" shield
  if (fileName.endsWith(".js") || fileName.endsWith(".jsx") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) return {
    icon: <JavaScriptIcon className="h-8 w-8" />,
    language: "JavaScript",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-yellow-500/10 text-yellow-700"
  };
  // Python - Blue/Yellow snakes
  if (fileName.endsWith(".py")) return {
    icon: <PythonIcon className="h-8 w-8" />,
    language: "Python",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-blue-500/10 text-blue-600"
  };
  // Ruby - Red gemstone
  if (fileName.endsWith(".rb")) return {
    icon: <RubyIcon className="h-8 w-8" />,
    language: "Ruby",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-red-500/10 text-red-600"
  };
  // Java - Coffee cup
  if (fileName.endsWith(".java")) return {
    icon: <JavaIcon className="h-8 w-8" />,
    language: "Java",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-orange-500/10 text-orange-600"
  };
  // Kotlin - Geometric gradient
  if (fileName.endsWith(".kt") || fileName.endsWith(".kts")) return {
    icon: <KotlinIcon className="h-8 w-8" />,
    language: "Kotlin",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-purple-500/10 text-purple-600"
  };
  // C++ - Dark blue with plus signs
  if (fileName.endsWith(".cpp") || fileName.endsWith(".cc") || fileName.endsWith(".cxx") || fileName.endsWith(".hpp")) return {
    icon: <CppIcon className="h-8 w-8" />,
    language: "C++",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-blue-600/10 text-blue-700"
  };
  // C - Blue tile with "C"
  if (fileName.endsWith(".c") || fileName.endsWith(".h")) return {
    icon: <CIcon className="h-8 w-8" />,
    language: "C",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-blue-500/10 text-blue-600"
  };
  // PHP - Indigo oval
  if (fileName.endsWith(".php")) return {
    icon: <PHPIcon className="h-8 w-8" />,
    language: "PHP",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-indigo-500/10 text-indigo-600"
  };
  // Rust - Orange gear with R
  if (fileName.endsWith(".rs")) return {
    icon: <RustIcon className="h-8 w-8" />,
    language: "Rust",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-orange-500/10 text-orange-700"
  };
  // HTML - Orange shield
  if (fileName.endsWith(".html") || fileName.endsWith(".htm")) return {
    icon: <HTMLIcon className="h-8 w-8" />,
    language: "HTML",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-orange-500/10 text-orange-600"
  };
  // CSS - Blue/purple shield
  if (fileName.endsWith(".css") || fileName.endsWith(".scss") || fileName.endsWith(".sass")) return {
    icon: <CSSIcon className="h-8 w-8" />,
    language: "CSS",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-blue-500/10 text-blue-600"
  };
  // JSON - Dark braces
  if (fileName.endsWith(".json")) return {
    icon: <JSONIcon className="h-8 w-8" />,
    language: "JSON",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-slate-500/10 text-slate-600"
  };
  // Markdown - Blue with M
  if (fileName.endsWith(".md") || fileName.endsWith(".mdx")) return {
    icon: <MarkdownIcon className="h-8 w-8" />,
    language: "Markdown",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-blue-500/10 text-blue-600"
  };
  // Default - Generic file icon
  return {
    icon: <GenericFileIcon className="h-8 w-8" />,
    language: "File",
    iconContainerClass: "bg-transparent",
    badgeClass: "bg-slate-500/10 text-slate-600"
  };
};


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
  const codePanelRef = useRef<HTMLDivElement | null>(null);
  const prevCodePanelHeight = useRef<number | null>(null);
  // Zoom state for Tree-sitter AST: stack of previous roots and current zoom root
  const [zoomStackTs, setZoomStackTs] = useState<TreeSitterAstNode[]>([]);
  const [zoomRootTs, setZoomRootTs] = useState<TreeSitterAstNode | undefined>(
    undefined
  );

  // Quiz metadata for medal tracking
  const [currentQuizId, setCurrentQuizId] = useState<string | undefined>(undefined);
  const [currentSectionIndex, setCurrentSectionIndex] = useState<number>(0);

  // Mobile panel toggle: which panel to show on small screens
  const [mobilePanel, setMobilePanel] = useState<"content" | "code">("code");
  const isQuizView =
    viewMode === "quiz_setup" ||
    viewMode === "quiz_active" ||
    viewMode === "quiz_complete";
  const showMobilePanelToggle = viewMode === "ast" || viewMode === "lesson";
  const showContentPanel = isQuizView || mobilePanel === "content";
  const showCodePanel = isQuizView || mobilePanel === "code";
  const contentOrderClass = isQuizView
    ? "order-2 lg:order-1"
    : "order-1 lg:order-1";
  const codeOrderClass = isQuizView
    ? "order-1 lg:order-2"
    : "order-2 lg:order-2";
  const contentHeightClass = "h-full";
  const contentOverflowClass = "overflow-hidden";
  const codeScrollClass = "flex-1 min-h-0 overflow-auto";
  const codeScrollMaxClass = isQuizView
    ? "max-h-none"
    : "max-h-[calc(100vh-64px-120px)]";

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

  // Default to code view on mobile when entering a new file
  useEffect(() => {
    setMobilePanel("code");
  }, [fileName, sandboxId]);

  // When in quiz mode, keep the code view scrolled to the bottom (show latest lines)
  useEffect(() => {
    if (
      isQuizView &&
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
  }, [isQuizView, revealEndIndex]);

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
      return { lines: [] as string[], baseRow: 0, sliceStart: 0, sliceEnd: 0 };
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

    return {
      lines: visible.split("\n"),
      baseRow,
      sliceStart,
      sliceEnd: sliceStart + visible.length,
    };
  }, [
    state.status,
    state.status === "loaded" ? state.code : undefined,
    zoomRootTs,
    viewMode,
    revealEndIndex,
    maskRanges,
  ]);

  useLayoutEffect(() => {
    if (!isQuizView) {
      prevCodePanelHeight.current = null;
      return;
    }
    const el = codePanelRef.current;
    if (!el) return;
    const nextHeight = el.getBoundingClientRect().height;
    const prevHeight = prevCodePanelHeight.current;
    prevCodePanelHeight.current = nextHeight;
    if (prevHeight === null) return;
    const delta = nextHeight - prevHeight;
    if (delta === 0) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    if (el.getBoundingClientRect().top < 0) {
      window.scrollBy({ top: delta, left: 0 });
    }
  }, [isQuizView, codeSlice.lines.length]);

  // Responsive, content-sized line number gutter width (in ch units)
  const lineDigits = useMemo(() => {
    const count = codeSlice.lines.length || 0;
    const digits = Math.max(2, String(count).length);
    return digits;
  }, [codeSlice.lines.length]);

  const sliceStartIndex = codeSlice.sliceStart ?? 0;

  // Character-range helpers (slice-relative) for precise highlighting
  const selectedCharRange = useMemo(() => {
    if (!selectedTsNode) return undefined;
    const start = selectedTsNode.startIndex - sliceStartIndex;
    const end = selectedTsNode.endIndex - sliceStartIndex;

    return { start, end };
  }, [selectedTsNode, sliceStartIndex]);

  const hoveredCharRange = useMemo(() => {
    if (!hoveredTsNode) return undefined;
    const start = hoveredTsNode.startIndex - sliceStartIndex;
    const end = hoveredTsNode.endIndex - sliceStartIndex;

    return { start, end };
  }, [hoveredTsNode, sliceStartIndex]);

  const codeLength = state.status === "loaded" ? state.code.length : 0;

  const sliceTokens = useMemo(() => {
    if (parseResult?.status !== "success" || parseResult.parser !== "tree-sitter") {
      return [];
    }

    if (codeLength > 300_000) return [];

    const sliceEndIndex = codeSlice.sliceEnd;
    const raw = parseResult.highlights ?? [];
    if (raw.length > 200_000) return [];
    const filtered: { start: number; end: number; className: string }[] = [];

    for (const t of raw) {
      if (t.startIndex >= sliceEndIndex) break;
      const s = Math.max(t.startIndex, sliceStartIndex);
      const e = Math.min(t.endIndex, sliceEndIndex);
      if (e > s) {
        filtered.push({
          start: s - sliceStartIndex,
          end: e - sliceStartIndex,
          className: scopeClass(t.scope),
        });
      }
    }

    return filtered;
  }, [parseResult, sliceStartIndex, codeSlice.sliceEnd, codeLength]);

  const lineSyntaxSpans = useMemo(() => {
    const spans: LineSpan[][] = Array.from(
      { length: codeSlice.lines.length },
      () => []
    );
    if (!sliceTokens.length) return spans;

    let tokenIdx = 0;
    let offset = 0;

    for (let i = 0; i < codeSlice.lines.length; i++) {
      const line = codeSlice.lines[i];
      const lineStart = offset;
      const lineEnd = lineStart + line.length;

      while (tokenIdx < sliceTokens.length && sliceTokens[tokenIdx].end <= lineStart) {
        tokenIdx++;
      }

      let j = tokenIdx;
      while (j < sliceTokens.length && sliceTokens[j].start < lineEnd) {
        const t = sliceTokens[j];
        const s = Math.max(t.start, lineStart) - lineStart;
        const e = Math.min(t.end, lineEnd) - lineStart;
        if (e > s) spans[i].push({ start: s, end: e, className: t.className });

        if (t.end <= lineEnd) j++;
        else break;
      }

      tokenIdx = j;
      offset += line.length + 1;
    }

    return spans;
  }, [codeSlice.lines, sliceTokens]);

  const activeRange = selectedCharRange ?? hoveredCharRange;

  const lineStarts = useMemo(() => {
    const starts: number[] = [];
    let off = 0;
    for (const line of codeSlice.lines) {
      starts.push(off);
      off += line.length + 1;
    }
    return starts;
  }, [codeSlice.lines]);

  const lineHL = useMemo(() => {
    const out: LineHL[] = Array(codeSlice.lines.length).fill(undefined);
    if (!activeRange) return out;

    const sel = !!selectedCharRange;
    for (let i = 0; i < codeSlice.lines.length; i++) {
      const start = lineStarts[i];
      const end = start + codeSlice.lines[i].length;
      if (end < activeRange.start || start > activeRange.end) continue;

      const s = Math.max(activeRange.start, start) - start;
      const e = Math.min(activeRange.end, end) - start;
      if (e > s) out[i] = { start: s, end: e, selected: sel };
    }
    return out;
  }, [
    activeRange?.start,
    activeRange?.end,
    selectedCharRange ? 1 : 0,
    codeSlice.lines,
    lineStarts,
  ]);

  const handleLineClick = useCallback(
    (lineIndex: number) => {
      if (
        parseResult?.status === "success" &&
        parseResult.parser === "tree-sitter"
      ) {
        const root = activeTsRoot ?? (parseResult.ast as TreeSitterAstNode);
        const absoluteRow = lineIndex + codeSlice.baseRow;
        const found = findSmallestCoveringNode(root, absoluteRow);
        if (found) setSelectedTsNode(found);
      }
    },
    [parseResult, activeTsRoot, codeSlice.baseRow]
  );

  // Get file info for display
  const fileInfo = useMemo(() => getFileInfo(fileName), [fileName]);

  // Compute line count from code
  const lineCount = useMemo(() => {
    if (state.status !== "loaded") return 0;
    return state.code.split("\n").length;
  }, [state]);

  return (
    <div
      className={
        "h-[calc(100vh-64px)] overflow-hidden " +
        "overflow-x-hidden bg-gradient-to-b from-cyan-50 via-teal-50/80 to-emerald-50/60"
      }
    >
      {/* Header - matching project-navigator FileHeader style */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 lg:px-5 py-2 lg:py-3">
        {/* Left side - File info */}
        <div className="flex items-center gap-2 lg:gap-4 min-w-0">
          {/* File icon - smaller on mobile */}
          <div className={`flex-shrink-0 flex items-center justify-center w-8 h-8 lg:w-10 lg:h-10 rounded-lg ring-1 ${fileInfo.iconContainerClass}`}>
            {fileInfo.icon}
          </div>

          {/* File name and path */}
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm lg:text-base font-semibold text-slate-800 truncate">{fileName}</h1>
              <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${fileInfo.badgeClass}`}>
                {fileInfo.language}
              </span>
            </div>
            {/* Hide path on mobile */}
            <div className="hidden lg:flex items-center gap-1.5 text-sm text-slate-500 font-mono">
              <span className="opacity-60">repo</span>
              <ChevronRight className="w-3 h-3 opacity-40" />
              <span className="truncate max-w-md">{sandboxId}</span>
            </div>
          </div>
        </div>

        {/* Right side - Actions */}
        <div className="flex items-center gap-1 lg:gap-3">
          {/* Line count - hide on mobile */}
          <span className="hidden lg:inline text-sm text-slate-500">
            {lineCount} lines
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1.5 h-8 px-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              onClick={() => {
                if (state.status === "loaded") {
                  navigator.clipboard.writeText(state.code);
                }
              }}
            >
              <Copy className="w-4 h-4" />
              <span className="hidden sm:inline">Copy</span>
            </button>

            <button
              type="button"
              className="flex items-center gap-1.5 h-8 px-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden sm:inline">Open</span>
            </button>
          </div>

          {/* Mobile panel toggle - AST/Lesson only */}
          {showMobilePanelToggle && (
            <div className="flex lg:hidden items-center gap-1 border border-slate-200 rounded-lg p-0.5 bg-slate-50">
              <button
                type="button"
                onClick={() => setMobilePanel("content")}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${mobilePanel === "content"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                <PanelLeft className="w-3.5 h-3.5" />
                {viewMode === "ast" ? "AST" : "Lesson"}
              </button>
              <button
                type="button"
                onClick={() => setMobilePanel("code")}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${mobilePanel === "code"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
                  }`}
              >
                <PanelRight className="w-3.5 h-3.5" />
                Code
              </button>
            </div>
          )}

          <div className="w-px h-6 bg-slate-200 hidden lg:block" />

          {viewMode !== "ast" && (
            <button
              type="button"
              onClick={() => setViewMode("ast")}
              className="flex items-center gap-1.5 h-9 px-3 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <FileText className="h-4 w-4" />
              Back to File
            </button>
          )}

          {/* Back to folder - prominent button matching reference */}
          <Link
            href={parentFolderUrl}
            className="flex items-center gap-2 h-9 px-3 text-sm font-medium border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-500 hover:text-white hover:border-blue-500 transition-all"
          >
            <FolderOpen className="w-4 h-4" />
            Back to Folder
          </Link>
        </div>
      </div>

      {state.status === "loading" && (
        <div className="flex-1 flex items-center justify-center bg-white">
          <p className="text-slate-500">Loading sandbox contents…</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex-1 p-6 bg-white">
          <div className="space-y-2">
            <h3 className="font-semibold text-rose-600">
              Unable to load file
            </h3>
            <p className="text-sm text-slate-600">{state.message}</p>
          </div>
        </div>
      )}

      {state.status === "loaded" && (
        <div
          className={
            isQuizView
              ? "flex-1 h-[calc(100vh-64px-57px)] grid grid-cols-1 lg:grid-cols-[1fr_minmax(800px,1000px)]"
              : "flex-1 h-[calc(100vh-64px-57px)] grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_1fr]"
          }
        >
          {/* Main Content - AST / Quiz / Lesson */}
          <div
            className={
              "bg-white flex-col " +
              contentHeightClass +
              " min-h-0 " +
              contentOverflowClass +
              " " +
              (isQuizView ? "p-6 " : "") +
              (showContentPanel ? "flex " : "hidden ") +
              "lg:flex " +
              contentOrderClass
            }
          >
            {viewMode === "ast" && (
              <>
                {/* AST Header */}
                <div className="border-b border-slate-200/60 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <TreeDeciduous className="h-4 w-4 text-violet-500" />
                    <h2 className="text-sm font-semibold text-slate-700">
                      AST Tree
                    </h2>
                  </div>
                  {parseResult?.status === "success" && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-teal-500 px-2 py-0.5 text-xs font-medium text-white">
                        {parseResult.language}
                      </span>
                      <span className="text-xs text-slate-400">
                        via tree-sitter
                      </span>
                    </div>
                  )}
                  <div className="mt-1 text-xs text-slate-400">Top level</div>
                </div>

                {/* AST Content */}
                <div className="flex-1 min-h-0 overflow-auto p-4 scrollbar-teal">
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
                        {/* Zoom controls */}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-violet-600">
                            {zoomRootTs ? (
                              <>
                                <span>Zoomed into:</span>
                                <span
                                  className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-violet-700"
                                  onMouseEnter={() =>
                                    setHoveredTsNode(zoomRootTs)
                                  }
                                  onMouseLeave={() =>
                                    setHoveredTsNode(undefined)
                                  }
                                >
                                  {getNodeDisplayName(getLanguageIdFromFileName(fileName), zoomRootTs.type)}
                                </span>
                              </>
                            ) : (
                              <span className="text-violet-400">Top level</span>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              className={
                                "rounded-md border border-violet-200 bg-white px-2 py-1 text-xs text-violet-600 shadow-sm transition " +
                                (zoomStackTs.length === 0
                                  ? "opacity-40 cursor-not-allowed"
                                  : "hover:border-violet-300 hover:bg-violet-50")
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
                                "rounded-md border border-violet-200 bg-white px-2 py-1 text-xs text-violet-600 shadow-sm transition " +
                                (!zoomRootTs
                                  ? "opacity-40 cursor-not-allowed"
                                  : "hover:border-violet-300 hover:bg-violet-50")
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

                {parseResult?.status === "success" &&
                  parseResult.parser === "tree-sitter" && (
                    <div className="border-t border-slate-200/60 p-3">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-teal-400 to-cyan-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-teal-500 hover:to-cyan-600"
                          onClick={() => setViewMode("lesson")}
                        >
                          <GraduationCap className="h-4 w-4" />
                          Teach Me
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-600 transition hover:bg-amber-100 hover:border-amber-500"
                          onClick={() => setViewMode("quiz_setup")}
                        >
                          <HelpCircle className="h-4 w-4" />
                          Quiz Me
                        </button>
                      </div>
                    </div>
                  )}
              </>
            )}

            {isQuizView && parseResult?.status === "success" && (
              <div className="flex-1 min-h-0 overflow-auto">
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
              </div>
            )}

            {viewMode === "lesson" &&
              parseResult?.status === "success" && (
                <div className="flex-1 min-h-0 overflow-auto p-4">
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
                </div>
              )}
          </div>

          {/* Right Column - Source Code */}
          <div
            ref={codePanelRef}
            className={`bg-cyan-50/80 flex-col min-h-0 ${showCodePanel ? "flex" : "hidden"} lg:flex ${codeOrderClass}`}
          >
            {/* Source Code Header */}
            <div className="flex items-center justify-between border-b border-cyan-200/60 bg-cyan-50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-violet-500" />
                <h2 className="text-sm font-semibold text-slate-700">
                  Source Code
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                {codeSlice.lines.length} lines
              </span>
            </div>

            {viewMode === "ast" &&
              parseResult?.status === "success" &&
              parseResult.parser === "tree-sitter" && (
                <div className="lg:hidden border-b border-cyan-200/60 bg-cyan-50 px-4 py-3">
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-teal-400 to-cyan-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-teal-500 hover:to-cyan-600"
                      onClick={() => setViewMode("lesson")}
                    >
                      <GraduationCap className="h-4 w-4" />
                      Teach Me
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-600 transition hover:bg-amber-100 hover:border-amber-500"
                      onClick={() => setViewMode("quiz_setup")}
                    >
                      <HelpCircle className="h-4 w-4" />
                      Quiz Me
                    </button>
                  </div>
                </div>
              )}

            {/* Source Code Content */}
            <div
              ref={codeScrollRef}
              className={`${codeScrollClass} px-0 py-0 ${codeScrollMaxClass}`}
            >
              {/*
                Use a normal div with explicit whitespace + monospace so the
                inner line <div>s don't break <pre> semantics on some browsers.
                This fixes jagged line numbers and collapsed indentation,
                especially on mobile Safari.
              */}
              <div className="text-xs leading-snug font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] tabular-nums [tab-size:4]">
                {codeSlice.lines.map((line: string, i: number) => (
                  <CodeLine
                    key={i}
                    line={line || " "}
                    lineIndex={i}
                    lineNo={i + 1}
                    lineDigits={lineDigits}
                    spans={lineSyntaxSpans[i] ?? []}
                    hl={lineHL[i]}
                    onLineClick={handleLineClick}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
