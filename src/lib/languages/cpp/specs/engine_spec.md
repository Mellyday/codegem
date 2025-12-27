# C++ Engine Spec (v1)

This document specifies the C++ equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines:
- anchors + traversal
- curated sections + header spans
- quiz rules (`shallow` vs `deep`)
- grouping for `#include` runs (and optionally `using` runs)
- overlap/duplicate guard (reuse Python policy)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Provide a C++ engine consistent with Python’s architecture:
  - anchor declarations/statements become steps
  - curated sections normalize complex syntax (templates, declarators, classes)
  - deep profile drills into templates, qualifiers, lambdas, and common expression shapes
  - group `#include` directives into a virtual `import_group`
- Cover modern C++ constructs:
  - includes + namespaces + using declarations
  - classes/structs with inheritance, methods, constructors/destructors
  - templates (class/function templates)
  - lambdas (capture + params), structured bindings
  - control flow (including range-based for, exceptions)

### Non-goals (v1)
- Macro expansion semantics.
- Full overload resolution and type checking.
- Perfect modeling of every C++ corner case; rely on aliasing + incremental coverage.

---

## 1) Folder Layout

- `src/lib/languages/cpp/cppCuration.ts`
- `src/lib/languages/cpp/cppEngine.ts`
- `src/lib/languages/cpp/specs/engine_spec.md` (this doc)

Export parity with Python:
- `generateEngineSteps`, `maskAndAnswerForStep`, `buildCustomQuizPayload`

---

## 2) Parsing Integration

C++ parsing requires:
- Server: add `tree-sitter-cpp` and wire into `src/lib/parser/treeSitterServer.ts`.
- Client: add C++ WASM grammar and wire into `src/lib/treeSitter.ts` (optional).

Recommended extensions:
- `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`

---

## 3) Core Concepts

Same as Python:
- anchors produce steps
- curated sections drive quiz rules and span computation
- overlap guard removes redundant questions

Header questions must be recognizable:
- Stem: `Write the full header line`
- Generator rule: `header.line`

---

## 4) Canonical Node Vocabulary (verify + alias)

Confirm node type names from the C++ grammar you ship. Typical `tree-sitter-cpp` concepts:
- Root: `translation_unit`
- preprocessor: `preproc_include`, `preproc_def`, `preproc_if` (varies)
- namespace: `namespace_definition`
- class/struct: `class_specifier`, `struct_specifier`
- templates: `template_declaration`, `template_parameter_list`
- function: `function_definition`, `declaration`
- statements: C-like control flow + `try_statement`, `catch_clause`, `throw_statement`
- expressions: calls, member access, new/delete, lambda
- range-based for: `for_range_loop` / `range_based_for_statement` (alias)
- structured binding: `structured_binding_declaration` (alias)

---

## 5) Engine Traversal Spec (`cppEngine.ts`)

### 5.1 Statement extraction and filtering
Walk:
- `translation_unit` → directives and declarations
- namespace bodies → declarations
- class bodies → members
- function bodies (`compound_statement`) → statements
- switch/case bodies

Filter out:
- comments

### 5.2 Anchor node types (v1)

File/namespace scope:
- `preproc_include` (suppressed by `import_group`)
- namespace definitions
- class/struct/enum declarations
- template declarations (wrapping class/function declarations)
- function definitions
- variable declarations (global)

Class scope:
- field declarations
- method/constructor/destructor definitions or declarations
- nested types

Block scope:
- local variable declarations (including structured bindings)
- control flow statements
- return/break/continue
- expression statements
- try/catch/throw

### 5.3 Diggability and traversal
Diggable when there are nested anchors:
- namespaces, classes
- function bodies
- control flow bodies

Traversal order:
- emit anchor step
- then walk nested bodies in source order

### 5.4 Include grouping (required)
Group contiguous `preproc_include` directives into a virtual `import_group` step.

Optional future grouping:
- contiguous `using` declarations/directives into a `using_group` virtual step (not required v1)

### 5.5 Fallback quiz
Same as Python: only leaf-y anchors get “What comes next?” fallback.

---

## 6) Curation Spec (`cppCuration.ts`)

### 6.1 Includes
`preproc_include`:
- `path`
- `is_system` (`<...>` vs `"..."`) via heuristic

### 6.2 Declarator helpers (must-have)
C++ declarators are even more complex than C. Implement:
- `extractDeclaredNames(node, code)`
- `extractDeclaratorName(node, code)`
- `extractBestEffortTypeText(node, code)`

These must handle:
- pointers/references
- templates in types (`std::vector<int>`)
- function declarators and member functions
- constructors/destructors (names match class)

### 6.3 Namespaces
`namespace_definition`:
- `name` (optional for anonymous namespaces)
- `body`

### 6.4 Classes/structs
`class_specifier` / `struct_specifier`:
- `name`
- `bases` (inheritance list; include access specifiers)
- `body` (members)
- `template_params` if wrapped in `template_declaration`

Members:
- methods/constructors/destructors:
  - `name`
  - `params`
  - `return_type` (not for ctors/dtors)
  - qualifiers: `const`, `noexcept`, ref-qualifiers (`&`, `&&`), `override`, `final` via node or heuristic
  - `body` if defined
- fields:
  - `names`
  - `type`
  - initializers (optional)

### 6.5 Templates
`template_declaration`:
- `params` (template parameter list)
- `declaration` (class/function)

### 6.6 Functions
`function_definition`:
- `name`
- `params`
- `return_type`
- `body`
- qualifiers (`noexcept`, trailing return type, etc.) via node/heuristic

### 6.7 Control flow
Same as C plus:
- range-based for:
  - `bindings` and `iterable`
- try/catch:
  - catch parameter type/name, body

### 6.8 Lambdas (deep-only)
`lambda_expression`:
- `captures`
- `params`
- `return_type` (optional)
- `body`

### 6.9 Structured bindings (deep-only anchor)
`structured_binding_declaration`:
- `names` (e.g., `a`, `b`)
- `initializer`

---

## 7) Quiz Rules Spec

### 7.1 Header questions
For nodes with a clear signature/body boundary:
- Stem: `Write the full header line`
- Generator rule: `header.line`

Applies to:
- function/method/constructor definitions
- class/struct headers (up to `{`)
- control flow headers
- try/catch headers

### 7.2 Include group (`import_group`)
Always:
- multi-select: `Which headers are included here?`
Deep:
- system vs local includes

### 7.3 Namespaces
Optional shallow:
- `What namespace is defined?` (or “anonymous namespace”)

### 7.4 Classes/structs
Always:
- header question
- `What is the class/struct name?`
- inheritance:
  - `Which base classes are listed?` (multi)

Deep:
- template params:
  - `Which template parameters are declared?` (multi; names)
- access/qualifier questions as available

### 7.5 Functions and methods
Always:
- header question
- `What is the function/method name?`
- params multi-select (names)

Deep:
- return type question (best-effort)
- `Is this function noexcept?` (Yes/No)
- for methods: `Is this method const?` (Yes/No)
- constructors/destructors: identify kind (ctor/dtor) and class name

### 7.6 Templates
If wrapped in `template_declaration`:
- `Which template parameters are declared?` (multi)

### 7.7 Lambdas (deep-only bubble)
Bubble up lambda questions when a lambda appears as:
- initializer value
- return value
- argument to a call

Questions:
- `Which variables are captured?` (multi; include `&`/`=` capture defaults as special tokens)
- `Which parameters does the lambda take?` (multi)

### 7.8 Range-based for and structured bindings
Range-based for:
- `Which bindings are introduced?`
- `What is being iterated?`

Structured binding declaration:
- `Which names are bound?`
- `What expression initializes the binding?`

### 7.9 Exceptions
`try_statement` / `catch_clause`:
- `Which exception type is caught?`
- `What is the catch binding name?` (if present)

`throw_statement`:
- `What expression is thrown?` (if present)

---

## 8) Shallow vs Deep Summary

Shallow:
- includes, names of types/functions
- high-level control flow headers

Deep:
- templates and qualifiers
- lambda captures/params
- inheritance details
- structured bindings and range-based for specifics

---

## 9) Must-have Heuristics / Edge Cases

- Many qualifiers (`constexpr`, `consteval`, `noexcept`, `override`) may not be named nodes in your serialized AST; use bounded header-text scans.
- Template and declarator shapes vary; keep “extract name/type text” centralized and best-effort.
- Macros may hide syntax; avoid failing hard when nodes are missing.

---

## 10) Implementation Checklist

1) Add `cppCuration.ts` + `cppEngine.ts`.
2) Implement declarator helpers and curated sections.
3) Implement anchor walking + traversal and include grouping.
4) Implement quiz rules for includes, namespaces, types, functions/methods, templates, lambdas, control flow, exceptions.
5) Reuse Python overlap guard logic.
6) Wire parsing and add node-type dumps for alias validation.

