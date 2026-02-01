---
feature: "Learning decay and freshness"
feature_id: "F-015"
created: "2026-02-01"
depends_on: ["F-002", "F-007"]
---

# Specification: Learning Decay and Freshness

## Overview

Learned patterns have a `confirmedAt` timestamp. Patterns not confirmed in 90 days are flagged as potentially stale. A periodic "identity review" prompt suggests reviewing old learnings. Decay doesn't auto-delete — just flags for review.

## Requirements

### R-1: Staleness Detection
- `isStale(learning, cutoffDays?)` — Returns boolean, default 90 days
- `getStaleLearnings(seed, cutoffDays?)` — Returns all stale learnings across all categories
- `getFreshnessStats(seed, cutoffDays?)` — Returns counts: fresh, stale, total per category

### R-2: Freshness Scoring
- `freshnessScore(learning)` — Returns 0.0 (very stale) to 1.0 (just confirmed)
- Score decays linearly over the cutoff window
- Unconfirmed learnings get score based on extractedAt

### R-3: Re-confirmation
- `reconfirmLearning(id, seedPath?)` — Updates confirmedAt to now
- Saves seed with updated timestamp
- Returns the refreshed learning

### R-4: Review Prompt Generation
- `generateReviewPrompt(seed, cutoffDays?)` — Returns review prompt text or null
- Returns null if no stale learnings
- Prompt lists stale learnings grouped by category with IDs for action

### R-5: CLI Commands
- `pai-seed stale` — List stale learnings
- `pai-seed refresh <id>` — Re-confirm a learning (update confirmedAt)

## Out of Scope
- Auto-deletion of stale learnings
- Scheduled review reminders (cron)
- Decay curves other than linear

## Architecture

- New file: `src/freshness.ts` — All freshness/decay logic
- Modified file: `src/cli.ts` — New commands
- New test: `tests/freshness.test.ts`
- Exports added to `src/index.ts`
