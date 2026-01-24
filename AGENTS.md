# Agent Guidelines

## 1. Testing Progressive Reveal

When writing tests that verify "what gets revealed" after answering a question:

**Always import and use `revealAfterForQuestion` from `QuizViewer.tsx`:**

```typescript
import { revealAfterForQuestion } from "../src/components/QuizViewer";

// In your test:
const revealEnd = revealAfterForQuestion(question);
```

**Do NOT reimplement the fallback logic inline.** The UI uses this exact function to determine what code to show. Using the same function in tests ensures they fail when the UI would show incorrect results.

The function checks properties in this order:
1. `revealEndAfterChild`
2. `sourceRefs[0].end`
3. `revealEndBeforeChild`
4. `revealStart`

For pre-answer reveal (what's shown before the user answers), use `revealBeforeForQuestion` instead.
