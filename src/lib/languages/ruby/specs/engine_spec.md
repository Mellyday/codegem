# Ruby Engine Spec (v1)

This document specifies the Ruby equivalent of the existing Python engine:

- `src/lib/languages/python/pyCuration.ts`
- `src/lib/languages/python/pyEngine.ts`

It defines behavior for:
- anchors + traversal (“lesson steps”)
- curated sections + reveal spans (stable rule inputs)
- quiz rules (`shallow` vs `deep`)
- grouping for dependency declarations (`require`/`require_relative`)
- overlap/duplicate guard (reuse Python policy)

This is a **spec**, not an implementation.

---

## 0) Goals & Non-goals

### Goals
- Mirror the Python engine architecture for Ruby:
  - step generation is statement/declaration-level (not every expression)
  - curated sections normalize Ruby idiosyncrasies (args, blocks, rescue, etc.)
  - `deep` drills into params, defaults, blocks, and high-signal calls
  - dependency declarations are grouped into a single virtual step (import-like)
- Cover idiomatic Ruby constructs:
  - `require`, `require_relative`, `load`
  - classes/modules (inheritance)
  - instance/class/singleton methods
  - blocks (`do...end` / `{...}`), block params, `yield`
  - control flow (`if`/`unless`, `case`/`when`, `while`/`until`, `begin`/`rescue`/`ensure`)
  - assignments (including multiple assignment)

### Non-goals (v1)
- Full constant resolution / method lookup.
- Modeling Ruby metaprogramming semantics beyond surface syntax.
- Perfect coverage of all Ruby grammar versions; alias + node dumps required.

---

## 1) Folder Layout

- `src/lib/languages/ruby/rubyCuration.ts`
- `src/lib/languages/ruby/rubyEngine.ts`
- `src/lib/languages/ruby/specs/engine_spec.md` (this doc)

Keep exported API parity with Python:
- `generateEngineSteps`, `maskAndAnswerForStep`, `buildCustomQuizPayload`

---

## 2) Parsing Integration

Ruby parsing requires adding a grammar:
- Server: add `tree-sitter-ruby` and wire into `src/lib/parser/treeSitterServer.ts`.
- Client: add Ruby WASM grammar and wire into `src/lib/treeSitter.ts` (optional).

Recommended extensions:
- `.rb`

---

## 3) Core Concepts

Same as Python:
- anchors → `EngineStep`s
- curated sections drive quiz rules and header spans
- overlap guard removes redundant/nested quiz cards

Header questions must be recognizable:
- Stem: `Write the full header line`
- Generator rule: `header.line`

Ruby “headers” are typically the keyword line(s) before the body:
- `class X < Y`
- `module M`
- `def foo(a, b = 1, **kw, &blk)`
- `if cond`
- `case expr`
- `begin`

`headerEnd` should be the start of the body node/list for that construct.

---

## 4) Canonical Node Vocabulary (verify + alias)

Confirm actual node type names from the Ruby grammar you ship; Ruby grammars vary more than many languages.

Typical concepts:
- Root: `program`
- `class`, `module`
- method defs: `method`, `singleton_method` (or similar)
- `call` (method call), `block` (call with block)
- control flow: `if`, `unless`, `case`, `when`, `while`, `until`, `begin`/`rescue`/`ensure`
- assignments: `assignment`, `multiple_assignment`
- literals: `hash`, `array`, strings with interpolation

---

## 5) Engine Traversal Spec (`rubyEngine.ts`)

### 5.1 Statement extraction and filtering
Walk:
- `program` → top-level statements
- body nodes for class/module/method/control flow → contained statements
- block bodies

Filter out:
- `comment` nodes
- “magic comments” are comments anyway (`# frozen_string_literal: true`, `# typed: strict`)

### 5.2 Anchor node types (v1)

Top-level and nested:
- `class` (class definition)
- `module` (module definition)
- method defs (`method`, `singleton_method`)
- assignments (`assignment`, `multiple_assignment`)
- `hash` (hash literal)
- control flow (`if`, `unless`, `case`, `when`, loops, begin/rescue/ensure)
- `return`, `break`, `next` (names vary; alias)
- expression statements (especially `call` and `block` calls)

### 5.3 Diggability and traversal
Diggable when the node contains nested anchor statements.

Traversal order:
- emit anchor step
- then walk its body in source order:
  - class/module body
  - method body
  - if/unless branches
  - case/when branches
  - begin/rescue/ensure sections
  - loop body

### 5.4 Dependency grouping (required)
Ruby’s “imports” are runtime requires.

Group contiguous top-level require-like calls into a virtual `import_group` step.

What qualifies:
- a top-level `call` (or equivalent) to `require`, `require_relative`, or `load`
- only group **contiguous** runs (stop grouping when a non-require statement appears)

Virtual node:
- `type: "import_group"`
- `startIndex`: first require start
- `endIndex`: last require end
- `isVirtual: true`

Child steps:
- one per original require call, `generateQuiz:false`

Grouped quiz questions (see §7.2):
- `Which libraries/files are required here?` (multi)
- Deep-only: distinguish require vs require_relative vs load

### 5.5 Fallback quiz
Same as Python:
- rules first
- if quiz-worthy children exist → suppress fallback
- else allow “What comes next?” fallback for leaf anchors

---

## 6) Curation Spec (`rubyCuration.ts`)

### 6.1 Require-like calls (`call`)
Keys:
- `name`: method name (`require`, `require_relative`, `load`, etc.)
- `receiver`: explicit receiver if present (usually absent)
- `args`: argument expressions

### 6.2 `class` / `module`
Keys:
- `name`
- `superclass` (class only; optional)
- `body`

### 6.3 Method definitions
`method`:
- `name`
- `params`
- `body`

`singleton_method`:
- `receiver` (`self` or expression)
- `name`
- `params`
- `body`

Parameter curation (Ruby is idiosyncratic):
- `positional`: `a, b`
- `defaults`: `b = 1`
- `splat`: `*args`
- `keywords`: `k:, x: 1`
- `double_splat`: `**kw`
- `block_param`: `&blk`

Expose as:
- `params`: list of param nodes
- `defaults`: list of `{name,value}`

### 6.4 Blocks
Ruby blocks may be represented as:
- `block` node wrapping a `call` + block body, or
- a `do_block`/`brace_block` variant.

Keys:
- `call`: the underlying call
- `block_params`: block parameter list (optional)
- `body`: block body statements

### 6.5 Assignments
`assignment`:
- `target`
- `value`

`multiple_assignment`:
- `targets` (list)
- `values` (list)

### 6.6 Control flow
Provide `body` sections for header span computation.

`if` / `unless`:
- `condition`
- `then`
- `else` (optional)

`case`:
- `subject` (optional; case without subject uses `when` conditions)
- `whens` (list)
- `else` (optional)

`when`:
- `conditions` (list)
- `body`

Loops (`while`/`until`/`for`):
- `condition` / iterator spec
- `body`

`begin` / `rescue` / `ensure`:
- `body`
- `rescues` (list)
- `else` (optional)
- `ensure` (optional)

`rescue`:
- `exceptions` (list; optional)
- `binding` (optional `=> e`)
- `body`

### 6.7 High-signal expressions (deep-only)
Provide curated keys for:
- chained calls / receivers
- hash literals: keys + values
- string interpolation: interpolated expressions

---

## 7) Quiz Rules Spec

### 7.1 Header questions
For definitions/control flow with a clear header/body boundary:
- Stem: `Write the full header line`
- Generator rule: `header.line`
- Answer: `code.slice(node.startIndex, headerEnd)`

Applies to:
- class/module/method definitions
- if/unless, case/when, loops, begin/rescue/ensure sections

### 7.2 Import group (`import_group`)
Questions:
1) Multi-select: `Which libraries/files are required here?`
  - Correct: the string argument to `require`/`require_relative`/`load`
  - Exclude non-string requires (deep-only can handle them as raw expression)

Deep-only:
2) `Which of these use require_relative?` (multi)
3) `Which of these use load?` (multi)

### 7.3 Classes and modules
Always:
- header question
- `What is the class/module name?`

Class-only:
- if superclass exists: `What does this class inherit from?`

Deep:
- optional: scan top-of-body for `include`/`extend` calls and ask:
  - `Which modules are included?` (multi)
  - `Which modules are extended?` (multi)

### 7.4 Methods
Always:
- header question
- `What is the method name?`
- multi-select: `Which parameters does this method accept?` (names including `*args`, `**kw`, `&blk`)

Deep:
- defaults:
  - `What is the default value of parameter <x>?`
- keyword params:
  - `Which keyword parameters are accepted?` (multi)
- singleton methods:
  - `What is the receiver of this singleton method?` (often `self`)

### 7.5 Blocks
When a call has an attached block:
Always:
- `Which method is being called with a block?`
Deep:
- `Which parameters does the block accept?` (multi)

### 7.6 Assignments
`assignment`:
- `What is the left-hand target?`
- `What is the right-hand value?`

`multiple_assignment`:
- multi-select: `Which targets are assigned?`
- deep: ask first RHS value (limit to N=2)

### 7.7 Control flow
`if`/`unless`:
- header question
- deep: condition expression text

`case`/`when`:
- `What is the case subject?` (if present)
- per `when`: `Which conditions are matched?` (multi; include ranges, arrays, etc.)

`begin`/`rescue`/`ensure`:
- per rescue:
  - `Which exception class(es) are rescued?`
  - `What is the rescue binding name?` (if `=> e`)

`return`/`break`/`next`:
- if value present: `What value is returned/broken with?`

### 7.8 Expression statements (high-signal calls)
If an expression statement is a call:
- `What method is called?`
- deep: first argument (limit)

### 7.9 Hash literals (`hash`)
Hash literals are now anchor nodes themselves and generate questions about their contents.

Always:
- Multi-select: `Which keys are present in this hash?`
  - For hashes with >6 keys, split into multiple cards (3-6 correct per card)
  - Option pool drawn from surrounding code + generic distractors

Deep:
- Per key-value pair: `What is the value for key <key>?`
  - Recursively generates questions for nested values (calls, other hashes, etc.)
  - Nested questions prefixed with `For key <key>: <original stem>`

Hash literals are also detected and processed when they appear as:
- Assignment RHS values
- Method call arguments
- Return values

---

## 8) Shallow vs Deep Summary

Shallow:
- headers, names, “what is defined”
- require grouping

Deep:
- params + defaults + keyword/splat/block params
- block parameters
- rescue exception details
- limited call-arg drilling

---

## 9) Must-have Heuristics / Edge Cases

- Endless method definitions: `def foo = expr` (Ruby 3) may be a different node; alias required.
- One-line modifiers: `do_something if cond` / `expr rescue fallback` may parse differently.
- `class << self` singleton-class blocks: treat as an anchor with a body.
- `attr_reader`/`attr_accessor` are calls that define methods; optionally treat as “declaration-like” in deep.

---

## 10) Implementation Checklist

1) Add `rubyCuration.ts` and `rubyEngine.ts`.
2) Implement curated sections in §6 and header span logic.
3) Implement anchors + traversal in §5.
4) Implement require grouping (`import_group`) and grouped questions.
5) Implement quiz rules for definitions, control flow, assignments, blocks, and calls.
6) Reuse Python overlap guard logic.
7) Wire parsing and add a node-type dump tool for alias validation.

