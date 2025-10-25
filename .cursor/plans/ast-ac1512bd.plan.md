<!-- ac1512bd-2ad3-4f7f-a2ff-f5a3f1c1a94e 1905f8e2-8124-4f74-9370-a7e307790ff2 -->
# Add JS/TS/TSX via Tree-sitter (primary) + Babel fallback, with Language Plugins

## Goals

- Primary parser for .js/.jsx/.ts/.tsx is Tree-sitter; Babel is fallback.
- Curated AST sidebar and Lesson flow support JS, TS (types/interfaces/enums/generics), and JSX/TSX.
- Keep Python support intact; introduce language-specific curation and lesson modules.
- Keep `AstChildrenSidebar` UI generic; move CST→sections, highlights, badges, and per-node inline hints into language plugins behind a small registry.

## Install

- Dependencies:
  - tree-sitter-javascript (JavaScript/JSX)
  - tree-sitter-typescript (TypeScript & TSX)
```bash
npm i tree-sitter-javascript tree-sitter-typescript
```


## Architecture

- Parse/config layer (Tree-sitter languages): registry maps file extension → Tree-sitter language + wasm urls.
- Curation layer (new): language plugin registry maps `languageId` → `LanguagePlugin` providing curated sections, optional highlight/badge classes, and inline hints.
- Lesson planning layer: per-language `generateLessonPlan` strategies.
- Parse pipeline: for js/ts/tsx, try Tree-sitter first; on failure and if Babel supports ext, fall back to Babel. Always return `{ parser, languageId? }` in parse result so UI can pick plugins.

## Project structure (new/updated files)

- src/lib/
  - languages/
    - treeSitterConfigs.ts (new)
      - Map of supported languages → wasm imports, extensions, display names, language IDs.
      - Imports:
        - tree-sitter-python.wasm (already present)
        - tree-sitter-javascript.wasm
        - tree-sitter-typescript.wasm
        - tree-sitter-tsx.wasm
  - curation/
    - plugins/
      - types.ts (new) — `LanguagePlugin`, `PluginContext`, `CuratedSection`.
      - python.ts (new) — Python plugin; migrate current Python curation + "yield from" inline hint.
      - javascript.ts (new) — JS plugin; imports/exports, decls, calls/member/subscript, control flow, return/await.
      - typescript.ts (new) — TS plugin; adds interfaces/types/enums/type params/annotations.
      - tsx.ts (new) — TSX/JSX nodes (jsx_element, self-closing, fragment), composes TS/JS where helpful.
      - index.ts (new) — tiny plugin registry + safe default plugin.
    - index.ts (new) — thin delegates calling resolved plugin: `buildCuratedSections`, `getNodeHighlight`, `getNodeBadgeColor`, `inlineHint`.
  - lessons/
    - plannerPython.ts (new) — moved/cleaned from existing logic.
    - plannerJsTs.ts (new) — function/class headers, params/returns, control flow, imports/exports, TS types, JSX.
    - index.ts (new) — `generateLessonPlan(node, languageId, options)` dispatcher.
  - treeSitter.ts (update)
    - Use `languages/treeSitterConfigs.ts` to instantiate parsers dynamically; export `SupportedLanguageId` including 'javascript' | 'typescript' | 'tsx' | 'python'.
  - ast.ts (update)
    - Prefer Tree-sitter by extension; on error fall back to Babel; include `{ parser: 'tree-sitter'|'babel', languageId? }` in success.
- src/components/
  - AstChildrenSidebar.tsx (update)
    - Props: add `languageId?: string`, `parser?: 'tree-sitter'|'babel'`.
    - Remove Python-specific logic; call curation delegates for sections, colors, and inline hints.
  - LessonViewer.tsx (update)
    - Accept `languageId?: string` and use `lessons/generateLessonPlan(languageId)`; preserve masking logic (JS: headers for if/loops/switch; TS: type/interface/enum names; JSX: opening tags).
  - SandboxViewer.tsx (update)
    - Pass `languageId` and `parser` from parse result down to `AstChildrenSidebar` and `LessonViewer`.

## Key code touchpoints

- WASM imports in registry:
```ts
// src/lib/languages/treeSitterConfigs.ts
import jsWasmUrl from 'tree-sitter-javascript/tree-sitter-javascript.wasm?url'
import tsWasmUrl from 'tree-sitter-typescript/tree-sitter-typescript.wasm?url'
import tsxWasmUrl from 'tree-sitter-typescript/tree-sitter-tsx.wasm?url'
export const configs = [ /* python, javascript, typescript, tsx */ ]
```

- Language plugin interface:
```ts
// src/lib/curation/plugins/types.ts
export interface LanguagePlugin {
  id: SupportedLanguageId
  buildSections(node: TreeSitterAstNode, ctx: PluginContext): CuratedSection[]
  getNodeHighlight?(type: string, node: TreeSitterAstNode, ctx: PluginContext): string
  getNodeBadgeColor?(type: string, node: TreeSitterAstNode, ctx: PluginContext): string
  inlineHint?(node: TreeSitterAstNode, ctx: PluginContext): string | undefined
}
```

- Sidebar delegates usage:
```tsx
// src/components/AstChildrenSidebar.tsx
import { buildCuratedSections, getNodeHighlight, getNodeBadgeColor, inlineHint } from '@/lib/curation'
// ...
const ctx = { root: ast, code, languageId, parser }
const sections = buildCuratedSections(node, ctx).filter(s => s.items.length > 0)
const cardClasses = getNodeHighlight(node.type, node, ctx) ?? 'bg-slate-50 border-slate-200'
const badgeClasses = getNodeBadgeColor(node.type, node, ctx) ?? 'bg-slate-100 text-slate-700 border-slate-200'
const hint = inlineHint(node, ctx) // e.g., 'from' for Python yield-from, or 'async'
```


## UX/Behavior notes

- “Teach Me” button appears for js/ts/tsx (Tree-sitter) just like Python.
- Curated labels mirror existing style; highlight heuristics via plugin (imports green, classes purple, functions/keywords blue by default plugin or language customization).
- Lesson masks per language (hide `if/for/while/switch` keywords on header questions; for TS, hide `interface`/`type`/`enum` accordingly; JSX: opening tags).
- Preserve spec: stable section keys; hide empty sections entirely.

## Test plan

- Add sample sandboxes under `code_sandbox/`:
  - demo_javascript.js, demo_typescript.ts, demo_tsx.tsx.
- Verify parsing order and Babel fallback.
- Validate curated sidebar groups per language and per-node hints (Python: yield from; JS: async if desired).
- Verify JSX/TSX elements render stably.
- Verify lesson steps & masking.

## Docs

- Update `README.md` and `config-languages.txt` to list JS/TS/TSX support; note Tree-sitter as primary, Babel fallback; explain plugin architecture for curation.

## To-dos

- [ ] Install tree-sitter-javascript and tree-sitter-typescript
- [ ] Add JS/TS/TSX wasm imports and registry config (languages/treeSitterConfigs.ts)
- [ ] Refactor treeSitter.ts to use registry; add languageId to ParseResult
- [ ] Prefer Tree-sitter for js/ts/tsx in ast.ts; fallback to Babel; return parser+languageId
- [ ] Create curation plugin types and plugin registry with default fallback
- [ ] Migrate Python curation and yield-from hint into pythonPlugin
- [ ] Implement javascriptPlugin curated sections (and optional async hint)
- [ ] Implement typescript and tsx plugins (TS constructs + JSX)
- [ ] Add curation delegates (buildSections, highlight/badge, inlineHint)
- [ ] Update AstChildrenSidebar to use delegates; add languageId/parser props
- [ ] Update LessonViewer to accept languageId and use per-language planner
- [ ] Pass parseResult.languageId/parser from SandboxViewer
- [ ] Add demo JS/TS/TSX sandbox files
- [ ] Update README and config-languages.txt

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