# C Engine Spec (v1)

This document specifies the C equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines:
- anchor steps + traversal order
- curated sections + header/body spans
- quiz rules (`shallow` vs `deep`)
- grouping for `#include` runs
- overlap/duplicate guard (reuse Python policy)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Mirror Python’s architecture for C:
  - steps are statement/declaration-level, not expression-level
  - curated sections hide declarator complexity behind stable keys
  - `deep` drills into types, declarators, and common expression shapes (calls, member access)
  - group contiguous `#include` directives into an `import_group` step
- Cover common C constructs:
  - preprocessor includes
  - function definitions + prototypes
  - variable declarations (global/local), initializers
  - structs/unions/enums/typedefs
  - control flow (`if`, `for`, `while`, `do`, `switch`, `return`, `break`, `continue`, `goto`)

### Non-goals (v1)
- Macro expansion understanding (preprocessor semantics).
- Full type-checking or symbol resolution.
- Perfect support for every declarator edge case on day 1 (function pointers, complex arrays) — but the spec calls out how to approach them.

---

## 1) Folder Layout

- `src/lib/languages/c/cCuration.ts`
- `src/lib/languages/c/cEngine.ts`
- `src/lib/languages/c/specs/engine_spec.md` (this doc)

Export parity with Python:
- `generateEngineSteps`, `maskAndAnswerForStep`, `buildCustomQuizPayload`

---

## 2) Parsing Integration

C parsing requires:
- Server: add `tree-sitter-c` and wire into `src/lib/parser/treeSitterServer.ts`.
- Client: add C WASM grammar and wire into `src/lib/treeSitter.ts` (optional).

Recommended extensions:
- `.c`, `.h`

---

## 3) Core Concepts

Same as Python:
- anchors produce steps
- curated sections drive quiz rules and span computation
- overlap guard removes redundant questions

Header questions must be recognizable:
- Stem: `Write the full header line`
- Generator rule: `header.line`

In C, “headers” include:
- function signatures before `{`
- `if (...)` / `for (...)` / `while (...)` / `switch (...)`
- `case <expr>:` / `default:`

---

## 4) Canonical Node Vocabulary (verify + alias)

Confirm node types from the C grammar you ship; common `tree-sitter-c` concepts:
- Root: `translation_unit`
- preprocessor: `preproc_include`, `preproc_def`, `preproc_if` (varies)
- declarations: `function_definition`, `declaration`, `type_definition`
- statement blocks: `compound_statement`
- control flow: `if_statement`, `for_statement`, `while_statement`, `do_statement`, `switch_statement`, `case_statement`, `labeled_statement`
- statements: `return_statement`, `break_statement`, `continue_statement`, `goto_statement`, `expression_statement`
- expressions: `call_expression`, `binary_expression`, `unary_expression`, `assignment_expression`, `field_expression`, `subscript_expression`, `cast_expression`

Declarators are often nested nodes; implement helper extraction (see §6.2).

---

## 5) Engine Traversal Spec (`cEngine.ts`)

### 5.1 Statement extraction and filtering
Walk:
- `translation_unit` → top-level declarations/directives
- `compound_statement` → statements and declarations
- `switch_statement` → case/default clauses and their statements

Filter out:
- comments

### 5.2 Anchor node types (v1)

File scope:
- `preproc_include` (usually suppressed by `import_group`)
- `function_definition`
- `declaration` (global vars)
- `type_definition` / `struct_specifier` / `enum_specifier` (depending on grammar)

Block scope:
- `declaration` (local variables)
- control flow statements
- `return_statement`, `break_statement`, `continue_statement`, `goto_statement`
- `expression_statement`

### 5.3 Diggability and traversal
Diggable when the node contains child anchors in its body:
- `function_definition` (body is `compound_statement`)
- `if`/`for`/`while`/`do`/`switch` (their statement bodies)
- `case`/`default` labels (their statement lists)

Traversal order:
- emit anchor step
- then walk the nested body/clauses in source order

### 5.4 Include grouping (required)
Group contiguous `preproc_include` directives into a virtual `import_group`.

Virtual node:
- `type: "import_group"`
- span: first include start → last include end
- `isVirtual: true`

Child steps:
- one per include directive with `generateQuiz:false`

Grouped questions (see §7.2):
- `Which headers are included here?` (multi; `stdio.h`, `"my.h"`, etc.)
- Deep-only: distinguish system vs local includes (`<...>` vs `"..."`)

### 5.5 Fallback quiz
Same as Python: only allow “What comes next?” fallback for leaf-y anchors with no rules and no quiz-worthy children.

---

## 6) Curation Spec (`cCuration.ts`)

### 6.1 Includes (`preproc_include`)
Keys:
- `path`: the included header token/string
- `is_system`: boolean (angle brackets) via heuristic

### 6.2 Declarator helpers (must-have)
C declarators are nested; implement helpers:
- `extractDeclaredNames(declarationNode, code) => string[]`
- `extractDeclaratorName(declaratorNode, code) => string | undefined`
- `extractDeclaredTypeText(declarationNode, code) => string` (best-effort)

These helpers must handle:
- pointers (`*`)
- arrays (`[]`)
- function declarators (prototypes)
- grouped declarators: `int a, *p, f(int);`

### 6.3 `function_definition`
Keys:
- `name` (from declarator)
- `params` (parameter list)
- `return_type` (best-effort from type specifiers)
- `body` (`compound_statement`)

### 6.4 `declaration`
Keys:
- `names` (multi)
- `type` (best-effort)
- `initializers` (map name → initializer expression text when present)

### 6.5 Struct/enum types
Expose:
- `struct_name` / `enum_name` (optional)
- `fields` (for structs)
- `enumerators` (for enums; with optional explicit values)

### 6.6 Control flow
`if_statement`:
- `condition`
- `then`
- `else` (optional)

`for_statement`:
- `init`, `condition`, `update`, `body`

`while_statement` / `do_statement`:
- `condition`, `body`

`switch_statement`:
- `value`
- `cases` (case/default)

Case/default:
- `label` (`case <expr>` or `default`)
- `body` (statements following the label)

### 6.7 High-signal expressions (deep-only)
Provide curated keys for:
- `call_expression`: `callee`, `args`
- `field_expression`: `object`, `field` (and `->` vs `.` via heuristic)
- `subscript_expression`: `array`, `index`
- `assignment_expression`: `left`, `right`, `operator`
- `binary_expression`: `left`, `operator`, `right`
- `unary_expression`: `operator`, `operand`

---

## 7) Quiz Rules Spec

### 7.1 Header questions
For nodes with header/body boundaries:
- Stem: `Write the full header line`
- Generator rule: `header.line`
- Answer: slice to body start

Applies to:
- function definitions
- if/for/while/do/switch
- case/default labels (if you can compute a header span to `:`)

### 7.2 Include group (`import_group`)
Always:
- multi-select: `Which headers are included here?`

Deep:
- `Which of these are system includes (<...>)?` (multi)

### 7.3 Functions
Always:
- header question
- `What is the function name?`
- multi-select: `Which parameters does this function take?` (names)

Deep:
- return type question (best-effort)
- per-parameter type questions (best-effort)
- variadic `...` detection

### 7.4 Declarations (vars/typedefs)
Always:
- multi-select: `Which names are declared here?`
- `What is the declared base type?` (best-effort)

Deep:
- per-name initializer questions when present
- pointer/array declarator shape questions (limited; avoid overwhelming)

### 7.5 Structs/enums
Struct:
- `Which fields are declared?` (multi)
- deep: field type questions

Enum:
- `Which enumerators are declared?` (multi)
- deep: explicit value questions (where present)

### 7.6 Control flow
If/loops/switch:
- header questions
- deep: condition/value expressions

Switch cases:
- `Which case labels exist?` (multi; include `default`)

### 7.7 Returns and branches
`return_statement`:
- if value exists: `What value is returned?`

`goto_statement`:
- `What label is jumped to?`

`break`/`continue`:
- mostly Yes/No “which keyword” (or skip by default in shallow)

### 7.8 Expression statements
If it’s an assignment:
- LHS/RHS

If it’s a call:
- `What function is called?`
- deep: argument #1/#2 (limit)

### 7.9 Designated initializers (`initializer_list`)
C designated initializers (e.g., `{.x = 1, .y = 2}` or `{[0] = 1, [1] = 2}`) generate questions about their structure.

Always:
- Multi-select: `Which designators are present in this initializer?`
  - Extracts field designators (`.field`) and array designators (`[index]`)
  - For initializers with >6 designators, split into multiple cards (3-6 correct per card)
  - Option pool drawn from surrounding code + generic identifiers

Deep:
- Per designator-value pair: `What is the value for <designator>?`
  - Recursively generates questions for nested initializer lists
  - Nested questions prefixed with `For <designator>: <original stem>`

Initializer lists are detected and processed in:
- Variable declarations with struct/array initializers
- Compound literals (`(struct Point){.x = 1, .y = 2}`)

---

## 8) Shallow vs Deep Summary

Shallow:
- includes, function headers, declared names, high-level control flow

Deep:
- types (best-effort), params, initializers
- limited drilling into calls/operands/member access

---

## 9) Must-have Heuristics / Edge Cases

- Function pointer declarators and prototypes: handle as “names declared” even if type text is complex.
- Designated initializers (`.field =`, `[idx] =`) and compound literals `(T){...}`: treat as deep-only expression questions if desired.
- `->` vs `.` member access may not be a named node distinction; detect via local text span.
- Preprocessor directives beyond includes can be anchors later (`#define`, `#if`), but v1 can skip.

---

## 10) Implementation Checklist

1) Add `cCuration.ts` + `cEngine.ts`.
2) Implement declarator extraction helpers (§6.2) and curated sections.
3) Implement anchor walking + traversal and include grouping.
4) Implement quiz rules for includes, functions, declarations, structs/enums, control flow.
5) Reuse Python overlap guard logic.
6) Wire parsing and add node-type dumps to validate alias mappings.

