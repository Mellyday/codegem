<!-- ac1512bd-2ad3-4f7f-a2ff-f5a3f1c1a94e 6a453436-e9c0-474e-8271-ebecce17498b -->
# AstChildrenSidebar language plugins + registry (extends JS/TS/TSX plan)

## What changes vs current plan

- The plan already:
  - Splits curation by language (`curation/python.ts`, `curation/jsts.ts`) and dispatches by `languageId`.
  - Keeps `AstChildrenSidebar` generic for sections.
- Missing pieces (now added):
  - Formal `LanguagePlugin` interface for per-language curation, highlighting, badges, and inline hints.
  - Small plugin registry keyed by `languageId`/`languageLabel`, with safe fallback.
  - Move Python-specific UI heuristics (e.g., "yield from") out of `AstChildrenSidebar` into `pythonPlugin`.

## Files and changes

- src/lib/curation/plugins/types.ts (new)
  - Define `SupportedLanguageId`, `CuratedSection`, `PluginContext`, and `LanguagePlugin` interface.
```ts
export type SupportedLanguageId = 'python' | 'javascript' | 'typescript' | 'tsx';
export type CuratedSection = { key: string; items: TreeSitterAstNode[] };
export type PluginContext = {
  root: TreeSitterAstNode;
  code?: string;
  languageId: SupportedLanguageId;
  parser: 'tree-sitter' | 'babel';
};
export interface LanguagePlugin {
  id: SupportedLanguageId;
  buildSections(node: TreeSitterAstNode, ctx: PluginContext): CuratedSection[];
  getNodeHighlight?(type: string, node: TreeSitterAstNode, ctx: PluginContext): string; // tailwind classes
  getNodeBadgeColor?(type: string, node: TreeSitterAstNode, ctx: PluginContext): string; // tailwind classes
  inlineHint?(node: TreeSitterAstNode, ctx: PluginContext): string | undefined; // e.g., 'from' or 'async'
}
```

- src/lib/curation/plugins/python.ts (new)
  - Move current Python `buildCuratedSections` logic from `AstChildrenSidebar.tsx` into `pythonPlugin.buildSections`.
  - Implement `inlineHint` with the previous `yield from` detection using `ctx.code`.
  - Optionally provide `getNodeHighlight`/`getNodeBadgeColor` if Python needs custom colors.

- src/lib/curation/plugins/javascript.ts (new)
  - Provide curated sections for imports/exports, function/class decls, vars/consts, calls/member/subscript, control flow, return/await, and (if applicable) JSX elements via a shared adapter or separate TSX plugin.
  - Provide lightweight `inlineHint` (e.g., 'async' for async functions) if desirable.

- src/lib/curation/plugins/typescript.ts and src/lib/curation/plugins/tsx.ts (new)
  - Extend `javascript` plugin or compose shared helpers; add TS constructs (interface/type_alias/enum/type_parameters/type_annotation) and JSX elements for TSX.

- src/lib/curation/plugins/index.ts (new)
  - Tiny registry: `{ pythonPlugin, javascriptPlugin, typescriptPlugin, tsxPlugin }`.
  - `getPlugin(languageId?: string)` with graceful fallback to a `defaultPlugin` that exposes `{ key: 'children', items: node.namedChildren ?? [] }` and default colors.

- src/lib/curation/index.ts (update)
  - Export thin delegates: `buildCuratedSections(node, ctx)`, `getNodeHighlight(type, node, ctx)`, `getNodeBadgeColor(...)`, `inlineHint(node, ctx)` that call the resolved plugin or fallback.

- src/components/AstChildrenSidebar.tsx (update)
  - Props: add `languageId?: SupportedLanguageId` and `parser?: 'tree-sitter' | 'babel'`.
  - Remove local `getNodeHighlight`, `getNodeBadgeColor`, and `isYieldFrom`; call plugin delegates from `src/lib/curation`.
  - Where the header or rows previously rendered the Python hint ("from"), call `inlineHint(node, ctx)` and render returned text if present.
  - Keep existing behavior: stable keys, hide empty sections.

- src/lib/treeSitter.ts (confirm/update)
  - Continue exporting `SupportedLanguageId` and mapping extensions to language ids.

- src/lib/ast.ts (update)
  - Ensure `ParseResult` includes `{ parser: 'tree-sitter' | 'babel', languageId?: SupportedLanguageId }` and plumb through to UI callers.

- src/components/SandboxViewer.tsx (update)
  - Pass `languageId` and `parser` from `parseResult` to `AstChildrenSidebar` (and `LessonViewer` as needed).

## Small, critical snippets

- AstChildrenSidebar usage change:
```tsx
import { buildCuratedSections, getNodeHighlight, getNodeBadgeColor, inlineHint } from '@/lib/curation';
// ...
const ctx = { root: ast, code, languageId: languageId ?? 'python', parser: parser ?? 'tree-sitter' };
const sections = buildCuratedSections(node, ctx).filter(s => s.items.length > 0);
// header highlight
const cardClasses = getNodeHighlight(node.type, node, ctx) ?? 'bg-slate-50 border-slate-200';
// per-row right label hint
const hint = inlineHint(node, ctx); // e.g., 'from' or 'async'
```


## Notes

- Keeps UI generic and future-proof; adding languages means adding a plugin and editing the registry only.
- Default/fallback plugin ensures safe behavior for unknown languages.
- Mirrors the plan’s Tree-sitter registry; this registry is for curation/UX behavior.

## Test plan

- Verify Python behavior unchanged (sections, colors, and 'yield from' hint now via plugin).
- Add simple JS/TS/TSX sandboxes and verify curated sections and hints (e.g., async hint) show.
- Ensure empty sections are hidden and keys remain stable.

### To-dos

- [ ] Add LanguagePlugin types and PluginContext in plugins/types.ts
- [ ] Create curation plugin registry and fallback default plugin
- [ ] Move Python curation and yield-from hint into pythonPlugin
- [ ] Implement javascriptPlugin curated sections and optional hints
- [ ] Implement typescript and tsx plugins or compose from JS
- [ ] Add delegates buildCuratedSections/getNodeHighlight/inlineHint
- [ ] Update AstChildrenSidebar to use plugin delegates and new props
- [ ] Ensure parse result provides parser/languageId; pass to Sidebar
- [ ] Add JS/TS/TSX demo sandboxes and verify UI behavior