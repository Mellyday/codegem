# Import Question Reveal Behavior Notes

## `import_run.modules` Question Filtering Issue

**Date**: 2026-01-21  
**Status**: ✅ Fixed

### The Issue

The "Which modules are imported here?" question (`import_run.modules`) was being filtered out and not appearing in quizzes.

### Root Cause

The question was being **dropped by `applyQuestionOverlapGuard`**.

This function filters out questions whose span **contains** already-kept smaller questions:

```typescript
// Questions sorted by span length (smallest first)
// For each question, if its span CONTAINS an already-kept smaller question, DROP it
if (entryLen > smallestKeptLen) {
  const containsKept = kept.some(
    (k) =>
      entry.span.start <= k.span.start &&
      entry.span.end >= k.span.end
  );
  if (containsKept) {
    drop.add(entry.question);  // <-- Modules question was dropped here
  }
}
```

The modules question originally used `baseSourceRef` spanning the **entire import block**, which contained all the bindings questions (individual statements). Since bindings questions have smaller spans, they were kept first, and the modules question was dropped as overlapping.

### The Fix

Changed the modules question to use **statement-scoped spans** like bindings:

```typescript
// Compute scoped span for just the statements containing these modules
const stmts = card
  .map((m) => firstStmtByModule.get(m))
  .filter((s): s is TreeSitterAstNode => Boolean(s));
const cardSpan = stmts.length > 0
  ? { start: Math.min(...stmts.map((s) => s.startIndex)), end: Math.max(...stmts.map((s) => s.endIndex)) }
  : span;
const cardSourceRef = stmts.length > 0
  ? sourceRefForSpan(root, stmts[0], cardSpan, code)
  : baseSourceRef;
```

Now the modules question span matches the smallest bindings question span for that module, preventing overlap filtering.

### Why `import_run.bindings` Worked Correctly

The bindings question always used `stmtSourceRef` scoped to a single import statement, so it was never filtered out.

