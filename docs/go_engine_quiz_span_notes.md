# Go Engine Quiz Span Notes

This documents a class of quiz-generation issues observed in `src/lib/languages/go/goEngine.ts` that are similar to the “RHS question gets skipped / replaced by next line” behavior we saw in the JS engine.

## Summary

In Go, the core problem is usually **not** parentheses unwrapping. It is most often:

- **Overly-wide `sourceRefs` spans** (often the entire statement) for “summary” questions (LHS/RHS/operator).
- The **overlap guard** (`applyQuestionOverlapGuard`) dropping those wide-span summary questions when smaller-span questions are also produced inside the same statement (e.g. composite literal questions).

## Where It Shows Up

### Short variable declarations (`:=`)

`ruleShortVarDecl` emits:

- “Which names are bound…?” and “What is the right-hand expression(s)?” using `sourceRefs: [sourceRef]` (statement-wide span).
- Additional smaller-span questions via `generateQuestionsV11` for composite literals and (deep) function literals.

If a composite literal question has a smaller span inside the statement, the overlap guard can drop the broader summary question(s).

Relevant code:

- `ruleShortVarDecl` in `src/lib/languages/go/goEngine.ts`
- `applyQuestionOverlapGuard` in `src/lib/languages/go/goEngine.ts`

### Assignments (`=`, `+=`, etc.)

`ruleAssignment` similarly emits summary questions for LHS / RHS / operator using `sourceRefs: [sourceRef]` (statement-wide span), and can also emit smaller-span composite literal questions for RHS nodes.

Relevant code:

- `ruleAssignment` in `src/lib/languages/go/goEngine.ts`
- `applyQuestionOverlapGuard` in `src/lib/languages/go/goEngine.ts`

### Call breakdown questions use statement-wide refs

`buildCallQuestions` has access to segment nodes (callee/field/args) via `decomposeChain`, but all questions currently attach `sourceRefs: [sourceRef]`.

If `sourceRef` is a full-statement span and a nested smaller-span question exists (e.g. composite literal inside args), the overlap guard can drop the call-chain questions.

Relevant code:

- `decomposeChain` + `buildCallQuestions` in `src/lib/languages/go/goEngine.ts`
- Call sites like `ruleExpressionStatement` and `ruleCallExpression` in `src/lib/languages/go/goEngine.ts`

## Deep RHS Decomposition Gaps

Even in deep mode, RHS decomposition is mostly “top-level”:

- Deep call breakdown happens when the expression itself is a `call_expression` (or when the rule specifically inspects calls).
- In RHS contexts like `x = foo && bar()`, the engine may not decompose nested calls (e.g. `bar()`) unless the rule explicitly scans descendants.

This is not necessarily wrong, but it’s less consistent with an “assignment-mode means decompose RHS regardless of shape” intent.

## Suggested Fix Direction (If/When We Choose To Address It)

1. **Tighten `sourceRefs` for summary questions**:
   - LHS questions should reference the LHS node span.
   - RHS questions should reference the RHS expression node span.
   - Operator questions should reference a minimal span or operator-adjacent span, not the entire statement.

2. **Attach call-chain question refs to their segment nodes**:
   - For callee questions, use the callee node span.
   - For args questions, use the args node span.
   - For chained field questions, use the field node span.

3. (Optional) **Deep scan for nested calls/JSX/composites in RHS**:
   - If the intent is “deep means fine-grained RHS”, add descendant scanning for call expressions and other interesting nodes while still avoiding diving into function bodies/callbacks.

