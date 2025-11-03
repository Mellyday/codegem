# LLM-Generated Distractors: Requirements, Architecture, and Plan

## Summary

We want to support using LLM-generated distractors for multiple‑choice questions. The LLM will generate a pool (e.g., 6) of plausible distractors per question. When the quiz is played, we randomly sample 3 unique distractors from that pool and combine them with the correct answer. If the pool is missing or insufficient, we fall back to existing heuristic distractor generation.

This feature should generate distractors only after a user saves and reviews a custom quiz (not during initial quiz creation). Persist distractors once, reuse them on subsequent plays.

## Goals / Requirements

- Persist once, reuse:
  - Do not generate distractors at initial quiz creation.
  - Generate LLM distractors after the user confirms a saved custom quiz is good.
  - Store distractors per card to avoid re-calling the LLM.

- Sampling:
  - On render of a saved custom quiz, randomly sample 3 unique items from the pool.
  - Ensure sampled items are not identical to the correct answer and are unique.
  - If fewer than 3 remain, top up with heuristic distractors to reach 3.

- Backwards compatibility:
  - Existing behavior of AST quizzes and saved quizzes without distractors remains unchanged (heuristic fallback).

- Data model:
  - Add optional per-card field `llmDistractors?: string[]` in the `quizzes` collection.

- UX & control:
  - Add a UI action to generate LLM distractors for a saved quiz (after review).
  - Indicate generation status and allow regeneration.

- Security & privacy:
  - Do not log raw code beyond what is necessary.
  - Support redaction/masking if needed.
  - Respect environment configuration for LLM provider.

## Current State (Baseline)

- Heuristic distractors are produced on the client:
  - For AST quiz flow in `src/components/QuizViewer.tsx` via `generateDistractors()` using `randomString()` in `src/lib/utils.ts`.
  - Python/JS rule-based helpers (`src/lib/pyQuiz.ts`, `src/lib/jsQuiz.ts`) include `buildDistractors()` used in deeper rule generation.

- Custom quizzes are saved via POST `/api/quizzes` with card metadata; options are not persisted and are regenerated at play time.

## Proposed Architecture

### Data Model

Extend each saved quiz card with an optional distractor pool:

```
llmDistractors?: string[]
```

Notes:
- Pool size target: 6 (configurable). The UI samples 3 per play.
- Deduplicate and trim server-side before storing.

### API

- Existing endpoint (unchanged behavior, extended schema):
  - `POST /api/quizzes`
    - Accepts and persists `llmDistractors` if provided (optional).

- New endpoint (to be added):
  - `POST /api/quizzes/:id/distractors`
    - Auth required.
    - Loads quiz by id, iterates cards, calls LLM to produce candidate distractors given each card’s `text` (and optional `sourceRef`/context).
    - Validates/filters (no duplicates, not equal to correct, remove trivial/empty), truncates to N (e.g., 6), and writes `llmDistractors` back.
    - Returns counts and any failures per card.

### Client Behavior

- Rendering saved custom quizzes:
  - Prefer sampling from `llmDistractors` when present.
  - Top up to 3 using current heuristic generator (`generateDistractors`) when the pool is empty/short.
  - Shuffle with correct answer before display.

- Rendering AST quizzes (not saved):
  - Keep existing heuristic behavior; no server round-trip.

- UX to generate distractors:
  - On Saved Custom Quizzes list or in the quiz viewer’s completion screen, provide a button “Generate LLM distractors”.
  - On click, call the enrichment endpoint; display progress and results.

### LLM Generation Guidelines

- Prompt should produce plausible but incorrect options given the correct snippet `text` and minimal context (e.g., surrounding code preview via `sourceRef.preview`).
- Return a JSON array of distinct strings; no explanations.
- Apply simple server-side filters:
  - Trim whitespace; drop empties.
  - Deduplicate case-insensitively.
  - Remove items exactly equal to the correct answer.
  - Optionally cap length for UI.

### Versioning / Auditing

- Store optional metadata alongside the pool (future enhancement):
  - `distractorSource: "llm" | "heuristic"`
  - `distractorVersion: string` (e.g., model+prompt version)
  - `generatedAt: Date`

## Implementation Plan

1) Schema support (done)
   - Add `llmDistractors?: string[]` field to quiz card type in API and client models.
   - Persist the field in `POST /api/quizzes` when present.

2) Client sampling (done)
   - In `QuizViewer` saved-quiz flow, prefer `llmDistractors` for options; sample 3 unique, fallback to `generateDistractors` to reach 3, then shuffle.

3) Enrichment API (to do)
   - Add `POST /api/quizzes/:id/distractors` server route.
   - For each card, construct prompt with `text` (+ optional `sourceRef.preview`).
   - Call LLM provider; parse response to array; filter, trim to 6; save as `llmDistractors`.
   - Return summary { updatedCards, skipped, failures }.

4) UI integration (to do)
   - Add “Generate LLM distractors” action to Saved Custom Quizzes panel and/or quiz completion screen.
   - Show progress, allow retry/regenerate.
   - Optionally tag cards that have LLM distractors.

5) Configuration (to do)
   - Environment variables for provider (e.g., `OPENAI_API_KEY`), model, and pool size.
   - Feature flag to disable/enable LLM generation per environment.

6) Validation & QA (to do)
   - Unit-test sampling logic (unique, top-up behavior, shuffle).
   - Integration test: create quiz → enrich → play → confirm options draw from pool.
   - Edge cases: short correct answers, identical pool items, empty responses.

## Security, Privacy, and Cost

- Avoid sending more code to the LLM than needed (use short previews where possible).
- Consider masking identifiers or sensitive literals.
- Rate-limit enrichment endpoint and allow partial updates (batch by N cards per request).
- Log only metadata; never persist LLM prompts/responses verbatim beyond the final pool.

## Files Touched (already updated)

- `app/api/quizzes/route.ts`
  - Accepts and stores optional `llmDistractors` per card.

- `src/components/SavedCustomQuizzesPanel.tsx`
  - Includes `llmDistractors` in saved quiz card type and fetch mapping.

- `src/components/QuizViewer.tsx`
  - When loading saved custom quizzes, samples up to 3 from `llmDistractors` and falls back to heuristics.

## Open Questions

- Do we want server-side sampling to be deterministic (e.g., seeded) for reproducible exams? Current approach samples client-side and is non-deterministic per play.
- Should we persist distractor metadata (model, prompt hash) now or later?
- Do we want a per-language generation strategy (Python vs JS) in prompts?

