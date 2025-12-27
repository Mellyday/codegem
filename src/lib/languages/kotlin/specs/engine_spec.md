# Kotlin Engine Spec (v1)

This document specifies the Kotlin equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines behavior for:
- traversal and anchor steps
- curated sections and reveal spans
- quiz rules (`shallow` vs `deep`)
- import grouping
- overlap/duplicate guard (reuse Python policy)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Mirror Python’s engine architecture for Kotlin:
  - anchors = declarations + statements (not every expression)
  - curation provides stable keys for rules
  - deep profile covers Kotlin-specific idiosyncrasies: null-safety, when/if as expressions, lambdas, extension functions, data/sealed classes
- Support common Kotlin codebases:
  - packages + imports (including aliases)
  - classes/objects/interfaces/enums + companion objects + init blocks
  - functions (including extension + suspend) and properties (val/var, delegated)
  - control flow (`if`, `when`, `for`, `while`, `do`, `try`, `return`, `throw`)

### Non-goals (v1)
- Full type inference or resolution.
- Symbol table analysis for overloads.
- Perfect coverage of every grammar variant; use aliasing + node dumps.

---

## 1) Folder Layout

- `src/lib/languages/kotlin/kotlinCuration.ts`
- `src/lib/languages/kotlin/kotlinEngine.ts`
- `src/lib/languages/kotlin/specs/engine_spec.md` (this doc)

Export parity with Python:
- `generateEngineSteps`, `maskAndAnswerForStep`, `buildCustomQuizPayload`

---

## 2) Parsing Integration

Kotlin parsing requires adding a grammar:
- Server: add `tree-sitter-kotlin` and wire into `src/lib/parser/treeSitterServer.ts`.
- Client: add Kotlin WASM grammar and wire into `src/lib/treeSitter.ts` (optional).

Recommended extensions:
- `.kt`, `.kts`

---

## 3) Core Concepts

Same as Python:
- anchors produce steps
- curated sections drive both lesson text and quiz cards
- header/body spans enable “Write the full header line” questions
- overlap/duplicate guard removes redundant questions

Header questions must be recognizable:
- Stem: `Write the full header line`
- Generator rule: `header.line`

---

## 4) Canonical Node Vocabulary (verify + alias)

Confirm node types from the Kotlin grammar you ship; names vary across grammars. Typical concepts:
- Root file node (e.g., `kotlin_file` / `source_file`)
- `package_header`, `import_header`
- `class_declaration`, `object_declaration`, `interface_declaration`, `enum_class`
- `function_declaration`
- `property_declaration`
- expression/statement blocks (e.g., `block`)
- `if_expression`, `when_expression`, `for_statement`, `while_statement`, `do_while_statement`, `try_expression`
- `return_expression`, `throw_expression`
- lambda literals (e.g., `lambda_literal`)

---

## 5) Engine Traversal Spec (`kotlinEngine.ts`)

### 5.1 Statement extraction and filtering
Walk:
- file root → top-level declarations
- blocks → contained statements/declarations
- class bodies → member declarations
- when entries → entry bodies

Filter out:
- comments
- optional: file annotations that aren’t useful as standalone steps (still quiz them as modifiers)

### 5.2 Anchor node types (v1)

File scope:
- `package_header`
- `import_header` (suppressed by `import_group`)
- `class_declaration` / `object_declaration` / `interface_declaration` / enum-like declarations
- `function_declaration`
- `property_declaration`
- `typealias_declaration` (if present)

Member scope:
- nested classes/objects
- member functions
- member properties
- init blocks / companion objects (as anchors if grammar exposes them)

Block scope:
- `if_expression` when used as a statement
- `when_expression` when used as a statement
- loops (`for_statement`, `while_statement`, `do_while_statement`)
- `try_expression` when used as a statement
- `return_expression`, `throw_expression`
- expression statements with calls/assignments (grammar-dependent)

### 5.3 Diggability
Diggable when the node contains child anchors in its body:
- class/object bodies
- function bodies
- control-flow bodies (then/else, when entries, loop bodies, try/catch/finally)

### 5.4 Import grouping (required)
Group contiguous `import_header` nodes into a virtual `import_group` step.

Questions:
- `Which modules/packages are imported?` (multi; use the imported path)
- Deep-only: alias mapping `import x.y.Z as Q`

Child steps:
- one per import header, `generateQuiz:false`

### 5.5 Fallback quiz
Same as Python: allow “What comes next?” only for leaf anchors with no children and no rules.

---

## 6) Curation Spec (`kotlinCuration.ts`)

### 6.1 Package/import
`package_header`:
- `name`

`import_header`:
- `path` (qualified name)
- `alias` (optional)
- `wildcard` (if `*`)

### 6.2 Classes/objects
`class_declaration` / `object_declaration` / `interface_declaration`:
- `name`
- `modifiers` (annotations + keywords: public/private/protected/internal, open/final/abstract, data/sealed, etc.)
- `type_params`
- `super_types` (extends/implements list)
- `primary_constructor_params` (for data classes / properties in constructor)
- `body`

### 6.3 Functions
`function_declaration`:
- `name`
- `receiver_type` (extension function receiver; optional)
- `type_params`
- `params`
- `return_type` (optional; type inference)
- `modifiers` (suspend/inline/operator/infix/tailrec/override/etc.)
- `body` (block or expression)

### 6.4 Properties
`property_declaration`:
- `names` (can be destructuring)
- `type` (optional)
- `initializer` (optional)
- `modifiers` (val/var + visibility + late-init/const)
- `delegate` (if `by`)

### 6.5 Control flow
`if_expression`:
- `condition`
- `then`
- `else`

`when_expression`:
- `subject` (optional)
- `entries` (each has conditions + body)

`try_expression`:
- `body`
- `catches`
- `finally`

Loops:
- `for_statement`: `variable`, `range`, `body`
- `while_statement`/`do_while_statement`: `condition`, `body`

### 6.6 High-signal expressions (deep-only)
Provide curated keys for:
- calls (callee + args)
- qualified access (`a.b`)
- indexing (`a[i]`)
- safe call (`?.`), Elvis (`?:`), not-null assertion (`!!`) via heuristic/text span
- lambda literals: parameters + body shape (block vs expression)

---

## 7) Quiz Rules Spec

### 7.1 Header questions
For nodes with a signature/body boundary:
- Stem: `Write the full header line`
- Generator rule: `header.line`
- Answer: `code.slice(start, headerEnd)`

Applies to:
- class/object declarations
- function declarations
- loops and try/catch/finally headers (where applicable)

### 7.2 Import group
Always:
- multi-select: `Which imports are used here?`
Deep:
- alias questions (local alias ↔ original path)

### 7.3 Classes/objects
Always:
- header question
- `What is the class/object name?`
- `Which supertypes are declared?` (multi; if present)
- `Which type parameters are declared?` (multi; if present)

Deep:
- modifiers multi-select (data/sealed/open/abstract/etc.)
- for data classes: `Which constructor parameters become properties?` (multi)

### 7.4 Functions
Always:
- header question
- `What is the function name?`
- multi-select params (names; for destructuring params use raw text)
- if receiver type exists: `What is the receiver type?`
- if return type exists: `What is the return type?`

Deep:
- default param values
- `Is this function suspend/inline/operator/infix?` (Yes/No or modifiers multi)
- lambda bubble-up when initializer/value is a lambda

### 7.5 Properties
Always:
- `Which bindings are declared?` (multi; supports destructuring)
- if initializer exists: `What is the initializer value?`

Deep:
- delegated properties: `What is the delegate expression (after by)?`
- nullability operators in types/expressions (heuristic):
  - safe call, Elvis, `!!` questions on demand

### 7.6 Control flow
`if_expression` (when used as statement):
- header question
- deep: `What is the condition?`

`when_expression`:
- header question (up to first entry)
- deep: `What is the when subject?` (if present)
- per entry: `Which conditions match this branch?` (multi; include `else`)

Loops:
- for: `What variable is bound?` and `What range is iterated?`
- while/do: condition

Try:
- `Which exceptions are caught?` and `What binding name is used?`

Returns/throws:
- `What value is returned/thrown?` if present

---

## 8) Shallow vs Deep Summary

Shallow:
- headers and names
- imports, type/function/property declarations
- top-level control flow

Deep:
- modifiers, generics, extension receivers
- destructuring and defaults
- when branches and try catches
- null-safety operators and lambda bubble-up (limited)

---

## 9) Must-have Heuristics / Edge Cases

- Kotlin keywords often appear as tokens (not named nodes). Use bounded header text scans for:
  - `suspend`, `inline`, `operator`, `infix`, `tailrec`, `data`, `sealed`, etc.
- `if`/`when` are expressions; only anchor them when they appear as standalone statements (or optionally when they form RHS of a property/assignment in deep).
- `?.`, `?:`, `!!` often aren’t named nodes; detect via short text spans.
- `.kts` script files have top-level statements; ensure root-walk includes them.

---

## 10) Implementation Checklist

1) Add `kotlinCuration.ts` + `kotlinEngine.ts`.
2) Implement curated sections in §6 and header span logic.
3) Implement anchor walking and body traversal in §5.
4) Implement import grouping and grouped questions.
5) Implement quiz rules for declarations, control flow, and key Kotlin features.
6) Reuse Python overlap guard logic.
7) Wire parsing (server + optional WASM client) and add a node-type dump tool.

