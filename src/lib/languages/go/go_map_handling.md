# Go Map Handling

Maps are handled via the `ruleCompositeLiteral` rule, which fires **only for inline map literals** (e.g., `map[string]int{"a": 1}`).

## Questions Generated for Map Literals

| Question Kind | Stem | Answer |
|--------------|------|--------|
| `composite.type` | "What is the type of this map literal?" | Full type text (e.g., `map[string]int`) |
| `composite.keys` | "Which keys are present in this map literal?" | Multi-select of all keys |
| `composite.value` | "What is the value for key X?" | Value for each key (one question per key) |

The `compositeLiteralLabel` function distinguishes maps from structs:
- For `map_type` nodes: uses "keys"/"key"/"map" terminology
- For `struct_type` nodes: uses "fields"/"field"/"struct" terminology

## Variable Declarations Referencing Maps

For declarations like `var grade = existingMap`:

| Question Kind | Stem | Answer |
|--------------|------|--------|
| `decl.names` | "Which names are declared here?" | `["grade"]` (multi-select) |
| `decl.value` (deep only) | "What value initializes grade?" | `"existingMap"` (identifier text) |

**No map-specific questions** are generated for the referenced variable—the map's structure is quizzed where it's originally defined, not where it's referenced.

## What's NOT Covered

- **Type declarations** (`type MyMap map[string]int`) don't generate map-specific questions
- **Empty map literals** (`map[string]int{}`) generate no element questions
- **`make(map[...]...)`** calls are not specifically targeted for map questions

---

# Map/KV Type Handling Across Languages

## Summary Table

| Language | KV Type | Node Type | Handler Rule | Keys Question | Value Question |
|----------|---------|-----------|--------------|---------------|----------------|
| **Go** | map | `composite_literal` with `map_type` | `ruleCompositeLiteral` | ✅ multi-select | ✅ per key |
| **Python** | dict | `dictionary` | `rules.dictionary` | ✅ multi-select | ✅ per key |
| **Ruby** | hash | `hash` | `case "hash"` | ✅ multi-select | ✅ per key |
| **JavaScript** | object | `object` | `ruleObjectLiteral` | ✅ multi-select | ✅ per key |
| **Java** | Map | N/A | ❌ Not implemented | ❌ | ❌ |
| **C** | N/A | N/A | ❌ No KV type | ❌ | ❌ |

## JavaScript — Object Literals

Rule: `ruleObjectLiteral` (line 3111+)

Handles:
- `pair` nodes (key-value pairs)
- `shorthand_property_identifier` (e.g., `{ foo }` where key=value=foo)
- `method_definition` (e.g., `{ foo() {} }`)

| Question Kind | Stem |
|--------------|------|
| `object.keys` | "Which keys are present in this object literal?" |
| `object.value` | "What is the value for key X?" |

Recursively generates questions for nested values.

## Python — Dictionary

Rule: `rules.dictionary` (line 1220+)

Handles `dictionary` nodes containing `pair` children.

| Question Kind | Stem |
|--------------|------|
| `dict-keys` | "Which keys are present in this dict?" |
| `dict.value` | "What is the value for key X?" |

Recursively generates questions for nested values (prefixed with `For key X:`).

## Ruby — Hash

Rule: `case "hash"` in `generateQuestionsForAnchor` (line 1000+)

Handles `hash` nodes containing `pair` children.

| Question Kind | Stem |
|--------------|------|
| `hash.keys` | "Which keys are present in this hash?" |
| `hash.value` | "What is the value for key X?" |

Hash literals are also bubbled up from assignments by `findHashLiteralNodes`.

## Common Patterns

All implementations share these patterns:

1. **Keys Question**: Multi-select asking which keys are present
2. **Value Question**: Per-key question asking for the value
3. **Recursive Descent**: Nested values get their own questions (prefixed with context)
4. **Card Splitting**: Large key sets are split into cards of 6 (via `splitCorrectIntoCards`)
5. **Option Pool Building**: Uses `buildKeyGroupOptionPool` or similar to generate distractors
