import type { TreeSitterAstNode } from "../lib/treeSitter";
import { getLanguageToolsForFileName } from "../lib/languages/registry";

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

// Get highlight color based on node type (exact, intentional matches)
const getNodeHighlight = (type: string): string => {
  // Green for import statements
  if (type.startsWith("import"))
    return "bg-emerald-50/80 border-emerald-300/60";
  // Purple for classes
  if (type === "class_definition")
    return "bg-purple-50/80 border-purple-300/60";
  // Blue for functions
  if (type === "function_definition" || type === "function_declaration")
    return "bg-blue-50/80 border-blue-300/60";
  // Comments
  if (type === "comment") return "bg-slate-50/80 border-slate-300/60";
  // Default
  return "bg-white/80 border-slate-200/60";
};

const getNodeBadgeColor = (type: string): string => {
  // Green for import statements
  if (type.startsWith("import"))
    return "bg-emerald-100 text-emerald-700 border-emerald-300";
  // Purple for classes
  if (type === "class_definition")
    return "bg-purple-100 text-purple-700 border-purple-300";
  // Blue for functions
  if (type === "function_definition" || type === "function_declaration")
    return "bg-blue-100 text-blue-700 border-blue-300";
  // Comments
  if (type === "comment")
    return "bg-slate-100 text-slate-600 border-slate-300";
  // Package clause
  if (type === "package_clause")
    return "bg-amber-100 text-amber-700 border-amber-300";
  // Default
  return "bg-teal-50 text-teal-700 border-teal-200";
};

const NodeType = ({ type }: { type: string }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-medium shadow-sm ${getNodeBadgeColor(
      type
    )}`}
  >
    <span className="text-[10px] opacity-60">&lt;/&gt;</span>
    {type}
  </span>
);

// Yield helpers now imported from lib/pyCuration

// Curated logic now lives in src/lib/pyCuration

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

// FIX: Extracted ItemRowProps to resolve potential TS inference issues with inline props.
type ItemRowProps = {
  item: TreeSitterAstNode;
  rightLabel?: string;
  selectedNode?: TreeSitterAstNode;
  hoveredNode?: TreeSitterAstNode;
  onSelectNode?: (node: TreeSitterAstNode) => void;
  onHoverNode?: (node?: TreeSitterAstNode) => void;
};

// Compact row for a child item with an optional group label
const ItemRow = ({
  item,
  rightLabel,
  selectedNode,
  hoveredNode,
  onSelectNode,
  onHoverNode,
}: ItemRowProps) => {
  const isSelected = nodesEqual(selectedNode, item);
  const isHovered = nodesEqual(hoveredNode, item);
  return (
    <li
      className={
        "flex items-center gap-2 rounded-lg px-2 py-1.5 pl-4 cursor-pointer transition-all duration-150 " +
        (isSelected
          ? "ring-2 ring-teal-400 bg-teal-100/70 shadow-sm"
          : isHovered
            ? "bg-teal-50/80"
            : "hover:bg-slate-50/80")
      }
      onClick={() => onSelectNode?.(item)}
      onMouseEnter={() => onHoverNode?.(item)}
      onMouseLeave={() => onHoverNode?.(undefined)}
    >
      <NodeType type={item.type} />
      {rightLabel && (
        <span className="ml-auto text-[10px] font-medium text-slate-500 uppercase tracking-wide">
          {rightLabel}
        </span>
      )}
    </li>
  );
};

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
  // Typically the root is a `module` node; render it and its top-level children.
  const topLevel = ast.namedChildren || [];

  return (
    <aside className="space-y-2">
      {flattenRoot ? (
        // Start one level lower: render only the root's children
        topLevel.length === 0 ? (
          <div className="rounded-xl border border-slate-200/60 bg-white/60 px-4 py-4 shadow-sm backdrop-blur-sm">
            <p className="text-sm italic text-slate-400">No children</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {topLevel.map((node, i) => {
              const sections = buildCuratedSectionsShared(node)
                // Hide empty sections entirely (e.g. empty decorator_list)
                .filter((s) => s.items.length > 0);

              // Inline hint sections: only show label once, no rows (e.g., body -> block)
              const inlineHints = sections.filter(
                (s) =>
                  s.key === "body" || s.items.every((it) => it.type === "block")
              );

              // Groups we actually list rows for
              const flatGroups = sections.filter(
                (s) => !inlineHints.includes(s)
              );
              const isSelected = nodesEqual(selectedNode, node);
              const isHovered = nodesEqual(hoveredNode, node);
              return (
                <li
                  key={nodeKey(node)}
                  className={
                    `rounded-xl border shadow-sm backdrop-blur-sm transition-all duration-150 ${getNodeHighlight(
                      node.type
                    )} ` +
                    (isSelected
                      ? "ring-2 ring-teal-400 shadow-md"
                      : isHovered
                        ? "ring-1 ring-teal-300/50"
                        : "")
                  }
                >
                  <div
                    className="flex items-center gap-2 px-3 py-2.5"
                    onMouseEnter={() => onHoverNode?.(node)}
                    onMouseLeave={() => onHoverNode?.(undefined)}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center"
                      onClick={(e) => {
                        e.preventDefault();
                        onSelectNode?.(node);
                      }}
                    >
                      <NodeType type={node.type} />
                    </button>
                    {/* Yield-from hint on header */}
                    {isYieldFrom(node, code) && (
                      <span className="ml-auto text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                        from
                      </span>
                    )}
                  </div>
                  {flatGroups.length > 0 && (
                    <ul className="space-y-1 border-l-2 border-teal-200/50 bg-white/40 mx-3 mb-3 px-3 py-2 rounded-lg">
                      {flatGroups.map((group, gIdx) =>
                        group.items.map((item, idx) => {
                          const labelBase =
                            idx === 0
                              ? gIdx === 0 && inlineHints.length > 0
                                ? inlineHints.map((s) => s.key).join(" · ")
                                : group.key
                              : undefined;
                          const label =
                            labelBase &&
                              group.key === "value" &&
                              isYieldFrom(node, code)
                              ? `${labelBase} · from`
                              : labelBase;
                          return (
                            <ItemRow
                              key={`${nodeKey(item)}:${gIdx}:${idx}`}
                              item={item}
                              rightLabel={label}
                              selectedNode={selectedNode}
                              hoveredNode={hoveredNode}
                              onSelectNode={onSelectNode}
                              onHoverNode={onHoverNode}
                            />
                          );
                        })
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        // Render the root wrapper and its children
        <div className="rounded-xl border border-slate-200/60 bg-white/60 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/40">
            <span className="font-mono text-sm font-semibold text-slate-700">
              {ast.type}
            </span>
            <span className="ml-auto rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
              {topLevel.length} children
            </span>
          </div>
          {topLevel.length === 0 ? (
            <div className="px-4 py-4">
              <p className="text-sm italic text-slate-400">No children</p>
            </div>
          ) : (
            <ul className="space-y-2 p-3">
              {topLevel.map((node, i) => {
                const sections = buildCuratedSectionsShared(node).filter(
                  (s) => s.items.length > 0
                );

                const inlineHints = sections.filter(
                  (s) =>
                    s.key === "body" ||
                    s.items.every((it) => it.type === "block")
                );
                const flatGroups = sections.filter(
                  (s) => !inlineHints.includes(s)
                );
                const isSelected = nodesEqual(selectedNode, node);
                const isHovered = nodesEqual(hoveredNode, node);
                return (
                  <li
                    key={nodeKey(node)}
                    className={
                      `rounded-xl border shadow-sm backdrop-blur-sm transition-all duration-150 ${getNodeHighlight(
                        node.type
                      )} ` +
                      (isSelected
                        ? "ring-2 ring-teal-400 shadow-md"
                        : isHovered
                          ? "ring-1 ring-teal-300/50"
                          : "")
                    }
                  >
                    <div
                      className="flex items-center gap-2 px-3 py-2.5"
                      onMouseEnter={() => onHoverNode?.(node)}
                      onMouseLeave={() => onHoverNode?.(undefined)}
                    >
                      <button
                        type="button"
                        className="inline-flex items-center"
                        onClick={(e) => {
                          e.preventDefault();
                          onSelectNode?.(node);
                        }}
                      >
                        <NodeType type={node.type} />
                      </button>
                      {/* Yield-from hint on header */}
                      {isYieldFrom(node, code) && (
                        <span className="ml-auto text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                          from
                        </span>
                      )}
                    </div>
                    {flatGroups.length > 0 && (
                      <ul className="space-y-1 border-l-2 border-teal-200/50 bg-white/40 mx-3 mb-3 px-3 py-2 rounded-lg">
                        {flatGroups.map((group, gIdx) =>
                          group.items.map((item, idx) => {
                            const labelBase =
                              idx === 0
                                ? gIdx === 0 && inlineHints.length > 0
                                  ? inlineHints.map((s) => s.key).join(" · ")
                                  : group.key
                                : undefined;
                            const label =
                              labelBase &&
                                group.key === "value" &&
                                isYieldFrom(node, code)
                                ? `${labelBase} · from`
                                : labelBase;
                            return (
                              <ItemRow
                                key={`${nodeKey(item)}:${gIdx}:${idx}`}
                                item={item}
                                rightLabel={label}
                                selectedNode={selectedNode}
                                hoveredNode={hoveredNode}
                                onSelectNode={onSelectNode}
                                onHoverNode={onHoverNode}
                              />
                            );
                          })
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
};
