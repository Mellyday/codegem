<!-- d00aa49f-c13c-40ab-9e8c-65e6657b90f1 a8b8799f-adbb-4bec-abf8-259a751bfbf5 -->
# Add Go, C, C++, Rust, Ruby, Kotlin, PHP via Tree-sitter

## Scope

- Add 7 languages: Go, C, C++, Rust, Ruby, Kotlin, PHP
- Extend the enacted JS/TS/TSX architecture: central registry, per-language curation, per-language lesson planners
- Keep `AstChildrenSidebar.tsx` and `LessonViewer.tsx` thin; move/keep language-specific logic in `src/lib`

## Packages

- Install parsers:
  - `tree-sitter-go`, `tree-sitter-c`, `tree-sitter-cpp`, `tree-sitter-rust`, `tree-sitter-ruby`, `tree-sitter-php`
  - Kotlin: grammar is community-maintained. Common options: `fwcd/tree-sitter-kotlin` or `igl360/tree-sitter-kotlin`. Choose one and validate node types.

## Parser Registry

- File: `src/lib/languages/treeSitterConfigs.ts`
- Add entries mapping file extensions → languageId and WASM URLs.
- Example entry (pattern only):
```ts
// languages/treeSitterConfigs.ts (excerpt)
export const configs = [
  // ...existing
  {
    id: 'go',
    display: 'Go',
    extensions: ['.go'],
    wasmUrl: () => import('tree-sitter-go/tree-sitter-go.wasm?url'),
    moduleName: 'tree-sitter-go',
  },
]
```

- Update `SupportedLanguageId` in `src/lib/treeSitter.ts` and ensure `ast.ts` maps `.go, .c, .h, .cpp, .cc, .cxx, .hpp, .hh, .hxx, .rs, .rb, .kt, .kts, .php` to these ids.

## Curation (sidebar) per-language

- Files: `src/lib/curation/`
  - `go.ts`, `c.ts`, `cpp.ts`, `rust.ts`, `ruby.ts`, `kotlin.ts`, `php.ts`
  - Export `buildCuratedSections(node: TreeSitterAstNode): CuratedSection[]`
- Dispatcher: `src/lib/curation/index.ts`
  - `buildCuratedSections(node, languageId)` → routes to the correct module
- Curate common groups: declarations (functions/classes/types), imports/includes/uses, control-flow headers/bodies, calls/members/subscripts, literals/collections
- Suggested node-type anchors by language:
  - Go: `function_declaration`, `method_declaration`, `type_declaration`, `import_declaration`, `short_var_declaration`, `const_declaration`, `if_statement`, `for_statement`, `switch_statement`, `call_expression`, `selector_expression`, `composite_literal`
  - C: `function_definition`, `declaration`, `init_declarator`, `preproc_include`, `if_statement`, `for_statement`, `while_statement`, `do_statement`, `switch_statement`, `call_expression`, `field_expression`
  - C++: `function_definition`, `class_specifier`, `template_declaration`, `namespace_definition`, `using_declaration`, `if_statement`, `for_range_loop`, `call_expression`, `field_expression`, `qualified_identifier`
  - Rust: `function_item`, `struct_item`, `enum_item`, `impl_item`, `use_declaration`, `let_declaration`, `if_expression`, `match_expression`, `loop_expression`, `for_expression`, `call_expression`, `field_expression`
  - Ruby: `method`, `class`, `module`, `alias`, `if`, `elsif`, `unless`, `while`, `until`, `for`, `case`, `call`, `call_method`, `binary`, `hash`, `array`
  - Kotlin: `function_declaration`, `class_declaration`, `object_declaration`, `type_alias`, `import_list`/`import_header`, `if_expression`, `when_expression`, `for_statement`, `while_statement`, `call_expression`, `navigation_expression`
  - PHP: `function_definition`, `class_declaration`, `interface_declaration`, `trait_declaration`, `namespace_definition`, `use_declaration`, `if_statement`, `while_statement`, `for_statement`, `foreach_statement`, `switch_statement`, `function_call_expression`, `member_access_expression`

## Lessons per-language

- Files: `src/lib/lessons/`
  - `plannerGo.ts`, `plannerC.ts`, `plannerCpp.ts`, `plannerRust.ts`, `plannerRuby.ts`, `plannerKotlin.ts`, `plannerPhp.ts`
  - Export `generateLessonPlan(node, options)` returning `LessonStep[]` with `semanticRole` tags like `function_signature`, `if_condition`, `loop_header`, `type_decl`, `import`, etc.
- Dispatcher: `src/lib/lessons/index.ts` to route by `languageId`.
- Masking strategy:
  - Move header masking logic out of the component into `src/lib/lessons/maskers.ts` and expose `maskAndAnswerForStep(languageId, step, root, code)`
  - Per-language header node types:
    - Go: `if_statement`, `for_statement`, `switch_statement`
    - C/C++: `if_statement`, `for_statement`, `while_statement`, `do_statement`, `switch_statement`
    - Rust: `if_expression`, `match_expression`, `loop_expression`, `for_expression`, `while_expression`
    - Ruby: `if`/`elsif`/`unless`, `while`, `until`, `for`, `case`
    - Kotlin: `if_expression`, `when_expression`, `for_statement`, `while_statement`, `do_while_statement`
    - PHP: `if_statement`, `while_statement`, `for_statement`, `foreach_statement`, `switch_statement`

## Component Integration

- `src/components/AstChildrenSidebar.tsx`
  - Accept `languageId?: SupportedLanguageId`
  - Replace inline `buildCuratedSections` with `curation/buildCuratedSections(node, languageId)`
  - Replace Python-specific hints (e.g., yield-from) with `curation.getRightHint(node, code, languageId)` (optional)
- `src/components/LessonViewer.tsx`
  - Accept `languageId?: SupportedLanguageId`
  - Use `lessons/generateLessonPlan(root, languageId, { includeNames: false })`
  - Replace local `maskAndAnswerForStep` with `lessons/maskAndAnswerForStep(languageId, step, root, code)`; keep “Save Custom Quiz” as-is (generic)

## Parser Preference

- `src/lib/ast.ts`: for these extensions, prefer Tree-sitter; there is no Babel fallback.

## Samples & Docs

- Add example files in `code_sandbox/`:
  - `demo.go`, `demo.c`, `demo.cpp`, `demo.rs`, `demo.rb`, `demo.kt`, `demo.php`
- Update `README.md` and `config-languages.txt` to list new support and any caveats

## References (CST / node types)

- Tree-sitter docs: `https://tree-sitter.github.io/tree-sitter/using-parsers#node-types`
- Go: `https://github.com/tree-sitter/tree-sitter-go` (see `src/node-types.json`)
- C: `https://github.com/tree-sitter/tree-sitter-c` (see `src/node-types.json`)
- C++: `https://github.com/tree-sitter/tree-sitter-cpp` (see `src/node-types.json`)
- Rust: `https://github.com/tree-sitter/tree-sitter-rust` (see `src/node-types.json`)
- Ruby: `https://github.com/tree-sitter/tree-sitter-ruby` (see `src/node-types.json`)
- PHP: `https://github.com/tree-sitter/tree-sitter-php` (see `src/node-types.json`)
- Kotlin (community):
  - `https://github.com/fwcd/tree-sitter-kotlin` (check `src/node-types.json`)
  - Alternative: `https://github.com/igl360/tree-sitter-kotlin`
- AST exploration: `https://astexplorer.net` (Tree-sitter mode for many languages)

## Notes

- Some grammars publish WASM; if not, build WASM locally and import via `public/wasm/` fallback in the registry.
- Kotlin grammar quality varies; validate chosen repo’s node types and queries.

### To-dos

- [ ] Install tree-sitter parsers for Go, C, C++, Rust, Ruby, PHP, Kotlin
- [ ] Add registry entries and wasm imports for 7 languages
- [ ] Extend SupportedLanguageId and extension mappings
- [ ] Implement curation modules per-language and dispatcher
- [ ] Implement lesson planners per-language and dispatcher
- [ ] Extract header masking to language-aware maskers
- [ ] Wire AstChildrenSidebar to curation dispatcher
- [ ] Wire LessonViewer to lessons dispatcher and maskers
- [ ] Add demo files and update README/config-languages