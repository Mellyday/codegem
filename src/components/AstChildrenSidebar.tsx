import type { TreeSitterAstNode } from "../lib/treeSitter";
import {
  buildCuratedSections as buildCuratedSectionsShared,
  isYieldFrom,
} from "../lib/pyCuration";

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
};

// Get highlight color based on node type (exact, intentional matches)
const getNodeHighlight = (type: string): string => {
  // Green for import statements
  if (type.startsWith("import")) return "bg-green-50 border-green-200";
  // Purple for classes
  if (type === "class_definition") return "bg-purple-50 border-purple-200";
  // Blue for functions
  if (type === "function_definition") return "bg-blue-50 border-blue-200";
  // Default
  return "bg-slate-50 border-slate-200";
};

const getNodeBadgeColor = (type: string): string => {
  // Green for import statements
  if (type.startsWith("import"))
    return "bg-green-100 text-green-700 border-green-200";
  // Purple for classes
  if (type === "class_definition")
    return "bg-purple-100 text-purple-700 border-purple-200";
  // Blue for functions
  if (type === "function_definition")
    return "bg-blue-100 text-blue-700 border-blue-200";
  // Default
  return "bg-slate-100 text-slate-700 border-slate-200";
};

const NodeType = ({ type }: { type: string }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${getNodeBadgeColor(
      type
    )}`}
  >
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
        "flex items-center gap-2 rounded px-2 py-1 pl-4 cursor-pointer " +
        (isSelected
          ? "ring-2 ring-amber-400 bg-amber-100/60"
          : isHovered
          ? "bg-amber-50"
          : "hover:bg-slate-50")
      }
      onClick={() => onSelectNode?.(item)}
      onMouseEnter={() => onHoverNode?.(item)}
      onMouseLeave={() => onHoverNode?.(undefined)}
    >
      <NodeType type={item.type} />
      {rightLabel && (
        <span className="ml-auto text-[10px] font-medium text-slate-500 text-right">
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
}: AstChildrenSidebarProps) => {
  // Typically the root is a `module` node; render it and its top-level children.
  const topLevel = ast.namedChildren || [];

  return (
    <aside className="space-y-3">
      {flattenRoot ? (
        // Start one level lower: render only the root's children
        topLevel.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm">
            <p className="text-xs italic text-slate-400">No children</p>
          </div>
        ) : (
          <ul className="space-y-3">
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
                    `rounded-lg border shadow-sm ${getNodeHighlight(
                      node.type
                    )} ` +
                    (isSelected
                      ? "ring-2 ring-amber-400 bg-amber-100/70"
                      : isHovered
                      ? "bg-amber-50"
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
                      <span className="ml-auto text-[10px] font-medium text-slate-500">
                        from
                      </span>
                    )}
                  </div>
                  {flatGroups.length > 0 && (
                    <ul className="space-y-1 border-l border-slate-200 bg-white/50 px-3 py-2">
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
                  {flatGroups.length > 0 && (
                    <div className="mx-3 mb-2 border-t border-slate-200" />
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : (
        // Render the root wrapper and its children
        <div className="rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-700">
              {ast.type}
            </span>
            <span className="ml-auto text-[11px] font-medium text-slate-500">
              [{topLevel.length}]
            </span>
          </div>
          {topLevel.length === 0 ? (
            <div className="px-3 py-3">
              <p className="text-xs italic text-slate-400">No children</p>
            </div>
          ) : (
            <ul className="space-y-3 bg-white/50 px-3 py-3">
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
                      `rounded-lg border shadow-sm ${getNodeHighlight(
                        node.type
                      )} ` +
                      (isSelected
                        ? "ring-2 ring-amber-400 bg-amber-100/70"
                        : isHovered
                        ? "bg-amber-50"
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
                        <span className="ml-auto text-[10px] font-medium text-slate-500">
                          from
                        </span>
                      )}
                    </div>
                    {flatGroups.length > 0 && (
                      <ul className="space-y-1 border-l border-slate-200 bg-white/50 px-3 py-2">
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
                    {flatGroups.length > 0 && (
                      <div className="mx-3 mb-2 border-t border-slate-200" />
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
