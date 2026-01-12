# Java Engine Spec (v1)

This document specifies the Java equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines the intended behavior for:

- **Engine traversal** (anchors, diggability, nesting, traversal order)
- **Curation** (`buildCuratedSections` keys + header/body reveal spans)
- **Quiz rules** (what we ask per construct; `shallow` vs `deep`)
- **Grouping** (imports first; optional future grouping for fields/locals)
- **Overlap/duplicate guard** (same as Python)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Provide Java parity with the Python engine architecture:
  - “Anchor” statements/declarations become `EngineStep`s.
  - Sub-expression questions attach to the anchor step instead of creating expression steps.
  - Curated sections normalize grammar differences and give stable spans for quiz reveals.
  - `shallow` vs `deep` controls how far we decompose signatures and expressions.
  - Imports are grouped into a virtual `import_group` step.
- Cover modern Java features commonly seen in production code:
  - packages/imports (including static + wildcard imports)
  - classes/interfaces/enums/records/annotations
  - methods/constructors (generics, varargs, throws)
  - fields/local variables (including `var`)
  - control flow (`if`, `for`, enhanced `for`, `while`, `do`, `switch`, `try`, `synchronized`)
  - lambdas + method references (bubble-up in `deep`)

### Non-goals (v1)
- Full semantic type resolution.
- Symbol table analysis (e.g., determining overload targets).
- Exhaustive coverage of every Java version feature; include aliasing + node dumps and iterate.

---

## 1) Folder Layout

Create a sibling folder:

- `src/lib/languages/java/javaCuration.ts`
- `src/lib/languages/java/javaEngine.ts`
- `src/lib/languages/java/specs/engine_spec.md` (this doc)

Keep API parity with Python:
- `generateEngineSteps(root, node, code, options)`
- `maskAndAnswerForStep(step, root, code)`
- `buildCustomQuizPayload(...)`

---

## 2) Parsing Integration

Java parsing requires adding a grammar:
- Server: add `tree-sitter-java` and wire into `src/lib/parser/treeSitterServer.ts`.
- Client: add Java WASM grammar and wire into `src/lib/treeSitter.ts` if client-side parsing is desired.

Recommended extensions:
- `.java`

---

## 3) Core Concepts (same as Python)

### 3.1 Anchors
Anchors are statement/declaration-level nodes that produce `EngineStep`s. We avoid expression steps by default.

### 3.2 Curated sections
Implement `buildCuratedSections(node)` + helpers (`getSectionItems`, `getSectionFirstItem`, `getSectionSpan`, `getRevealAnchors`).

### 3.3 Headers, display spans, masking
Java “headers” can span multiple lines. Define:
- `headerEnd`: start of the body block (e.g., `{`) when present
- header question answer: `code.slice(node.startIndex, headerEnd)` trimmed

### 3.4 Overlap guard
Reuse Python’s overlap/duplicate guard policy.
Header questions must be recognizable:
- Stem: `Write the full header line`
- Generator rule: `header.line`

---

## 4) Canonical Tree-sitter Node Vocabulary (verify + alias)

You must confirm actual node type names from the Java grammar you ship. This spec assumes typical `tree-sitter-java` naming and requires an alias layer.

Common roots/containers:
- Root: often `program` or `compilation_unit`
- Blocks: `block`

Common file-level declarations:
- `package_declaration`
- `import_declaration`
- type declarations: `class_declaration`, `interface_declaration`, `enum_declaration`, `record_declaration`, `annotation_type_declaration`

Common member declarations:
- `field_declaration`
- `method_declaration`
- `constructor_declaration`
- `static_initializer`

Common statements:
- `local_variable_declaration`
- `if_statement`
- `for_statement`, `enhanced_for_statement`
- `while_statement`, `do_statement`
- `switch_statement` (and/or `switch_expression` depending on grammar)
- `try_statement`, `catch_clause`, `finally_clause`
- `synchronized_statement`
- `return_statement`, `throw_statement`, `break_statement`, `continue_statement`, `assert_statement`
- `expression_statement`

Common high-signal expressions (deep-only questions):
- `assignment_expression`
- `binary_expression`, `unary_expression`, `ternary_expression`
- `method_invocation`
- `field_access`
- `array_access`
- `object_creation_expression` (constructor calls)
- `lambda_expression`
- `method_reference`

---

## 5) Engine Traversal Spec (`javaEngine.ts`)

### 5.1 Statement extraction and filtering
Containers to walk:
- root compilation node → top-level declarations
- `block` → statements
- switch cases/labels → their statement lists
- class bodies → member declarations

Filter out:
- `comment` nodes
- optional: empty statements

### 5.2 Anchor node types (v1)

File scope:
- `package_declaration`
- `import_declaration` (typically suppressed by `import_group`; see §5.4)
- all type declarations (class/interface/enum/record/annotation)

Type/member scope:
- `field_declaration`
- `method_declaration`
- `constructor_declaration`
- `static_initializer`
- nested type declarations

Block scope:
- `local_variable_declaration`
- `if_statement`
- `for_statement`, `enhanced_for_statement`
- `while_statement`, `do_statement`
- `switch_statement` / `switch_expression`
- `try_statement`, `catch_clause`, `finally_clause`
- `synchronized_statement`
- `return_statement`, `throw_statement`, `break_statement`, `continue_statement`, `assert_statement`
- `expression_statement`

### 5.3 Diggability and traversal
A step is diggable when its body contains anchors.

Body mapping:
- methods/constructors/static initializers → `body: block`
- class/interface/enum/record → `body` contains member declarations
- `if_statement` → then statement/block + else statement/block
- `for_statement` / `enhanced_for_statement` / `while_statement` / `do_statement` → `body` statement/block
- `switch_*` → cases/labels contain statement lists
- `try_statement` → try block + catch clauses + finally block
- `catch_clause` / `finally_clause` → blocks
- `synchronized_statement` → block

Traversal order:
- emit the anchor step
- then walk child bodies in source order, emitting steps for nested anchors

### 5.4 Import grouping (required)

Group contiguous `import_declaration` nodes into one virtual `import_group` step.

Virtual node:
- `type: "import_group"`
- `startIndex`: first import start
- `endIndex`: last import end
- `isVirtual: true`

Child steps:
- one per original `import_declaration` with `generateQuiz:false`

Grouped quiz questions (see §7.2):
- Which imports are used (qualified names and/or wildcard packages)
- Deep-only: which are static imports

### 5.5 Fallback quiz
Same as Python:
- if rule questions exist → use them
- else if has quiz-worthy children → no fallback
- else allow “What comes next?” fallback for leaf-y anchors

Maintain a `NO_FALLBACK_QUIZ_NODE_TYPES` set for:
- imports
- class/interface/enum/record declarations
- method/constructor headers
- control-flow headers

---

## 6) Curation Spec (`javaCuration.ts`)

### 6.1 `package_declaration`
Keys:
- `name`: qualified identifier

### 6.2 `import_declaration`
Keys:
- `name`: qualified identifier
- `wildcard`: `*` if present
- `static`: boolean via token/heuristic

### 6.3 Type declarations

`class_declaration` (similarly for interface/enum/record):
- `name`
- `modifiers`: annotations + modifier keywords (public/private/protected/static/final/abstract/sealed/etc.)
- `type_params`: generic type parameters
- `extends`: superclass (single)
- `implements`: interfaces (multi)
- `body`: class body

`record_declaration`:
- everything above + `components` (record header parameters)

`enum_declaration`:
- everything above + `constants` (enum constant identifiers)

`annotation_type_declaration`:
- `name`, `members`

### 6.4 Members

`method_declaration`:
- `modifiers`
- `type_params`
- `return_type`
- `name`
- `params`
- `throws`
- `body` (optional; absent for abstract/interface methods)

`constructor_declaration`:
- `modifiers`
- `name`
- `params`
- `throws`
- `body`

`field_declaration`:
- `modifiers`
- `type`
- `declarators` (variable declarators)

`variable_declarator`:
- `name`
- `value` (initializer)

`local_variable_declaration`:
- `modifiers` (final/annotations)
- `type` (can be `var`)
- `declarators`

`static_initializer`:
- `body`

### 6.5 Control flow

`if_statement`:
- `condition`
- `then`
- `else` (optional)

`for_statement`:
- `init`
- `condition`
- `update`
- `body`

`enhanced_for_statement`:
- `var`
- `iterable`
- `body`

`while_statement` / `do_statement`:
- `condition`
- `body`

`switch_statement` / `switch_expression`:
- `value`
- `cases` / `rules` (depends on grammar; alias)

`try_statement`:
- `resources` (try-with-resources)
- `body`
- `catches`
- `finally`

`catch_clause`:
- `param` (can be multi-catch)
- `body`

`synchronized_statement`:
- `monitor`
- `body`

### 6.6 High-signal expressions (deep-only)
Provide curated keys for:
- `method_invocation`: `object?`, `name`, `args`
- `object_creation_expression`: `type`, `args`, `class_body?` (anonymous class)
- `lambda_expression`: `params`, `body`
- `method_reference`: `qualifier`, `name`
- `assignment_expression`: `left`, `right`, `operator`

---

## 7) Quiz Rules Spec

### 7.1 Header questions
For nodes with a header/body boundary:
- Stem: `Write the full header line`
- Generator rule: `header.line`
- Answer: `code.slice(node.startIndex, headerEnd)`

Applies to:
- type declarations with bodies
- methods/constructors/static initializers
- control-flow statements with blocks
- switch cases/rules if they have a clear label span

### 7.2 Import group (`import_group`)

Questions:
1) Multi-select: `Which imports are used here? (use qualified names; keep wildcard imports)`
  - Correct:
    - `import java.util.List;` → `java.util.List`
    - `import java.util.*;` → `java.util.*`
    - `import static java.util.Collections.*;` → `static java.util.Collections.*` (or split static as separate question; choose one format)

Deep-only:
2) `Which of these are static imports?` (multi)

### 7.3 Package declaration
Optional (recommended shallow):
- `What package is declared?` → qualified name

### 7.4 Type declarations

`class_declaration` / `interface_declaration` / `enum_declaration` / `record_declaration`:

Always:
- Header question
- `What is the type name?`
- If type parameters exist: `Which type parameters are declared?` (multi)
- If extends exists:
  - class: `What class is extended?`
  - interface: `Which interfaces are extended?` (multi)
- If implements exists: `Which interfaces are implemented?` (multi)
- If annotations present: `Which annotations are applied?` (multi; deep asks args)

Enum-specific:
- `Which enum constants are declared?` (multi)

Record-specific:
- `Which components does this record declare?` (multi)

Deep:
- modifiers:
  - `Which modifiers are present?` (multi; public/private/protected/static/final/abstract/sealed/non-sealed)
  - some modifiers may require heuristic extraction from header text

### 7.5 Methods and constructors

`method_declaration`:
Always:
- Header question
- `What is the method name?`
- Multi-select: `Which parameters does this method take?` (names)
- `What is the return type?`
- If throws present: `Which exceptions can be thrown?` (multi)
- If annotations present: `Which annotations are applied?` (multi)

Deep:
- per-parameter types:
  - `What is the type of parameter <x>?`
- varargs:
  - `Is this method variadic (varargs)?` (Yes/No)
- generic method:
  - `Which type parameters are declared on this method?` (multi)
- modifiers:
  - `Which modifiers are present?` (multi)

`constructor_declaration`:
Always:
- Header question
- `What class is constructed?`
- params multi
- throws multi (if present)

### 7.6 Fields and locals

`field_declaration` / `local_variable_declaration`:
Always:
- Multi-select: `Which variables are declared here?`
- `What is the declared type?` (use `var` as the literal answer if present)

Deep:
- for each declarator with initializer:
  - `What initializes <name>?`
- bubble up lambda questions when initializer is a lambda

### 7.7 Control flow

`if_statement`:
Always:
- Header question (up to then statement start if no block; or to block start)
Deep:
- `What is the condition?`

`for_statement`:
Always:
- Header question
Deep:
- `What is the initializer?`
- `What is the loop condition?`
- `What is the update expression?`

`enhanced_for_statement`:
Always:
- Header question
Deep:
- `What is the loop variable name?`
- `What is being iterated?`

`while_statement` / `do_statement`:
Always header; deep asks condition

`switch_statement` / `switch_expression`:
Always:
- Header question
Deep:
- `What value is being switched on?`
- For each case/rule:
  - `Which labels are matched by this case?` (multi; include `default`)

`try_statement`:
Always:
- Header question
Deep:
- try-with-resources:
  - `Which resources are declared?` (multi)
- for each catch:
  - `What exception type(s) are caught?`
  - `What is the exception binding name?`

`synchronized_statement`:
Always header; deep asks monitor expression

`return_statement` / `throw_statement`:
- `What value is returned/thrown?` (when present)

`break_statement` / `continue_statement`:
- if label present: `What label is targeted?`

### 7.8 Expression statements (high-signal cases)
If an `expression_statement` is:
- an assignment → ask LHS/RHS
- a method invocation → ask:
  - `What method is called?`
  - deep: argument #1/#2 (limit to N=2)

### 7.9 Annotation element-value pairs
For annotations with element-value pairs (e.g., `@Table(name = "users", schema = "public")`):

Always:
- Multi-select: `Which keys are present in <@AnnotationName>?`
  - Extracts keys from `element_value_pair` nodes
  - For annotations with >6 keys, split into multiple cards (3-6 correct per card)
  - Handles implicit `value` key for single-element annotations

Deep:
- Per element-value pair: `What is the value for <key> in <@AnnotationName>?`
  - Answers with the element value expression text

Annotation questions are generated for:
- Class annotations
- Method annotations
- Field annotations
- Constructor annotations

---

## 8) Shallow vs Deep Summary

Shallow:
- headers
- names of declared types/methods/vars
- basic import/package info

Deep:
- generics, modifiers, annotations
- parameter types and defaults (where expressible)
- try-with-resources and multi-catch specifics
- limited call argument drilling and lambda bubble-up

---

## 9) Must-have Heuristics / Edge Cases

- Static/wildcard imports: `import static ...*;`
- `var` locals: treat as a type token, not an identifier.
- Multi-catch: `catch (A | B e)` → types are a list.
- Switch expressions vs statements: grammar node differences require aliasing.
- Records: component list is a signature-like “header” part.
- Annotations and modifiers may not appear as named nodes; support heuristic extraction from header text.

---

## 10) Implementation Checklist

1) Add `javaCuration.ts` + `javaEngine.ts` under `src/lib/languages/java/`.
2) Implement curated sections from §6.
3) Implement anchor walking + body traversal (§5).
4) Implement import grouping + grouped questions (§5.4, §7.2).
5) Implement quiz rules for types/methods/fields/locals/control flow.
6) Reuse Python overlap guard logic.
7) Wire parsing (server + optional WASM client).
8) Add a node-type dump utility to validate aliases.

