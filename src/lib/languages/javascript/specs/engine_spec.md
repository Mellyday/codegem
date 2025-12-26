# JavaScript / TypeScript Engine Spec (v1)

This document specifies how to implement the JavaScript/TypeScript (“JS family”) equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

The goal is to describe the **exact behaviors** we want for:

- **Step generation** (what becomes a “lesson step”, how nested bodies are “diggable”)
- **Curation** (stable “sections” for nodes, spans for reveal/masking)
- **Quiz generation** (what questions are asked per construct, shallow vs deep)
- **Grouping** (imports, and optionally other blocks) and **dedupe/overlap guards**

---

## 0) Scope and Goals

### Goals
- Provide JS/TS parity with the Python engine’s architecture:
  - “Anchor nodes” become top-level `EngineStep`s
  - A curated-section layer (`buildCuratedSections`) normalizes node shapes
  - Quiz rules map node types → question generators, with a `shallow`/`deep` profile
  - Special grouping logic (imports) can replace per-statement quizzing
- Cover modern JavaScript + TypeScript + JSX/TSX as a first-class target (this repo is React/Next heavy).
- Keep the implementation resilient to tree-sitter grammar variations (via node-type aliasing + light text heuristics).

### Non-goals (v1)
- Full semantic analysis (typechecker, symbol resolution, import graph).
- Executing code / evaluating constant expressions.
- “Perfect” handling of every esoteric grammar node (we can add iteratively).

---

## 1) Proposed Folder Layout (mirrors Python)

Create a sibling folder to Python:

- `src/lib/languages/javascript/jsCuration.ts`
- `src/lib/languages/javascript/jsEngine.ts`
- `src/lib/languages/javascript/specs/engine_spec.md` (this doc)
- (Optional later) `src/lib/languages/javascript/specs/jsx_examples.md`, `import_examples.md`, etc.

### Public API parity with Python
The JS engine module should export the same “surface area” as Python where possible:

- `generateEngineSteps(root, node, code, options)`
- `maskAndAnswerForStep(step, root, code)` (or JS-specific equivalent)
- `buildCustomQuizPayload({ root, code, history, lessonQueue, currentStep, fileKey })`

Reusing the existing `EngineStep` / `QuizQuestion` types is preferred.

---

## 2) Parsing & Language Selection (repo integration points)

This spec focuses on engine behavior, but implementing JS requires adding parsing support in:

- Client (WASM): `src/lib/treeSitter.ts` (currently only Python).
- Server (native): `src/lib/parser/treeSitterServer.ts` (already has deps: `tree-sitter-javascript`, `tree-sitter-typescript`).

### Recommended file extensions
- JS: `.js`, `.mjs`, `.cjs`
- JSX: `.jsx`
- TS: `.ts`
- TSX: `.tsx`

### Tree-sitter grammars
- JavaScript + JSX: `tree-sitter-javascript` (supports JSX nodes)
- TypeScript + TSX: `tree-sitter-typescript` (`typescript` and `tsx` languages)

Implementation note: the engine should be written against a **canonical node vocabulary** (see below) and then include an alias layer for divergences between JS/TS/TSX.

---

## 3) Core Concepts (same as Python)

### 3.1 Anchor nodes
“Anchor nodes” are AST nodes that produce a lesson step (and usually quiz questions).

We do **not** generate steps for every expression by default; instead:
- steps are statement/declaration-level
- expression-level knowledge is queried via questions attached to an anchor step
- in `deep` profile, we optionally “bubble up” questions for nested function-likes (arrow functions, function expressions) and other high-value subexpressions

### 3.2 Curated sections
`buildCuratedSections(node)` returns a list of `{ key, items }` groups that normalize “where to find things” across grammar variations.

Rules should almost never scrape `namedChildren` directly; they should use:
- `getSectionItems(node, key)`
- `getSectionFirstItem(node, key)`
- `getSectionSpan(node, key)`
- `getRevealAnchors(node)` for header/body boundaries

### 3.3 Reveal anchors and masking
We use three related spans:

- `displaySpan` (per step): what the lesson view highlights for the node
- `headerEnd` (per node): where “header” ends and “body” begins (for blocks)
- question reveal spans (`revealStart`, `revealEndBeforeChild`, `revealEndAfterChild`): the minimal region that contains the answer (used for progressive reveal)

In Python, headers are usually a single line ending in `:`. In JS, headers are:
- `if (cond)` before the consequent statement/block
- `for (...)` before its body
- `function name(params)` before `{...}`
- `class Name extends Base` before `{...}`
- `case expr:` before the first case statement (or end of clause)

So “header span” is defined as `node.startIndex..body.startIndex` where a body exists.

### 3.4 Overlap guard (dedupe)
We keep Python’s policy:
- remove duplicate questions with identical span+stem+answer
- remove “umbrella” questions whose span contains a more specific question’s span
- keep header questions exempt from containment removal

This is crucial in JS because nested expressions (call chains, ternaries, etc.) can easily overlap.

---

## 4) JS/TS Canonical Node Vocabulary

Tree-sitter “JS family” roots and block containers:
- Root: `program`
- Statement block: `statement_block`
- Switch container: `switch_body`
- Class container: `class_body`

Key statement/declaration node types (JavaScript grammar):
- `import_statement`
- `export_statement`
- `lexical_declaration` (`const` / `let`)
- `variable_declaration` (`var`)
- `function_declaration` (includes `async function ...` as a token prefix)
- `generator_function_declaration` (includes `async function* ...`)
- `class_declaration`
- `if_statement`, `else_clause`
- `for_statement`, `for_in_statement` (covers both `for (...) in ...` and `for (...) of ...`)
- `while_statement`, `do_statement`
- `switch_statement`, `switch_case`, `switch_default`
- `try_statement`, `catch_clause`, `finally_clause`
- `return_statement`, `throw_statement`, `break_statement`, `continue_statement`
- `expression_statement`

Key “class member” node types:
- JS: `method_definition`, `field_definition`, `class_static_block`
- TS: `method_definition`, `public_field_definition` (+ modifiers), `abstract_method_signature`, etc. (v1 focuses on the shared ones above)

Key expression node types we care about for quiz questions:
- Calls/chains: `call_expression`, `member_expression`, `subscript_expression`, `new_expression`, `optional_chain`
- Assignment: `assignment_expression`, `augmented_assignment_expression`
- Operators: `binary_expression`, `unary_expression`, `update_expression`, `ternary_expression`
- Async/generators: `await_expression`, `yield_expression`
- Literals: `string`, `number`, `true`, `false`, `null`, `regex`, `template_string`, `template_substitution`
- Patterns: `object_pattern`, `array_pattern`, `assignment_pattern`, `rest_pattern`, `pair_pattern`, `shorthand_property_identifier_pattern`
- JSX: `jsx_element`, `jsx_self_closing_element`, `jsx_opening_element`, `jsx_attribute`, `jsx_expression`, `jsx_text`

### 4.1 Alias & heuristic layer (required)
Some information is not exposed via named children (e.g., `async`, `static`, `get`, `set`, `type` keyword in TS imports). The JS engine must use:
- **node-type aliasing** where possible (JS vs TS variations)
- **small text heuristics** using `code.slice(node.startIndex, node.endIndex)`

Examples:
- Async detection:
  - `async function f(){}` is still `function_declaration`
  - detect `async` via a prefix check on the node’s leading text
- TS type-only import/export:
  - `import type {Foo} from 'x'` is still `import_statement`
  - detect by checking whether the statement starts with `import type`

Heuristics must be bounded to short windows (e.g., first 200 chars) to avoid O(n²) behavior.

---

## 5) Engine Traversal Spec (`jsEngine.ts`)

### 5.1 Statement extraction
Equivalent to Python’s `getStatementChildren`, but for JS containers:

Containers to walk:
- `program` → its top-level statements
- `statement_block` → block statements
- `switch_case` / `switch_default` → their `body` field is an array of statements (no wrapper node)
- `class_body` → member declarations (methods/fields/static blocks)

Filtering rules (skip nodes):
- `comment`, `html_comment`
- directive prologue strings (see below)
- optional: `empty_statement` (generally not useful as a step)

#### Directive prologue (JS “docstring equivalent”)
Skip any leading `expression_statement` whose first named child is a `string`.

Applies at:
- top of `program`
- top of `statement_block` (commonly for `"use strict"`; Next.js uses `'use client'` at top-level)

Important: skip *all consecutive* directive strings at the start, not just the first.

### 5.2 Anchor node types
JS does not consistently use `_statement` suffix for declarations we care about, so define anchors explicitly.

**Anchor set (v1):**
- Imports/exports: `import_statement`, `export_statement`
- Declarations: `lexical_declaration`, `variable_declaration`, `function_declaration`, `generator_function_declaration`, `class_declaration`
- Class members: `method_definition`, `field_definition`, `public_field_definition`, `class_static_block`
- Control flow: `if_statement`, `else_clause`, `for_statement`, `for_in_statement`, `while_statement`, `do_statement`, `switch_statement`, `switch_case`, `switch_default`, `try_statement`, `catch_clause`, `finally_clause`
- Exits: `return_statement`, `throw_statement`, `break_statement`, `continue_statement`
- Expressions: `expression_statement` (but still filtered by directive-prologue rule)

**Non-anchor exceptions:**
- `empty_statement` is never an anchor.

### 5.3 Diggability (“hasChildStatements”)
Same idea as Python: a step is diggable if its body contains anchor statements.

Body mapping:
- `function_declaration` / `generator_function_declaration` → `body: statement_block`
- `class_declaration` → `body: class_body` (children are member anchors)
- `method_definition` → `body: statement_block`
- `class_static_block` → `body: statement_block`
- `if_statement` → `consequence: statement`, `alternative: else_clause?`
- `else_clause` → child statement
- `for_statement` / `for_in_statement` / `while_statement` / `do_statement` → `body: statement`
- `switch_statement` → `body: switch_body` → cases/defaults
- `switch_case` / `switch_default` → `body: statement[]`
- `try_statement` → `body: statement_block`, `handler: catch_clause?`, `finalizer: finally_clause?`
- `catch_clause` / `finally_clause` → `body: statement_block`

Traversal should:
- emit the step for the anchor node
- then walk its body (and associated clauses) in source order, producing child steps where anchors appear

### 5.4 Import grouping (required)
Mirror Python’s import-run grouping: contiguous imports become a **single virtual step**.

#### What qualifies as an “import” for grouping (v1)
Group contiguous `import_statement` nodes in a `program` (after directive prologue filtering).

TypeScript additions:
- include TS `import_statement` containing `import_require_clause` (`import Foo = require('foo')`)

Optional future (not required v1):
- `const x = require('x')` patterns
- `export ... from 'x'` re-exports as “dependency declarations”

#### Output structure for a grouped run
Emit a virtual node:
- `type: "import_group"`
- `startIndex` = first import’s `startIndex`
- `endIndex` = last import’s `endIndex`
- `isVirtual: true`

Attach:
- `quiz.questions`: generated by `generateImportRunQuestions(...)`
- `lesson.childSteps`: one child step per original import statement, with `generateQuiz:false` so we can “dig” into individual import lines for lesson view without quizzing them

#### Grouped import quiz questions
We want two families of multi-select cards, closely mirroring Python’s grouping behavior:

1) **Modules referenced**
- Stem: `Which modules are imported here? (use module specifiers, ignore local aliases)`
- Correct answers: module specifier strings (e.g., `'react'`, `'./utils'`)
- If > 6 correct answers, split into multiple cards (3–6 correct per card)

2) **Bindings imported per module**
- Stem: `What bindings are imported from 'react'? (use exported names; ignore local aliases)`
- Correct answers:
  - Named imports: `import_specifier.name` values (ignore `.alias`)
  - Namespace import: include a sentinel `*` (or `* as <local>`; choose one and be consistent)
  - Default import: include a sentinel `default`
  - Side-effect-only import (`import 'x'`): produce **no “bindings” card** (or produce a special card with answer `side-effect only`, but v1 can skip)
- If > 6 correct answers for a module, split into multiple cards

**Alias policy (v1):**
- For the grouped cards above, ignore local alias names (same principle as Python’s “ignore aliases” requirement).
- In `deep` profile only, optionally add “alias mapping” questions:
  - `What is the local name for imported <exportedName>?`
  - `What exported name is bound to local <alias>?`

Option pools for module specifiers:
- Pull string literals from surrounding code as distractors (imports/exports)
- Pad with curated module distractors (`react`, `next`, `lodash`, `fs`, `path`, `zod`, etc.)

Option pools for binding names:
- Pull identifiers from surrounding code
- Pad with curated identifier distractors (`props`, `state`, `data`, `result`, `err`, etc.)

### 5.5 Fallback quiz policy
Same as Python:
- If an anchor has matching rule questions → use them.
- Else, if it has quiz-worthy children → no fallback “What comes next?” (we want the user to dig instead).
- Else, allow a minimal fallback card:
  - Stem: `What comes next?`
  - Answer: full statement text

Define a `NO_FALLBACK_QUIZ_NODE_TYPES` set for nodes that should never fall back (control-flow headers, functions/classes, imports, etc.).

---

## 6) Curation Spec (`jsCuration.ts`)

### 6.1 Shared helpers (same as Python)
Implement the same utilities:
- `childrenOfType`, `firstChildOfType`
- `childrenByField`, `childByField`
- `collectDescendants` (and a “within scope boundary” variant if needed)
- `buildCuratedSections`, `getSectionItems`, `getSectionFirstItem`
- `getRevealAnchors`, `getSectionSpan`

### 6.2 Curated sections per node type (v1)

Below, “items” means named AST nodes.

#### `import_statement`
Keys:
- `source`: the module specifier `string` (field `source`)
- `default`: default import identifier (from `import_clause` child `identifier`)
- `namespace`: namespace import identifier (from `namespace_import → identifier`)
- `named`: list of `import_specifier`
- `attributes`: `import_attribute` object (import assertions / attributes)

#### `import_specifier`
Keys:
- `name`: exported name (field `name`, identifier or string)
- `alias`: local alias (field `alias`, identifier; optional)

#### `export_statement`
Keys:
- `declaration`: exported declaration node (field `declaration`)
- `value`: default export value expression (field `value`)
- `named`: `export_specifier[]` (from `export_clause`)
- `namespace`: `namespace_export` (if present)
- `source`: module specifier string (field `source`, optional)

#### `export_specifier`
Keys:
- `name`: local/original name (field `name`)
- `alias`: exported name (field `alias`, optional)

#### `lexical_declaration` / `variable_declaration`
Keys:
- `declarators`: `variable_declarator[]`
- `kind`: present as a token field for `lexical_declaration` (`const`/`let`); for `variable_declaration`, treat kind as `var` by text heuristic

#### `variable_declarator`
Keys:
- `name`: pattern node (field `name`)
- `value`: initializer expression node (field `value`, optional)

#### Patterns: `object_pattern`, `array_pattern`, `assignment_pattern`, `rest_pattern`, `pair_pattern`, `object_assignment_pattern`
Keys (minimal v1):
- `bindings`: all binding “leaves” inside the pattern
  - include `identifier`
  - include `shorthand_property_identifier_pattern`
  - include nested pattern leaves
- `defaults`: map-ish list of `assignment_pattern` occurrences (left binding + right default)

Implementation note: patterns are where “idiosyncratic logic” lives in JS. Centralize the binding-collection logic into a helper:
- `collectBindingNames(pattern, code) => string[]`

#### `function_declaration` / `generator_function_declaration`
Keys:
- `name`: identifier (field `name`)
- `params`: `formal_parameters` (field `parameters`)
- `body`: `statement_block` (field `body`)
- TS-only (if present in TS grammar):
  - `type_params`
  - `return_type`

#### `arrow_function`
Keys:
- `params`: either:
  - `parameter` (single `identifier`) OR
  - `parameters` (`formal_parameters`)
- `body`: expression or `statement_block`

#### `class_declaration`
Keys:
- `name`
- `decorators` (field `decorator`, if present)
- `heritage`: `class_heritage` (if present)
- `body`: `class_body`
- TS-only (if present):
  - `type_params`
  - `implements`

#### `method_definition`
Keys:
- `name` (field `name`)
- `decorators` (field `decorator`, optional)
- `params` (field `parameters`)
- `body` (field `body`)
- TS-only:
  - `return_type`, `type_params`

#### `field_definition` / `public_field_definition`
Keys:
- `name` / `property` (depending on grammar)
- `decorators` (optional)
- `value` initializer (optional)
- TS-only:
  - `type` annotation
  - modifiers (`accessibility_modifier`, `override_modifier`) as a section

#### Control flow statements (header/body shape)
All control-flow nodes should provide:
- `body`: the body statement/block container for headerEnd computation
Plus additional keys for content:

`if_statement`:
- `condition`, `body`, `else`

`else_clause`:
- `body`

`for_statement`:
- `init`, `condition`, `update`, `body`
  - unwrap `expression_statement` for init/condition if needed so we can ask about the underlying expression

`for_in_statement`:
- `left`, `right`, `body`, plus:
  - `operator` (`in` vs `of`) is an unnamed token → compute via `field operator` span or text heuristic
  - `kind` (`const`/`let`/`var`) is a token field (present)

`while_statement`, `do_statement`:
- `condition`, `body`

`switch_statement`:
- `value`, `body` (`switch_body`)

`switch_case`:
- `value`, `body` (`statement[]`)

`switch_default`:
- `body`

`try_statement`:
- `body`, `catch`, `finally`

`catch_clause`:
- `param`, `body`

`finally_clause`:
- `body`

#### `expression_statement`
Keys (v1):
- `expr`: first named child expression node

#### `call_expression`
Keys:
- `callee` (field `function`)
- `args` (field `arguments`)
- `optional` (`optional_chain`, optional)

`arguments`:
- `args`: list of expressions / `spread_element`

#### `member_expression` / `subscript_expression`
Keys:
- `object`
- `property` (member) OR `index` (subscript)
- `optional` (`optional_chain`, optional)

#### `template_string`
Keys:
- `substitutions`: `template_substitution[]`

#### JSX nodes (minimal v1)
`jsx_element` / `jsx_self_closing_element`:
- `name`: tag name (identifier / member_expression)
- `attributes`: `jsx_attribute[]` (and `jsx_expression` spread props)
- `children`: jsx_text / jsx_expression / jsx_element / jsx_self_closing_element

`jsx_attribute`:
- `name`: property_identifier
- `value`: string OR jsx_expression OR jsx_element/self_closing

---

## 7) Quiz Rules Spec (node → questions)

General conventions (match Python):
- `stem` is a clear natural-language prompt.
- `answerLabel` is the correct answer string.
- multi-select questions:
  - `questionType: "multi"`
  - `multiCorrect: string[]`
  - `options` is the option pool (10 items target)
- attach `sourceRefs` for the anchor and the subnode being asked about
- set reveal spans to the relevant curated section span where possible

### 7.1 Header questions (control-flow + definitions)
For nodes with a distinct header/body boundary, always include a header question compatible with the existing overlap-guard “header exception”:
- Stem: `Write the full header line` (recommended; matches Python)
- Generator rule: `header.line` (recommended; also marks it as a header question)
- Answer: header text from `node.startIndex..getRevealAnchors(node).headerEnd`

Nodes that should get header questions:
- `if_statement`, `else_clause`
- `for_statement`, `for_in_statement`, `while_statement`, `do_statement`
- `switch_statement`, `switch_case`, `switch_default`
- `try_statement`, `catch_clause`, `finally_clause`
- `function_declaration`, `generator_function_declaration`
- `class_declaration`, `method_definition`, `class_static_block`

This mirrors Python’s `headerRule`, but the JS header span is computed differently (see §3.3).

### 7.2 Import group (`import_group`)
Generated by grouping logic, not a direct tree-sitter node.

Questions:
1) `import_run.modules` (multi)
  - Correct: module specifiers (string literal contents or full quoted string; choose one and be consistent)
  - Reveal: whole group span

2) `import_run.bindings:<module>` (multi, per module)
  - Correct: exported binding names from named imports + sentinel `default`/`*` when present
  - Reveal: group span (or the specific import statement span if you build per-module spans)

Deep-only optional:
3) `import_run.alias-map` (single or multi)
  - For each aliased import specifier: ask local name or exported name

### 7.3 Export statement (`export_statement`)

Cases:
1) `export default <expression>;`
  - Question: `What is exported as default?` → expression text

2) `export default function/class ...`
  - Compose:
    - export default question (answer: `function foo` / `class C` header or name)
    - plus the underlying declaration questions (function/class rules)

3) `export { a, b as c }`
  - Multi-select: `Which names are exported?` (use exported names; i.e., `alias` if present else `name`)
  - Deep: for any `as` clause, ask `What local name maps to exported <X>?` or inverse

4) `export { x as y } from 'mod'`
  - Multi-select: exported names (aliases if present)
  - Single-select: `Which module is re-exported from?` (source)

5) `export * from 'mod'`
  - Single-select: `Which module is re-exported from?` (source)

6) `export * as ns from 'mod'`
  - Single-select: `What is the exported namespace name?` → `ns`
  - Single-select: `Which module is re-exported from?` → source

### 7.4 Variable declarations (`lexical_declaration`, `variable_declaration`)

Always:
- Multi-select: `Which bindings are declared here?`
  - Correct: binding identifiers extracted from each declarator’s `name` pattern
  - Option pool: identifiers from surrounding code + generic distractors

Deep:
- For each `variable_declarator` with initializer:
  - Single-select: `What is the initializer for <binding>?`
  - For destructuring, phrasing should be `What value is being destructured to initialize these bindings?`
- Bubble-up function-like questions when initializer is:
  - `arrow_function`, `function_expression`, `generator_function`

### 7.5 Assignment expression statements (`expression_statement` → `assignment_expression`)
When an `expression_statement` is a simple assignment:
- `x = expr;`
- `{a} = obj;` (destructuring assignment)

Questions mirror variable declarations:
- LHS bindings / target (single-select or multi-select for destructuring)
- RHS value expression
- Deep: destructuring binding details + nested arrow/function bubble-up

For `augmented_assignment_expression`:
- Ask:
  - `What is the operator?` (`+=`, `||=`, `??=`, etc.) via text span between left and right
  - `What is the left-hand target?`
  - `What is the right-hand value?`

### 7.6 Function declarations (`function_declaration`, `generator_function_declaration`)

Always:
- Header question (`Write the full header line`)
- Single-select: `What is the function name?` (for declarations)
- Multi-select: `Which are parameters of this function?`
  - For identifier params: use identifier text
  - For non-identifier params: use the raw param text (e.g., `{a, b}`, `[x, y]`, `...rest`)
- Single-select: `Is this function async?` (Yes/No) via text heuristic
- Single-select: `Is this a generator function?`:
  - `generator_function_declaration` → Yes
  - `function_declaration` → No (unless future grammar adds)

Deep:
- Defaults:
  - For each `assignment_pattern` param: `What is the default value of <param>?`
- Rest parameter:
  - `What is the rest parameter name?`
- Destructuring parameter bindings:
  - `Which bindings are introduced by parameter #n?` (multi)
- TypeScript:
  - type parameters multi-select
  - per-parameter type annotation questions (if we decide v1 supports them)
  - return type question (if present)

Generator body (deep-only):
- If the function body contains any `yield_expression`:
  - Ask: `Does this function yield values?` → Yes
  - For each `yield_expression` statement (or first N):
    - `What value is yielded?`
    - Detect `yield*` via text heuristic and ask `What iterable is delegated via yield*?`

### 7.7 Arrow functions (bubbled)
Arrow functions should not be standalone anchors in v1, but their questions are generated when they appear as values of:
- variable declarators
- assignments
- export default expressions
- call arguments (optional future)

Questions:
- Multi-select: parameters (same policy as functions)
- Single-select: `Is this arrow function async?` (heuristic)
- Single-select: `Is the body an expression or a block?` (expression vs `statement_block`)
- Deep: defaults/rest/destructuring bindings

### 7.8 Classes (`class_declaration`)

Always:
- Header question
- Single-select: `What is the class name?`
- If `class_heritage` present:
  - Single-select: `What does this class extend?`
- If decorators present (TS/stage-3):
  - Multi-select: `Which decorators are applied to this class?` (names)
  - Deep: decorator arg questions (see §7.11)
- TypeScript:
  - type parameters multi-select (if present)
  - implements clause multi-select (if present)

Child steps:
- Always walk `class_body` and emit separate steps for:
  - `method_definition`
  - `field_definition` / `public_field_definition`
  - `class_static_block`

### 7.9 Methods (`method_definition`)

Always:
- Header question
- Single-select: `What is the method name?` (string/property_identifier/computed)
- Multi-select: parameters (same policy as functions)
- Detect modifiers via prefix text (bounded window):
  - `static`, `async`, `get`, `set`, generator `*`, `constructor`
  - Ask Yes/No questions for the ones present or relevant:
    - `Is this method static?`
    - `Is this method async?`
    - `Is this a getter/setter?`
    - `Is this a generator method?`
- TypeScript:
  - return type question if present
  - type parameters multi-select if present

Deep:
- default param values, rest, destructuring bindings
- decorator questions (see §7.11)

### 7.10 Fields (`field_definition`, `public_field_definition`)

Always:
- Single-select: `What is the field name?`
- If initializer exists: `What is the initializer value?`
- TypeScript:
  - `What is the type annotation of this field?` (if present)
  - accessibility/override modifiers (multi-select, if present)
- Decorators (if present): see §7.11

### 7.11 Decorators (`decorator`)
JS grammar includes `decorator` nodes; TS uses them too.

Policy mirrors Python’s `decorated_definition` logic:
- If a class/method/field has `decorator[]`, generate:
  1) Multi-select: `Which decorators are applied?`
     - Extract decorator “name”:
       - if decorator child is `call_expression` → use callee name (identifier/member expression) without args
       - else if child is `identifier` / `member_expression` → use its text
  2) For each decorator that is a call:
     - positional args: `What is argument #n of @<decorator>?`
     - for object-literal config patterns, optionally ask key/value questions (deep-only)

### 7.12 Control flow

#### `if_statement` / `else_clause`
Always:
- Header question
Deep:
- `What is the if condition?` (expression inside the parenthesized expression)

Traversal:
- Walk consequence body
- Walk else body (emit `else_clause` step, then walk its body)

#### `for_statement`
Always:
- Header question
Deep:
- `What is the initializer?` (unwrap expression_statement)
- `What is the loop condition?` (unwrap expression_statement)
- `What is the increment/update expression?`

#### `for_in_statement` (includes `for..of`)
Always:
- Header question
Deep:
- `Is this a for..in or for..of loop?` (operator)
- `What is the loop binding/target?` (left)
- `What is being iterated?` (right)

#### `while_statement` / `do_statement`
Always:
- Header question
Deep:
- condition expression question

#### `switch_statement`
Always:
- Header question
Deep:
- `What value is being switched on?` (discriminant)

Traversal:
- Walk `switch_case` and `switch_default` as child anchors

#### `switch_case`
Always:
- Header question (up to first body stmt, else full node)
Deep:
- `What is the case value?`

#### `switch_default`
Always:
- Header question

#### `try_statement` / `catch_clause` / `finally_clause`
Always:
- Header question on each clause
Deep:
- `catch_clause`: `What is the caught error binding name/pattern?` (parameter)

Traversal:
- walk try body
- walk catch body (if present)
- walk finally body (if present)

### 7.13 Returns / throws / breaks / continues

`return_statement`:
- If it has a value:
  - `What value is returned?`

`throw_statement`:
- `What value is thrown?`

`break_statement` / `continue_statement`:
- If it has a label: `What label is targeted?`

### 7.14 Call expressions (via `expression_statement` or deep-only bubble)
When an `expression_statement` is a single `call_expression` (common in JS):

Always:
- `What function is called?` (callee text)
Deep:
- positional arg questions:
  - `What is argument #n?` (limit to first N, e.g., 3)
- If optional chaining present: `Is this an optional call?` (Yes/No)
- If dynamic import: `What module is dynamically imported?` (source string inside `import('x')`)

### 7.15 JSX (minimal v1)
If a return statement returns a JSX element, or an anchor expression statement is JSX:

Always:
- `What is the component/tag name?`
Deep:
- Multi-select: `Which prop names are set on this JSX element?`
- For simple props:
  - string literal values: `What is the value of prop <name>?`
  - jsx_expression values: `What expression is passed to prop <name>?`

---

## 8) Deep vs Shallow Summary

Shallow profile should prioritize:
- headers
- names (function/class/method)
- “what is being declared/imported/exported”

Deep profile adds:
- defaults, rest, destructuring binding details
- call arguments (limited)
- async/generator/yield details
- decorator argument details
- additional subexpression breakdown only when it’s high-signal (avoid overwhelming quizzes)

---

## 9) Edge Cases & Must-Have Heuristics

### 9.1 Async / static / getter-setter detection (no tokens in serialized AST)
Because our serialized AST only includes named children:
- determine `async` / `static` / `get` / `set` / `*` by scanning the prefix text of the node (bounded)

Suggested approach:
- compute `prefix = code.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 200))`
- use anchored regexes to detect keywords before the name/params

### 9.2 `yield*` detection
Tree-sitter’s `yield_expression` doesn’t differentiate `yield` vs `yield*` via a named child.
- detect with local text around node start: `/\\byield\\s*\\*/`

### 9.3 TS `import type` / `export type`
Detect with `^\\s*import\\s+type\\b` (similarly for export).

### 9.4 `for..in` vs `for..of`
`for_in_statement` has an `operator` token field (`in`/`of`) but it’s unnamed.
- compute operator via `code.slice(left.endIndex, right.startIndex)` or via a small regex in the header span

### 9.5 Optional chaining
`optional_chain` is a named child in call/member/subscript nodes.
- treat presence as a Yes/No attribute question (deep-only)

---

## 10) Implementation Checklist (turn this spec into code)

1) Add folder `src/lib/languages/javascript/` and create `jsCuration.ts` and `jsEngine.ts`.
2) Implement curated sections listed in §6.
3) Implement anchor walking and body traversal listed in §5.
4) Implement import grouping (virtual `import_group`) and question generator (§5.4, §7.2).
5) Implement core rules:
   - declarations (vars/functions/classes/methods/fields)
   - control flow
   - call expression statements
   - returns/throws
   - decorators
6) Add overlap/duplicate guard (reuse Python logic).
7) Integrate parsing:
   - server: update `src/lib/parser/treeSitterServer.ts` for JS/TS/TSX
   - client: update `src/lib/treeSitter.ts` and add wasm bundles for JS/TSX
8) Wire UI selection: choose engine based on parsed language id / extension.
