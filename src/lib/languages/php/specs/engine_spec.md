# PHP Engine Spec (v1)

This document specifies the PHP equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines:
- anchors + traversal
- curated sections + reveal spans
- quiz rules (`shallow` vs `deep`)
- grouping for `use` imports (and optional include/require grouping)
- overlap/duplicate guard (reuse Python policy)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Mirror the Python engine architecture for PHP:
  - steps are statement/declaration-level
  - curated sections normalize common PHP constructs (namespace/use, functions, classes, attributes)
  - `deep` drills into params/types/attributes and high-signal expressions
  - group `use` imports into a virtual `import_group` step
- Cover modern PHP (7.4–8.x) constructs:
  - namespaces and `use` declarations (including aliases and grouped use)
  - classes/interfaces/traits, methods, properties
  - attributes (`#[...]`)
  - control flow (`if`, `foreach`, `for`, `while`, `switch`, `try/catch/finally`, `match`)
  - functions, closures, arrow functions
  - `require/include` statements as dependency declarations (optional grouping)

### Non-goals (v1)
- Full name resolution across namespaces.
- Evaluating runtime includes.
- Perfect coverage of all grammar variants; alias + node dumps required.

---

## 1) Folder Layout

- `src/lib/languages/php/phpCuration.ts`
- `src/lib/languages/php/phpEngine.ts`
- `src/lib/languages/php/specs/engine_spec.md` (this doc)

Export parity with Python:
- `generateEngineSteps`, `maskAndAnswerForStep`, `buildCustomQuizPayload`

---

## 2) Parsing Integration

PHP parsing requires adding a grammar:
- Server: add `tree-sitter-php` (or `tree-sitter-php` + `tree-sitter-phpdoc` if desired) and wire into `src/lib/parser/treeSitterServer.ts`.
- Client: add PHP WASM grammar and wire into `src/lib/treeSitter.ts` (optional).

Recommended extensions:
- `.php`

---

## 3) Core Concepts

Same as Python:
- anchors produce steps
- curated sections drive rules
- overlap guard removes redundant nested questions

Header questions must be recognizable:
- Stem: `Write the full header line`
- Generator rule: `header.line`

---

## 4) Canonical Node Vocabulary (verify + alias)

Confirm node names from the PHP grammar you ship; PHP grammars differ across repos.

Typical concepts:
- Root: `program`
- `namespace_definition`
- `namespace_use_declaration` / `use_declaration`
- `function_definition`
- `class_declaration` / `interface_declaration` / `trait_declaration`
- `method_declaration`, `property_declaration`
- statements: `if_statement`, `foreach_statement`, `for_statement`, `while_statement`, `do_statement`, `switch_statement`, `try_statement`, `return_statement`, `throw_expression/statement`
- expressions: `assignment_expression`, calls, member access
- attributes: `attribute_list`, `attribute`
- match: `match_expression`

---

## 5) Engine Traversal Spec (`phpEngine.ts`)

### 5.1 Statement extraction and filtering
Walk:
- root → top-level statements/declarations
- namespace bodies → contained statements
- class bodies → member declarations
- blocks → statements
- switch/match arms → their bodies/expressions

Filter out:
- comments
- optional: `declare(strict_types=1);` as “directive prologue” (treat like JS directive strings) if you want to avoid quizzing it by default

### 5.2 Anchor node types (v1)

File/namespace scope:
- `namespace_definition`
- `namespace_use_declaration` (suppressed by `import_group`)
- `function_definition`
- class/interface/trait declarations
- top-level `require/include` statements (optional anchor)

Class scope:
- methods
- properties
- constants (if grammar provides)
- nested types

Block scope:
- variable declarations/assignments (grammar-dependent)
- control flow (`if`, loops, switch, try/catch/finally, match when used as statement)
- `return`, `throw`, `break`, `continue`
- expression statements (calls, assignments)

### 5.3 Diggability and traversal
Diggable when the body contains anchors.

Traversal order:
- emit anchor step
- then walk body statements (namespace/class/function/control-flow bodies) in source order

### 5.4 Import grouping (required)

Group contiguous `namespace_use_declaration` nodes into one virtual `import_group` step.

Virtual node:
- `type: "import_group"`
- span covers the contiguous run
- `isVirtual: true`

Child steps:
- one per original `use` declaration with `generateQuiz:false`

Grouped questions (see §7.2):
- `Which names are imported with use?` (multi)
- Deep-only: alias mapping

Optional future grouping:
- contiguous `require/include` statements as an additional `import_group` (or separate `include_group`)

### 5.5 Fallback quiz
Same as Python: rules first; suppress fallback when children exist; otherwise allow a minimal “What comes next?”.

---

## 6) Curation Spec (`phpCuration.ts`)

### 6.1 Namespace & use
`namespace_definition`:
- `name`
- `body`

`namespace_use_declaration`:
- `clauses` (one or more imported names)

Use clause:
- `name` (qualified)
- `alias` (optional)
- `kind` (function/const/class use; grammar-dependent)

### 6.2 Classes/interfaces/traits
`class_declaration` (similarly for interface/trait):
- `name`
- `modifiers` (final/abstract/readonly etc.)
- `extends`
- `implements` (multi)
- `attributes` (attribute lists)
- `body`

### 6.3 Methods and functions
`function_definition` / `method_declaration`:
- `name`
- `params`
- `return_type` (optional)
- `modifiers` (visibility/static/abstract/final)
- `attributes`
- `body`

Parameter curation:
- `name`
- `type`
- default value
- by-ref `&`
- variadic `...`

### 6.4 Properties
`property_declaration`:
- `names` (can declare multiple)
- `type` (optional)
- `initializers` (optional)
- `modifiers` (public/protected/private/static/readonly)
- `attributes`

### 6.5 Attributes
`attribute`:
- `name`
- `args` (positional + named args)

### 6.6 Control flow
Provide curated keys for:
- `if_statement`: condition/then/else
- loops: iterator bindings + iterable + body
- `switch_statement`: value + cases
- `try_statement`: body + catches + finally
- `catch_clause`: exception types + binding name + body
- `match_expression`: subject + arms

### 6.7 High-signal expressions (deep-only)
Provide curated keys for:
- assignment: left/right/operator
- function calls: callee + args
- member access / array access
- closures/arrow functions: params + body + captured vars (if exposed)

---

## 7) Quiz Rules Spec

### 7.1 Header questions
For nodes with a header/body boundary:
- Stem: `Write the full header line`
- Generator rule: `header.line`
- Answer: slice from `startIndex` to body start

### 7.2 Import group (`import_group`)
Always:
- multi-select: `Which names are imported here? (ignore local aliases)`
  - Correct: original imported names

Deep:
- alias mapping:
  - `What is the local alias for <Name>?`
  - `Which imported name is aliased as <Alias>?`

### 7.3 Namespace declarations
Optional shallow:
- `What namespace is declared?`

### 7.4 Classes/interfaces/traits
Always:
- header question
- `What is the class/interface/trait name?`
- extends/implements questions when present
- attributes:
  - multi-select: `Which attributes are applied?`

Deep:
- attribute arguments:
  - `What is argument #1 of #[Attr(...)]?`
  - `What is the value of named argument x= in #[Attr(x: ...)]?`
- modifiers multi-select (final/abstract/readonly/etc.)

### 7.5 Functions and methods
Always:
- header question
- `What is the function/method name?`
- params multi-select (names)
- if return type present: `What is the return type?`
- attributes multi-select (if present)

Deep:
- default param values
- by-ref params and variadics
- visibility/static modifiers for methods
- closure/arrow-function bubble-up when used as values:
  - params and return type (if present)

### 7.6 Properties
Always:
- multi-select: `Which properties are declared?`
- if type present: `What is the property type?`

Deep:
- initializer value questions
- attributes and modifiers

### 7.7 Control flow
`if`/loops:
- header question
- deep: condition / iterable expression

`switch`:
- deep: `What value is switched on?`
- per case: labels multi-select (include default)

`try/catch/finally`:
- per catch: exception types and binding name

`match_expression`:
- `What value is matched on?`
- `Which arms exist?` (labels; include default)
- deep: `What is the result expression for arm <X>?` (limit)

`return`/`throw`:
- `What value is returned/thrown?` when present

### 7.8 Expression statements (calls/assignments)
If statement is an assignment:
- LHS/RHS questions
If statement is a call:
- `What function is called?`
- deep: argument #1/#2 (limit)

---

## 8) Shallow vs Deep Summary

Shallow:
- imports/namespaces
- class/function/method/property headers and names
- basic control flow headers

Deep:
- attributes + args
- types, defaults, modifiers
- match arms and catch details
- limited call argument drilling and closure bubble-up

---

## 9) Must-have Heuristics / Edge Cases

- Grouped `use` declarations and multiple clauses per statement.
- `use function` / `use const` (if grammar exposes): treat as a separate “kind”.
- `declare(strict_types=1);` often appears at top; decide whether to skip as directive-like.
- Attributes may be represented as lists attached to declarations; keep extraction centralized.

---

## 10) Implementation Checklist

1) Add `phpCuration.ts` + `phpEngine.ts`.
2) Implement curated sections and header span logic.
3) Implement anchor walking + traversal and import grouping.
4) Implement quiz rules for namespaces/use, declarations, attributes, control flow, match, returns/throws.
5) Reuse Python overlap guard logic.
6) Wire parsing and add node-type dumps for alias validation.

