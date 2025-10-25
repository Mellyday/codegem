<!-- 9dc5181f-05c5-41d8-9e79-cf4895f69631 8c08819b-4d72-43bb-b992-3d24d9f97e59 -->
# Add JS/TS/TSX via Tree-sitter (primary) + Babel fallback

## Goals

- Primary parser for .js/.jsx/.ts/.tsx is Tree-sitter; Babel is fallback.
- Curated AST sidebar and Lesson flow support JS, TS (types/interfaces/enums/generics), and JSX/TSX elements.
- Keep Python support intact; introduce language-specific curation/lesson modules.

## Install

- Dependencies:
  - tree-sitter-javascript (JavaScript/JSX)
  - tree-sitter-typescript (TypeScript & TSX)
- No new bundler plugins required (Vite already handles `?url` wasm assets).
```bash
npm i tree-sitter-javascript tree-sitter-typescript
```


## Architecture

- Parser/config layer: centralize Tree-sitter language registry and WASM wiring.
- Curation layer: per-language curated child sections for `AstChildrenSidebar`.
- Lesson planning: per-language `generateLessonPlan` strategies.
- Parse pipeline: try Tree-sitter first for js/ts/tsx; fall back to Babel.

## Project structure (new/updated files)

- src/lib/
  - languages/
    - treeSitterConfigs.ts
      - Registry of languages → wasm imports, extensions, display names, language IDs.
      - Imports:
        - tree-sitter-python.wasm
        - tree-sitter-javascript.wasm
        - tree-sitter-typescript.wasm
        - tree-sitter-tsx.wasm
    - index.ts
      - Re-exports for use by `treeSitter.ts`.
  - curation/
    - python.ts
      - Existing curated logic moved from `AstChildrenSidebar` into functions.
    - jsts.ts
      - Curated sections for: program, import/export, function/class decls, variable/const, call/member/subscript, if/for/while/switch/try, return/await, jsx_element/jsx_self_closing_element/jsx_fragment, ts: interface/type_alias/enum/type_parameters/type_annotation.
    - index.ts
      - `buildCuratedSections(node, languageId)` dispatcher.
  - lessons/
    - plannerPython.ts
      - Current logic moved here.
    - plannerJsTs.ts
      - Steps for: function/class headers, params/returns, control-flow conditions/bodies, module imports/exports, TS types/interfaces/enums, JSX elements.
    - index.ts
      - `generateLessonPlan(node, languageId, options)` dispatcher.
  - treeSitter.ts (update)
    - Replace hard-coded python config with registry from `languages/treeSitterConfigs.ts`.
    - Export `SupportedLanguageId` including 'javascript' | 'typescript' | 'tsx' | 'python'.
    - Map extensions: {js,cjs,mjs,jsx}→javascript, ts→typescript, tsx→tsx.
- src/components/
  - AstChildrenSidebar.tsx (update)
    - Accept `languageId?: string`.
    - Use `curation/buildCuratedSections(languageId)` instead of local Python-only logic.
  - LessonViewer.tsx (update)
    - Accept `languageId?: string`.
    - Use `lessons/generateLessonPlan(languageId)` and preserve masking logic (JS: header lines for if/loops/switch; TS: type/interface/enum names; JSX: opening tags).
- src/lib/ast.ts (update)
  - Change order: for extensions supported by Tree-sitter registry, try Tree-sitter first; on failure and if Babel supports ext, fall back to Babel.
  - Include `languageId` from Tree-sitter in success result (extend `ParseResult` type) so UI can pass it down.
- src/sandboxFiles.ts (no API change)
  - Already computes AST support; with new registry, js/ts/tsx will report `tree-sitter`.

## Key code touchpoints (illustrative)

- WASM imports in registry:
```ts
// src/lib/languages/treeSitterConfigs.ts
import jsWasmUrl from 'tree-sitter-javascript/tree-sitter-javascript.wasm?url'
import tsWasmUrl from 'tree-sitter-typescript/tree-sitter-typescript.wasm?url'
import tsxWasmUrl from 'tree-sitter-typescript/tree-sitter-tsx.wasm?url'
export const configs = [ /* ...python, js, ts, tsx... */ ]
```

- Parse preference in `ast.ts`:
```ts
// If extension is in Tree-sitter registry → try TS first, else Babel
```

- Propagation to UI:
```tsx
// SandboxViewer
<AstChildrenSidebar languageId={parseResult.parser==='tree-sitter' ? parseResult.languageId : undefined} />
<LessonViewer languageId={...} />
```


## UX/Behavior notes

- “Teach Me” button appears for js/ts/tsx (Tree-sitter) just like Python.
- Curated labels mirror existing style; add highlight heuristics for imports, functions, classes, jsx elements, and ts declarations.
- Lesson masks: hide `if/for/while/switch` keywords on header questions; for TS, hide `interface`, `type`, `enum` keywords accordingly.

## Test plan

- Add sample sandboxes under `code_sandbox/`:
  - demo_javascript.js, demo_typescript.ts, demo_tsx.tsx.
- Verify parsing, curated sidebar groups, lesson steps & masking, JSX rendering stability.

## Docs

- Update `README.md` and `config-languages.txt` to list JS/TS/TSX support and note Tree-sitter as primary, Babel fallback.

### To-dos

- [ ] Install tree-sitter-javascript and tree-sitter-typescript
- [ ] Add JS/TS/TSX wasm imports and registry config
- [ ] Refactor treeSitter.ts to use registry; add languageId to ParseResult
- [ ] Prefer Tree-sitter for js/ts/tsx in ast.ts; fallback to Babel
- [ ] Extract Python curation; implement JS/TS/TSX curation; add dispatcher
- [ ] Split lesson planner; add JS/TS/TSX planner; add dispatcher
- [ ] Pass languageId to Sidebar/LessonViewer; use new dispatchers
- [ ] Add demo JS/TS/TSX sandbox files
- [ ] Update README and config-languages.txt