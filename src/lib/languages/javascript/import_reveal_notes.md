# Import Question Reveal Behavior Notes

## Why `import_run.modules` Questions Are Currently Hidden

**Date**: 2026-01-21

### The Issue

The "Which modules are imported here?" question (`import_run.modules`) is currently not producing visible behavior because of how the reveal span is calculated.

### Root Cause

In `generateImportRunQuestions`, the modules question sets:

```typescript
revealStart: span.start,
revealEndBeforeChild: span.start,
revealEndAfterChild: span.start,  // All three are the same value!
```

In `buildCustomQuizPayload`, the `revealSpanForCard` function has this check (added in commit 8589526):

```typescript
if (end === start) return undefined;  // Zero-length span → undefined
```

Since all three reveal values are `span.start`, the computed `end === start`, so `revealSpan` becomes `undefined`.

### The Cascade Effect

When `revealSpan` is `undefined`, the snippet fallback logic kicks in:

```typescript
const spanForSnippet =
  q.generatorRule?.startsWith("import_run.") && revealSpan
    ? revealSpan          // Not taken because revealSpan is undefined
    : step.displaySpan ?? {...};  // Falls back to full import group span
```

This causes the modules question to display the **entire import block** as its snippet. Since everything is already visible, answering the question doesn't progressively reveal anything new.

### Why `import_run.bindings` Works Correctly

The bindings question uses:

```typescript
revealStart: stmtSpan.start,
revealEndAfterChild: stmtSpan.end,  // Points to a single import statement
```

Here `start !== end`, so the reveal span is valid and each binding question reveals just one import line at a time.

### Potential Fix

To restore the modules question with proper progressive reveal:
1. The modules question should reveal the module specifiers progressively
2. This requires computing a proper reveal span that covers just the revealed content
3. The `sourceRef` should be scoped to avoid pre-revealing the entire block

### Related Commits

- `58f0374`: Added `jsxElementNameSpan` helper and reveal options for JSX
- `dfdaa25`: Adjusted import reveal behavior (changed reveal spans)
- `a65b123`: Fixed import reveal snippet calculation  
- `8589526`: Tightened JSX children sourceRef and added zero-span filter
