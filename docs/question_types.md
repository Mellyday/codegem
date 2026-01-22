# Question Types

This document describes the different question types supported by the quiz engine.

## Overview

| Type | Description | Order Matters? |
|------|-------------|----------------|
| `single` | Single choice - pick one answer | N/A |
| `multi` | Multi-select - pick all correct answers | No |
| `orderedMulti` | Multi-select with ordering | Yes |
| `sequence` | Sequence-based (JS only) | Yes |
| `mapping` | Key-value pair matching | No |

## Type Details

### `single`
Standard single-choice question where the user selects one correct answer from multiple options.

### `multi`
Multi-select question where the user can select multiple correct answers. The order of selection does not matter.

### `orderedMulti`
Multi-select question where the user must select answers **in a specific order**. Used when the sequence of selections is important (e.g., ordering function parameters, chained method calls).

### `sequence`
A sequence-based question type **specific to JavaScript/TypeScript**. Used for import statement ordering where the user must arrange items in the correct sequence.

### `mapping`
A key-value pair matching question where the user matches keys to their corresponding values. **Order does not matter.**

#### Motivation

Previous struct/interface quizzing had a spoiler problem:
- Q1: "What is the underlying type?" → Shows full struct with all fields
- Q2: "Which fields are declared?" → Already spoiled by Q1

The `mapping` type solves this by quizzing field-type relationships directly without revealing the full structure upfront.

#### Data Structure

```typescript
type MappingQuestion = {
  questionType: "mapping";
  stem: string;                    // e.g., "Match each field to its type"
  pairs: Array<{
    key: string;                   // e.g., "ID", "EncKey"
    value: string;                 // e.g., "string", "[]byte"
  }>;
  matchlessKeys?: string[];        // Keys that don't need pairing (embedded types)
  keyDistractors?: string[];       // Additional fake keys
  valueDistractors?: string[];     // Additional fake values
};
```

#### Matchless Keys

Some keys don't require a value match. This is used for **embedded types** in Go:

```go
type Reader struct {
    io.Reader       // ← embedded, no explicit type to match
    bufSize int
}
```

Here, `io.Reader` is a matchless key. The user identifies it as embedded (no pairing needed).

#### Distractors

Both keys and values have distractors:
- **Key distractors**: Fake field/method names not in the actual struct/interface
- **Value distractors**: Fake types not actually used

During testing, basic distractor generation is used. In production, LLM generates contextually relevant distractors.

#### Splitting Large Structures

For structs/interfaces with many fields (>6), the mapping is split into multiple smaller questions using the existing `splitCorrectIntoCards` logic.

#### Use Cases by Language

| Language | Construct | Key | Value |
|----------|-----------|-----|-------|
| **Go** | struct | field name | field type (incl. tags: `string \`json:"id"\``) |
| **Go** | interface | method name | full signature `(p []byte) (n int, err error)` |
| **TypeScript** | interface/type | property name | type annotation |
| **Python** | TypedDict/dataclass | field name | type hint |
| **Java** | class fields | field name | type |
| **C** | struct | member name | type |

#### Example: Go Struct

```go
type FileServerOpts struct {
    ID               string
    EncKey           []byte
    StorageRoot      string
    PathTransformFunc PathTransformFunc
    Transport        p2p.Transport
    BootstrapNodes   []string
}
```

Generated mapping question:
```json
{
  "questionType": "mapping",
  "stem": "Match each field to its type",
  "pairs": [
    { "key": "ID", "value": "string" },
    { "key": "EncKey", "value": "[]byte" },
    { "key": "StorageRoot", "value": "string" },
    { "key": "PathTransformFunc", "value": "PathTransformFunc" },
    { "key": "Transport", "value": "p2p.Transport" },
    { "key": "BootstrapNodes", "value": "[]string" }
  ],
  "keyDistractors": ["Config", "Timeout", "Logger"],
  "valueDistractors": ["int", "error", "bool"]
}
```

#### When NOT to Use Mapping

For simple type aliases without structure, use regular `single` questions:

```go
type UserID string      // → single: "What is the underlying type of UserID?"
type Counter int64      // → single question
```

## Language Support

| Language | `single` | `multi` | `orderedMulti` | `sequence` | `mapping` |
|----------|----------|---------|----------------|------------|-----------|
| JavaScript/TypeScript | ✅ | ✅ | ✅ | ✅ | ✅ |
| Python | ✅ | ✅ | ✅ | ❌ | ✅ |
| Ruby | ✅ | ✅ | ✅ | ❌ | ✅ |
| Go | ✅ | ✅ | ✅ | ❌ | ✅ |
| Java | ✅ | ✅ | ✅ | ❌ | ✅ |
| C | ✅ | ✅ | ✅ | ❌ | ✅ |
