# Unimplemented JavaScript/TypeScript Expression Nodes

This document catalogs expression nodes that are **not yet covered** by the question generation engine in `jsEngine.ts`. Implementing handlers for these will achieve 100% exhaustive coverage of JS/TS expression nodes.

---

## Currently Implemented

The `rules` map (line ~3256) and `addExprQuestions` handle:

| Category | Node Types |
|----------|-----------|
| **Statements** | `import_statement`, `export_statement`, `lexical_declaration`, `variable_declaration`, `function_declaration`, `generator_function_declaration`, `class_declaration`, `method_definition`, `field_definition`, `public_field_definition`, `if_statement`, `else_clause`, `for_statement`, `for_in_statement`, `while_statement`, `do_statement`, `switch_statement`, `switch_case`, `switch_default`, `try_statement`, `catch_clause`, `finally_clause`, `return_statement`, `throw_statement`, `break_statement`, `continue_statement`, `expression_statement` |
| **Expressions** | `call_expression`, `arrow_function`, `object`, `assignment_expression`, `augmented_assignment_expression` |
| **JSX** | `jsx_element`, `jsx_self_closing_element`, `jsx_fragment`, `jsx_expression`, `jsx_attribute` |

---

## Core Expression Nodes — Detailed Status

> [!IMPORTANT]
> These are the foundational expression nodes you specifically asked about. Most are **recognized but don't generate quiz questions**.

### `identifier`
**Status**: ⚠️ Recognized, NOT questioned

**Current usage** (lines 754, 1342, 2337, 2373):
- Checked for type detection (e.g., `if (callee.type === "identifier")`)
- Used to extract names for labels
- **No standalone questions** like "What identifier is this?"

**Missing questions**:
- "What variable/binding is referenced here?"
- "What is the name of this identifier?"

---

### `member_expression` / `subscript_expression`
**Status**: 
- `member_expression`: ⚠️ Traversed, NOT questioned
- `subscript_expression`: ❌ **Completely missing**

**Current usage for `member_expression`** (lines 2069, 2341):
- Decomposed in `decomposeCallChain` to extract `.property` for call chain questions
- Used to detect method calls like `.map()`, `.createPortal()`
- **No direct questions** about property access

**Missing questions**:
- "What property is being accessed?"
- "What object is the base of this member access?"
- "Is this optional chaining (`?.`)?"
- For subscript: "What index/key is used?"

---

### `ternary_expression` (conditional_expression)
**Status**: ⚠️ Labeling only, NOT questioned

**Current usage** (line 2452 in `describeJsxExpressionLabel`):
- Used to label JSX children as `EXPR(Component?)` for conditional rendering
- Extracts consequence/alternative branches for tag naming
- **No quiz questions** about the condition itself

**Missing questions**:
- "What is the condition?"
- "What is the true/false branch value?"
- "Is this a conditional expression?"

---

### `binary_expression` / `logical_expression`
**Status**: ⚠️ Labeling only, NOT questioned

**Current usage** (lines 2406, 2417, 2470):
- Operator detection (`&&`, `||`, `??`) for JSX expression labeling
- Used in `operatorTextForBinaryOrLogical` helper
- **No quiz questions** about operands or operators

**Missing questions**:
- "What is the operator?"
- "What is the left/right operand?"
- "Is this a short-circuit evaluation?"

---

### `template_string` / `template_literal`
**Status**: ❌ **Completely missing**

**Current usage**: Zero references in `jsEngine.ts`

**Missing questions**:
- "What interpolations are in this template?"
- "Is this a tagged template?"
- "What static parts are in this template?"

---

## 1. Primary Refs — NOT IMPLEMENTED

| Node Type | Example | Priority | Status |
|-----------|---------|----------|--------|
| `this` | `this.state` | 🔴 High | ❌ Not found |
| `super` | `super.method()` | 🟡 Medium | ❌ Not found |
| `meta_property` | `new.target`, `import.meta` | 🟡 Medium | ❌ Not found |
| `private_property_identifier` | `this.#privateField` | 🟡 Medium | ❌ Not found |

---

## 2. Literals — NOT IMPLEMENTED

| Node Type | Example | Priority |
|-----------|---------|----------|
| `number` | `42`, `3.14`, `0xFF` | 🟢 Low |
| `string` | `"hello"`, `'world'` | 🟢 Low |
| `true` / `false` | boolean literals | 🟢 Low |
| `null` | `null` | 🟢 Low |
| `regex` | `/pattern/gi` | 🟡 Medium |

---

## 3. Containers / Composite Literals — PARTIAL

| Node Type | Status | Notes |
|-----------|--------|-------|
| `array` | ❌ Not implemented | No spread/element questions |
| `object` | ✅ Implemented | Via `ruleObjectLiteral` |
| `parenthesized_expression` | ⚠️ Unwrapped only | `unwrapParenExpression` exists |
| `sequence_expression` | ❌ Not implemented | Comma operator |

---

## 4. Operators — PARTIAL

| Node Type | Status | Notes |
|-----------|--------|-------|
| `unary_expression` | ❌ Not implemented | `!x`, `typeof x`, `delete x` |
| `update_expression` | ❌ Not implemented | `x++`, `--x` |
| `binary_expression` | ⚠️ Labeling only | No quiz questions |
| `ternary_expression` | ⚠️ Labeling only | No quiz questions |
| `await_expression` | ❌ Not implemented | `await promise` |
| `yield_expression` | ❌ Not implemented | `yield value` |

---

## 5. Calls / Construction / Chaining — PARTIAL

| Node Type | Status | Notes |
|-----------|--------|-------|
| `call_expression` | ✅ Implemented | Via `buildCallQuestions` |
| `new_expression` | ❌ Not implemented | `new ClassName()` |
| `tagged_template` | ❌ Not implemented | `` gql`...` `` |
| `chain_expression` | ❌ Not implemented | Optional chain wrapper |
| `optional_chain` | ⚠️ Detection only | Flag for optional call |
| `import` (dynamic) | ❌ Not implemented | `import('./module')` |

---

## 6. Spread — PARTIAL

| Node Type | Status |
|-----------|--------|
| `spread_element` | ⚠️ JSX props only |

---

## 7. Function/Class Expressions — PARTIAL

| Node Type | Status |
|-----------|--------|
| `arrow_function` | ✅ Implemented |
| `function_expression` | ⚠️ Listed in FUNCTION_LIKE set, no rule |
| `class` (expression) | ❌ Not implemented |

---

## 8. TypeScript-Only — NOT IMPLEMENTED

| Node Type | Example | Priority |
|-----------|---------|----------|
| `as_expression` | `x as T` | 🔴 High |
| `type_assertion` | `<T>x` | 🟡 Medium |
| `non_null_expression` | `x!` | 🔴 High |
| `satisfies_expression` | `x satisfies T` | 🟡 Medium |

---

## Implementation Priority Summary

| Priority | Node Types |
|----------|-----------|
| 🔴 **High** | `identifier`, `member_expression`, `subscript_expression`, `ternary_expression`, `binary_expression`, `template_string`, `this`, `new_expression`, `await_expression`, `as_expression`, `non_null_expression` |
| 🟡 **Medium** | `unary_expression`, `update_expression`, `yield_expression`, `tagged_template`, `super`, `regex` |
| 🟢 **Low** | Literals (`number`, `string`, `null`, booleans), `sequence_expression` |

---

## Next Steps

1. **Add rules entries** for high-priority nodes
2. **Convert labeling-only code** to generate actual questions
3. **Handle subscript_expression** (currently zero coverage)
4. **Add template_string support** (currently zero coverage)
5. **Add tests** in `jsEngine.test.ts`
