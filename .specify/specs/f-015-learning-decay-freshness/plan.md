---
feature: "Learning decay and freshness"
feature_id: "F-015"
created: "2026-02-01"
---

# Implementation Plan: Learning Decay and Freshness

## Architecture

Single new module `src/freshness.ts` with pure functions for staleness detection and scoring, plus a reconfirmation function that writes to disk.

## Implementation Order

### Group 1: Detection Functions (Pure)
- `isStale(learning, cutoffDays?)` — Boolean check
- `getStaleLearnings(seed, cutoffDays?)` — All stale across categories
- `getFreshnessStats(seed, cutoffDays?)` — Category-level counts

### Group 2: Scoring (Pure)
- `freshnessScore(learning, cutoffDays?)` — Linear 0.0-1.0 score

### Group 3: Actions (I/O)
- `reconfirmLearning(id, seedPath?)` — Update confirmedAt, write seed

### Group 4: Review Prompt (Pure)
- `generateReviewPrompt(seed, cutoffDays?)` — Human-readable review text

### Group 5: CLI
- `stale` command — List stale learnings
- `refresh <id>` command — Re-confirm a learning

### Group 6: Integration
- Add exports to index.ts

## Key Decisions

1. **90-day default** — Consistent with F-009 compaction and F-012 ACR window
2. **Linear decay** — Simple and predictable; score = 1 - (daysSince / cutoff), clamped to [0, 1]
3. **confirmedAt priority** — Use confirmedAt if present, fall back to extractedAt
4. **No auto-delete** — Staleness is advisory only
