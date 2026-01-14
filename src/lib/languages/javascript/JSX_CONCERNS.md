# JSX Expression Handling - Known Concerns & Future Improvements

This document tracks potential issues and improvement opportunities related to the JSX expression handling in `jsEngine.ts`.

---

## A) Regression Risks

### B) Child Element "Directly Nested" List Regression

The change from "push each nested JSX element immediately" to "store `kind: 'expr'` and process later" is good overall, **as long as** the `childNames` computation includes `item.elements` for `kind: "expr"` (same as map).

**Watch for:** If the "Which child elements are directly nested…" question suddenly stops including children that appear inside `{cond && <X/>}`, check the `childNames` computation first.

---

### C) Question Explosion / Performance

`addExprQuestions` is now called in more places:
- Each prop expression
- Each spread prop expression  
- Each children expression
- Map call expression too

**Risk:** Depending on how aggressive `generateQuestionsV11` is, this could balloon output on big JSX trees.

**Mitigation options (if needed):**
```typescript
// Only run addExprQuestions when profile === "deep"
// OR cap number of expression-question batches per JSX node
```

Not required now, but flagged for future reference.

---

### D) `jsxElementName` Fallback Removal

The fallback `firstChildOfTypes(...)` was removed; now relies purely on curated `"name"`.

**This is fine if** `buildCuratedSections` is guaranteed for every node passed to `jsxElementName`.

**Risk:** If any path calls it on a raw Tree-sitter node without sections, you'll get more `undefined` / `"JSXElement"` labels than before.

Not a correctness bug, but can reduce question specificity.

---

## B) Suggested Improvements

### 1) Rename `jsxExpr` Parameter

Since it's now used for spread attributes too, it's more like "extract expression-ish child from JSX container node".

**Current:**
```typescript
const exprFromJsxExpression = (jsxExpr: TreeSitterAstNode) => ...
```

**Suggested:**
```typescript
const exprFromJsxContainer = (jsxNode: TreeSitterAstNode) => ...
// or: exprFromJsxExprOrSpread
```

---

### 2) Consider Skipping Comments / Punctuation in Fallback

`namedChildren` is usually correct, but in edge cases `namedChildren[0]` might be an identifier or something that isn't the real payload (rare, but possible with error nodes / incomplete code).

**More defensive fallback:**
```typescript
const kids = (jsxExpr.namedChildren || []).filter(
  k => k.type !== "comment" && k.type !== "ERROR"
);
const expr = ... kids[0];
```

- Prefer the last named child in spread attributes (often the payload)
- Filter out `ERROR` nodes if AST includes them

Only implement if weirdness is observed in practice.

---

### 3) Add Test Fixtures

Add 2–3 minimal fixtures to prevent regression:

```jsx
// Spread props
<A {...props} />

// Normal prop expression
<A foo={bar} />

// Assignment expression (ensure fallback triggers)
<A foo={a = 1} />
```

---

## Status

- [ ] Monitor for child element nesting regression
- [ ] Monitor for question count explosion on large JSX trees
- [ ] Consider renaming `exprFromJsxExpression` for clarity
- [ ] Add test fixtures when test infrastructure is ready
