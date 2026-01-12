# Go Engine Spec (v1)

This document specifies how to implement the Go (“golang”) equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines the desired behavior for:

- **Step generation** (what becomes an `EngineStep`, what is “diggable”, traversal order)
- **Curation** (stable `buildCuratedSections` keys per node type + reveal/header spans)
- **Quiz generation** (rules per construct; `shallow` vs `deep`)
- **Grouping** (imports first; optional future grouping for const/var/type blocks)
- **Dedupe/overlap guard** (same policy as Python)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Mirror the Python engine architecture for Go:
  - statement-level “anchors” produce lesson steps
  - expression-level knowledge is tested via quiz cards attached to anchors
  - curated sections normalize AST idiosyncrasies
  - `shallow` vs `deep` controls question granularity
  - import runs are grouped into a single virtual step (`import_group`)
- Cover idiomatic Go constructs:
  - `package`, `import` (including alias/blank/dot imports)
  - `const`/`var`/`type` declarations (including grouped blocks)
  - funcs/methods (receivers, results, variadic params)
  - structs/interfaces
  - control flow (`if`, `for`, `switch`, `select`, `defer`, `go`, `return`)
  - common compound expressions (selectors, calls, indexing/slicing, composite literals)

### Non-goals (v1)
- Full semantic resolution (import graph, symbol tables, type checking).
- Proving whether identifiers are “new” in `:=` (we can approximate with heuristics in v1).
- Perfect coverage of every grammar variant across Go versions; use aliasing + node dumps and iterate.

---

## 1) Folder Layout (mirrors Python/JS)

Create a sibling folder:

- `src/lib/languages/go/goCuration.ts`
- `src/lib/languages/go/goEngine.ts`
- `src/lib/languages/go/specs/engine_spec.md` (this doc)

Keep the exported surface area compatible with `pyEngine.ts`:

- `generateEngineSteps(root, node, code, options)`
- `maskAndAnswerForStep(step, root, code)`
- `buildCustomQuizPayload(...)`

Reuse the shared `EngineStep`, `QuizQuestion`, and `SourceRef` shapes.

---

## 2) Parsing Integration (repo touchpoints)

This repo currently parses Python (and has JS/TS deps). Adding Go requires:

- Server: add `tree-sitter-go` to dependencies and wire it into `src/lib/parser/treeSitterServer.ts`.
- Client: add Go WASM grammar + wire into `src/lib/treeSitter.ts` (WASM) if you want client-side parsing.

Recommended extensions:
- `.go`

---

## 3) Core Concepts (same as Python)

### 3.1 Anchor nodes
Anchor nodes are AST nodes that produce lesson steps. The Go engine should **not** create steps for every expression by default.

Instead:
- anchors are declarations and statements (file-level + within blocks)
- quiz rules attached to an anchor ask about sub-parts (names, params, operands, etc.)
- in `deep`, we may “bubble up” questions for high-value subexpressions (e.g., anonymous func literals used as values)

### 3.2 Curated sections
Implement:
- `buildCuratedSections(node)` → `{ key, items }[]`
- helpers: `getSectionItems`, `getSectionFirstItem`, `getSectionSpan`, `getRevealAnchors`

Quiz rules should consume curated sections instead of scraping `namedChildren` directly.

### 3.3 Reveal anchors & masking
Go “headers” are everything before the body block:
- `func f(...) ... {` (header ends at `{`)
- `if ... {` / `for ... {` / `switch ... {` / `select {`

Define:
- `headerEnd`: startIndex of the body node when present (usually a `block`)
- `displaySpan`: by default use `node.startIndex..headerEnd` for header-heavy constructs

### 3.4 Overlap guard
Use the same policy as Python (`pyEngine.ts`):
- drop duplicates (same span + stem + answer)
- drop umbrella questions whose span contains a smaller question span
- keep header questions exempt (stem `Write the full header line` and/or `generatorRule: "header.line"`)

---

## 4) Canonical Tree-sitter Node Vocabulary (verify + alias)

You must confirm actual node type names from the Go grammar you ship. In v1 we assume upstream `tree-sitter-go` conventions; implement an alias layer and a node-type dump utility.

Typical root and containers:
- Root: `source_file`
- Block: `block`

Common file-level declarations:
- `package_clause`
- `import_declaration` (single or parenthesized import specs)
- `const_declaration`, `var_declaration`, `type_declaration`
- `function_declaration`, `method_declaration`

Common statements inside blocks:
- `short_var_declaration` (`:=`)
- `assignment_statement` (`=`, multi-assign)
- `inc_statement` (`x++`, `x--`)
- `if_statement`, `for_statement`
- `expression_switch_statement`, `type_switch_statement`
- `select_statement`
- `return_statement`, `go_statement`, `defer_statement`, `branch_statement` (`break`/`continue`/`goto`)
- `expression_statement`

Common expression nodes (for deep questions):
- `call_expression`
- `selector_expression` (`x.y`)
- `index_expression` (`x[i]`)
- `slice_expression` (`x[a:b]`)
- `type_assertion_expression` (`x.(T)`)
- `unary_expression`, `binary_expression`
- literals: `int_literal`, `float_literal`, `rune_literal`, `interpreted_string_literal`, `raw_string_literal`
- `composite_literal` (struct/array/map literals)
- `function_literal` (anonymous functions)

---

## 5) Engine Traversal Spec (`goEngine.ts`)

### 5.1 Statement extraction and filtering
Equivalent to Python’s `getStatementChildren`, but for Go containers:

Containers to walk:
- `source_file` → top-level declarations (package/import/decls)
- `block` → statements
- switch/select case blocks → clause bodies (see below)

Filter out:
- `comment` nodes
- (optional) empty statements / semicolons if they appear as nodes

Go has no docstring expression statements; doc comments are comment nodes → filtering comments is sufficient.

### 5.2 Anchor node types (v1)
Anchors should include:

File scope:
- `package_clause`
- `import_declaration` (but generally suppressed by `import_group` virtual step; see §5.4)
- `const_declaration`, `var_declaration`, `type_declaration`
- `function_declaration`, `method_declaration`

Block scope:
- `short_var_declaration`
- `assignment_statement`
- `inc_statement`
- `if_statement`, `for_statement`
- `expression_switch_statement`, `type_switch_statement`
- `select_statement`
- `return_statement`, `go_statement`, `defer_statement`, `branch_statement`
- `expression_statement` (with special handling for calls; see quiz rules)

### 5.3 Diggability & body traversal
A step is diggable when its body contains anchor statements.

Body mapping (typical):
- `function_declaration` / `method_declaration` → `body: block`
- `if_statement` → `consequence: block`, optional `else` (either another `if_statement` or a `block`)
- `for_statement` → `body: block`
- switches/select:
  - `expression_switch_statement` / `type_switch_statement` → `body` contains `case_clause[]`
  - `select_statement` → `body` contains `communication_clause[]`
  - each clause contains a statement list or block-ish node; traverse its statements

Traversal order:
- emit the anchor step for the node
- then walk its body/clause bodies in source order, emitting child steps for anchors

### 5.4 Import grouping (required)
Mirror Python’s “import run” grouping, but adapted to Go:

What counts as an import:
- `import_declaration` at file scope

Grouping policy:
- group **contiguous** `import_declaration` nodes into one virtual `import_group` step
- if an `import_declaration` contains a parenthesized list of specs, it still participates as one member of the run

Virtual node:
- `type: "import_group"`
- `startIndex`: first import decl start
- `endIndex`: last import decl end
- `isVirtual: true`

Child steps:
- one child step per original `import_declaration` with `generateQuiz:false` so lesson can “dig” into exact lines without quizzing them individually

Grouped quiz questions (see §7.2):
- “Which packages are imported here?” (multi)
- Deep-only: “Which local names/aliases are used for these imports?” (alias mapping)

### 5.5 Fallback quiz policy
Same as Python:
- if rule questions exist → use them
- else if node has quiz-worthy children → no fallback (encourage dig)
- else allow a minimal fallback “What comes next?” for leaf-y anchors

Maintain a `NO_FALLBACK_QUIZ_NODE_TYPES` list for:
- imports (handled via grouping)
- control flow headers
- function/method/type declarations

---

## 6) Curation Spec (`goCuration.ts`)

Implement the same helper set as Python (`childrenOfType`, `childByField`, `collectDescendants`, etc.) and then define curated sections for Go constructs.

### 6.1 `package_clause`
Keys:
- `name`: package identifier

### 6.2 `import_declaration`
Keys:
- `specs`: import specs (single or multiple inside parentheses)

### 6.3 Import spec (often `import_spec`)
Keys:
- `path`: string literal path (e.g., `"fmt"`)
- `name`: optional local name / alias
  - can be identifier, `_`, or `.`

### 6.4 `const_declaration` / `var_declaration`
Keys:
- `specs`: each `const_spec` / `var_spec`

`const_spec` / `var_spec` (typical):
- `names`: identifiers (can be multiple)
- `type`: optional type node
- `values`: expressions (can be multiple)

### 6.5 `type_declaration`
Keys:
- `specs`: each `type_spec`

`type_spec`:
- `name`
- `type_params`: optional type parameter list (Go 1.18+)
- `value`: the underlying type (struct/interface/alias)

### 6.6 `function_declaration`
Keys:
- `name`
- `type_params`: optional
- `params`: parameter list
- `results`: result list (can be absent, unnamed single type, or named list)
- `body`: block

### 6.7 `method_declaration`
Keys:
- `receiver`: receiver parameter (name + type)
- all `function_declaration` keys above

### 6.8 Parameters & results
Parameter list keys:
- `params`: parameters (each may bind one or more names to a type)
- `variadic`: mark variadic param (`...T`) via heuristic or node type

Result list keys:
- `results`: result items (type-only or name+type)

### 6.9 Struct & interface types
`struct_type`:
- `fields`: field declarations

`interface_type`:
- `methods`: method specs / embedded types

For a field declaration:
- `names` (0+; embedded fields have no names)
- `type`
- `tag` (optional string tag)

### 6.10 Control flow headers
Provide `body` keys for `if_statement`, `for_statement`, switch/select statements and clause nodes so `getRevealAnchors` can compute `headerEnd`.

### 6.11 High-signal expressions (deep-only rules consume these)
Provide curated keys for:
- `call_expression`: `callee`, `args`
- `selector_expression`: `object`, `property`
- `index_expression`: `object`, `index`
- `slice_expression`: `object`, `start`, `end`, `step?` (Go slices don’t have step; but 3-index slices exist: `a[b:c:d]`)
- `composite_literal`: `type`, `elements`
- `keyed_element`: `key`, `value`

---

## 7) Quiz Rules Spec (node → questions)

Follow Python conventions:
- `stem` is natural-language
- `answerLabel` is correct answer
- multi-select cards use:
  - `questionType: "multi"`
  - `multiCorrect: string[]`
  - option pools ~10 items
- include `sourceRefs` for anchor + subnode
- set reveal spans using `getSectionSpan` when possible

### 7.1 Header questions (control flow + definitions)
For nodes with a clear header/body boundary, include:
- Stem: `Write the full header line`
- Generator rule: `header.line`
- Answer: `code.slice(node.startIndex, headerEnd)`

Applies to:
- `function_declaration`, `method_declaration`
- `if_statement`, `for_statement`
- `expression_switch_statement`, `type_switch_statement`
- `select_statement`
- clause nodes (`case_clause`, `communication_clause`) when they have a clear “label” header before their statement list

### 7.2 Import group (`import_group`)
Produced by grouping logic, not AST.

Questions:
1) Multi-select: `Which packages are imported here? (use import paths; ignore local names)`
  - Correct: import paths (string contents or quoted; choose one format and stick to it)
  - Reveal: entire group span

Deep-only:
2) Alias mapping (single or multi):
  - `What local name is used for import "<path>"?`
  - Include `_` and `.` cases explicitly (blank/dot imports)
  - If no explicit alias, either:
    - skip (v1), or
    - answer with derived default name (last path segment) and label as “implicit”

### 7.3 Package clause (`package_clause`)
Optional (but recommended in shallow for file-level understanding):
- `What package is declared in this file?` → package name

### 7.4 Functions (`function_declaration`)

Always:
- Header question
- `What is the function name?`
- Multi-select: `Which parameters does this function take?`
  - Use bound names; for unnamed params (rare), use type text
- If results exist:
  - `What are the return result types?` (multi)
  - If named results: `Which named return values are declared?` (multi)

Deep:
- Variadic:
  - `Is this function variadic?` (Yes/No)
  - `What is the variadic parameter name?` (if named)
- Type parameters (Go 1.18+):
  - multi-select type parameter names
  - optional: constraint text questions
- Anonymous function literals inside:
  - if a RHS contains `function_literal`, bubble up its function questions (like Python’s lambda bubble-up)

### 7.5 Methods (`method_declaration`)

Always:
- Header question
- `What is the receiver name?`
- `What is the receiver type?` (include `*T` pointer receivers)
- `What is the method name?`
- Then reuse function param/result questions

### 7.6 Type declarations (`type_declaration`)

Always:
- `Which type names are declared here?` (multi; handles grouped `type (...)`)

For each `type_spec` (deep; or shallow if it’s the only one):
- `What is the underlying type of <Name>?` (single; e.g., `struct{...}`, `interface{...}`, alias type)

Struct types:
- Multi-select: `Which fields are declared on this struct?`
  - Include embedded fields (type name) as “fields”
- Deep: field tag questions:
  - `What is the tag for field <X>?` (if present)

Interface types:
- Multi-select: `Which methods are declared on this interface?`
  - Include embedded interfaces/types as “embedded”

### 7.7 Const/var declarations

Always:
- Multi-select: `Which names are declared here?`

Deep:
- For each spec:
  - If it has values: `What value initializes <name>?` (single; for multi-assign, ask per position up to a limit)
  - If it has an explicit type: `What is the declared type?`

### 7.8 Short var declarations (`:=`)

Always:
- Multi-select: `Which names are bound by this short declaration?`
  - Include `_` but treat it as a special distractor-resistant token
- `What is the right-hand expression(s)?` (single if one; multi if multiple values)

Deep:
- If RHS includes a call returning multiple values: optionally ask about function called + argument #1

### 7.9 Assignments / inc statements

`assignment_statement`:
- `What is the left-hand target(s)?`
- `What is the right-hand value(s)?`
- If operator assignment exists (e.g., `+=`): ask operator token via text span

`inc_statement`:
- `Is this an increment or decrement?` (answer `++`/`--`)
- `What variable is being updated?`

### 7.10 Control flow

`if_statement`:
- Header question
- Deep: `What is the if condition?`
- If `else` exists:
  - emit child step for else branch (block or else-if)

`for_statement`:
- Header question
- Distinguish forms (deep-only):
  - 3-clause `for init; cond; post {}`: ask init/cond/post
  - condition-only `for cond {}`: ask cond
  - infinite `for {}`: ask “Is this an infinite loop?” (Yes/No)
  - range `for k, v := range expr {}`: ask:
    - `What is being ranged over?`
    - `Which loop bindings are used?` (multi; include `_`)

Switches:
- `expression_switch_statement`:
  - header question
  - deep: `What value is being switched on?`
- `type_switch_statement`:
  - header question
  - deep: `What expression is type-switched on?`
- For each `case_clause`:
  - header question (the `case ...:` line)
  - deep: `What are the case expressions/types?` (multi) or `default`

Select:
- `select_statement` header question
- For each `communication_clause`:
  - header question (`case ch <- x:` / `case v := <-ch:` / `default:`)
  - deep: identify channel and value expressions

### 7.11 `defer_statement` / `go_statement`
Always:
- `What function is invoked?` (callee of the call expression)

Deep:
- If the invoked expression is a `call_expression`, use the call-expression rules below

### 7.12 Returns and branches
`return_statement`:
- If it returns values:
  - `What value is returned?` (or multi for multiple)

`branch_statement`:
- `Which branch keyword is used?` (`break`/`continue`/`goto`/`fallthrough`)
- If label present: `What label is targeted?`

### 7.13 Call expressions (deep-only bubble)
When a statement is a lone call (often used for side effects):
- Shallow: `What function is called?` → full call text (includes args)
- Deep:
  - Simple calls: callee question + ordered multi-select for arguments
  - Chained calls/properties: step-by-step base/field/method, with ordered args per call
  - Composite literals in call arguments: recursively process any embedded composite literals

### 7.14 Composite literals (`composite_literal`)
Go composite literals (struct, map, array/slice literals) generate questions about their key-value structure.

Always:
- Multi-select: `Which <fields/keys/indices> are set in this <struct/map/array>?`
  - For structs: asks about field names
  - For maps: asks about map keys
  - For arrays with keyed elements: asks about indices
  - For literals with >6 keys, split into multiple cards (3-6 correct per card)
  - Option pool drawn from surrounding code + generic identifiers

Deep:
- Per keyed element: `What is the value for <field/key> <X>?`
  - Always generated for each keyed element
  - Recursively generates questions for nested composite literals and func literals
  - Nested questions prefixed with `For <field/key> X: <original stem>`

Composite literals are detected and processed when they appear as:
- Variable initializers (`var x = MyStruct{...}`)
- Short variable declarations (`x := MyStruct{...}`)
- Function call arguments
- Return statement values

---

## 8) Shallow vs Deep Summary

Shallow should focus on:
- headers
- names declared (package/import/type/func/var/const)
- high-level “what is this statement doing?”

Deep adds:
- param/result details, receivers, type params
- destructured/multi-assign details
- range loop binding/value details
- switch/select clause specifics
- limited call argument drilling

---

## 9) Must-have Heuristics / Edge Cases

- Import aliases:
  - `import _ "x"` (side-effect)
  - `import . "x"` (dot import)
  - `import alias "x"`
  - implicit name derived from path (deep-only optional)
- Blank identifier `_`:
  - treat as a valid “binding” but do not distract it away accidentally
- `yield`/generators do not exist; don’t copy Python generator logic
- 3-index slices: `a[b:c:d]` (if grammar supports)
- Go generics: node naming varies across grammars; alias required

---

## 10) Implementation Checklist

1) Create `src/lib/languages/go/goCuration.ts` and `src/lib/languages/go/goEngine.ts`.
2) Implement `buildCuratedSections` keys from §6.
3) Implement anchor walking and body traversal from §5.
4) Implement import grouping and grouped questions (§5.4, §7.2).
5) Implement quiz rules for:
   - package/import/type/func/method/const/var
   - if/for/switch/select/defer/go/return
6) Reuse the overlap guard logic from Python.
7) Add parsing support (server + optional WASM client).
8) Add a dev-only “node type dump” utility to validate alias mappings.
