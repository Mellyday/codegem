import type { TreeSitterAstNode } from "../lib/treeSitter";
import { getLanguageToolsForFileName, getLanguageIdFromFileName } from "../lib/languages/registry";
import { getNodeDisplayName } from "../lib/astDisplayNames";
import { useState, memo } from "react";
import { ChevronRight, MessageSquare, Type, Terminal, Code } from "lucide-react";

type AstChildrenSidebarProps = {
  ast: TreeSitterAstNode;
  languageLabel?: string;
  selectedNode?: TreeSitterAstNode;
  hoveredNode?: TreeSitterAstNode;
  onSelectNode?: (node: TreeSitterAstNode) => void;
  onHoverNode?: (node?: TreeSitterAstNode) => void;
  // When true, omit the singular root wrapper and start at its children
  flattenRoot?: boolean;
  // Optional full source text to enable token-level hints (e.g., "yield from")
  code?: string;
  fileName?: string;
};

// Stable node identity comparison to avoid reference-based flicker
const nodesEqual = (a?: TreeSitterAstNode, b?: TreeSitterAstNode) =>
  !!a &&
  !!b &&
  a.type === b.type &&
  a.startIndex === b.startIndex &&
  a.endIndex === b.endIndex;

// Stable key for React lists
const nodeKey = (n: TreeSitterAstNode) =>
  `${n.type}:${n.startIndex}:${n.endIndex}`;

// Get icon for node type
const getNodeIcon = (type: string) => {
  // Comments
  if (type === "comment") {
    return <MessageSquare className="h-3.5 w-3.5 text-violet-400" />;
  }
  // Identifiers
  if (type === "identifier" || type === "package_identifier" || type.endsWith("_identifier")) {
    return <Type className="h-3.5 w-3.5 text-violet-500 font-bold" />;
  }
  // Import specs / parameter lists
  if (type === "import_spec" || type === "parameter_list" || type.startsWith("parameter")) {
    return <Terminal className="h-3.5 w-3.5 text-violet-500" />;
  }
  // Default code icon
  return <Code className="h-3.5 w-3.5 text-violet-500" />;
};

// Get text color based on node type
const getNodeTextColor = (type: string): string => {
  if (type === "comment") return "text-slate-500";
  if (type === "identifier" || type.endsWith("_identifier")) return "text-slate-600";
  if (type.includes("import")) return "text-emerald-600";
  if (type.includes("function") || type.includes("class")) return "text-blue-600";
  return "text-violet-600";
};

type TreeNodeProps = {
  node: TreeSitterAstNode;
  depth: number;
  selectedNode?: TreeSitterAstNode;
  hoveredNode?: TreeSitterAstNode;
  onSelectNode?: (node: TreeSitterAstNode) => void;
  onHoverNode?: (node?: TreeSitterAstNode) => void;
  code?: string;
  buildCuratedSections: (node: TreeSitterAstNode) => Array<{ key: string; items: TreeSitterAstNode[] }>;
  isYieldFrom: (node: TreeSitterAstNode, code?: string) => boolean;
  languageId?: string;
};

const TreeNode = memo(function TreeNode({
  node,
  depth,
  selectedNode,
  hoveredNode,
  onSelectNode,
  onHoverNode,
  code,
  buildCuratedSections,
  isYieldFrom,
  languageId,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isSelected = nodesEqual(selectedNode, node);
  const isHovered = nodesEqual(hoveredNode, node);

  const sections = buildCuratedSections(node).filter((s) => s.items.length > 0);
  const hasChildren = sections.length > 0;

  return (
    <div className="select-none">
      {/* Node row */}
      <div
        className={`flex items-center gap-1.5 py-1 px-1 rounded cursor-pointer transition-colors ${isSelected
          ? "bg-violet-100"
          : isHovered
            ? "bg-violet-50"
            : "hover:bg-slate-50"
          }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelectNode?.(node)}
        onMouseEnter={() => onHoverNode?.(node)}
        onMouseLeave={() => onHoverNode?.(undefined)}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            type="button"
            className="p-0.5 hover:bg-violet-100 rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 text-violet-400 transition-transform ${isExpanded ? "rotate-90" : ""
                }`}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}

        {/* Node icon */}
        {getNodeIcon(node.type)}

        {/* Node type display name */}
        <span className={`text-sm ${getNodeTextColor(node.type)}`}>
          {getNodeDisplayName(languageId, node.type)}
        </span>

        {/* Yield-from hint */}
        {isYieldFrom(node, code) && (
          <span className="ml-1 text-[10px] font-medium text-slate-400 uppercase">
            from
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {sections.map((section, sectionIdx) => (
            <div key={section.key}>
              {/* Section label */}
              <div
                className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-0.5"
                style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
              >
                {section.key}
              </div>

              {/* Section items */}
              {section.items.map((item, itemIdx) => (
                <TreeNode
                  key={nodeKey(item)}
                  node={item}
                  depth={depth + 1}
                  selectedNode={selectedNode}
                  hoveredNode={hoveredNode}
                  onSelectNode={onSelectNode}
                  onHoverNode={onHoverNode}
                  code={code}
                  buildCuratedSections={buildCuratedSections}
                  isYieldFrom={isYieldFrom}
                  languageId={languageId}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const AstChildrenSidebar = ({
  ast,
  selectedNode,
  hoveredNode,
  onSelectNode,
  onHoverNode,
  flattenRoot = false,
  code,
  fileName,
}: AstChildrenSidebarProps) => {
  const { curation } = getLanguageToolsForFileName(fileName);
  const buildCuratedSectionsShared = curation.buildCuratedSections;
  const isYieldFrom = curation.isYieldFrom || (() => false);
  const languageId = getLanguageIdFromFileName(fileName);

  // Typically the root is a `module` node; render it and its top-level children.
  const topLevel = ast.namedChildren || [];

  if (topLevel.length === 0) {
    return (
      <aside className="py-2">
        <p className="text-sm italic text-slate-400 px-2">No children</p>
      </aside>
    );
  }

  // When flattenRoot, skip the root and render children directly
  const nodesToRender = flattenRoot ? topLevel : [ast];

  return (
    <aside className="py-1">
      {nodesToRender.map((node) => (
        <TreeNode
          key={nodeKey(node)}
          node={node}
          depth={0}
          selectedNode={selectedNode}
          hoveredNode={hoveredNode}
          onSelectNode={onSelectNode}
          onHoverNode={onHoverNode}
          code={code}
          buildCuratedSections={buildCuratedSectionsShared}
          isYieldFrom={isYieldFrom}
          languageId={languageId}
        />
      ))}
    </aside>
  );
};
