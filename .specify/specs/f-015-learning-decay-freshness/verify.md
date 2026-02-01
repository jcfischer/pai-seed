---
feature: "Learning decay and freshness"
feature_id: "F-015"
verified_date: "2026-02-01"
verified_by: "Claude Opus 4.5"
status: "verified"
---

# Verification: Learning Decay and Freshness

This document proves the feature works end-to-end before marking it complete.

## Pre-Verification Checklist

- [x] All tasks in tasks.md are marked complete
- [x] All unit tests pass (`bun test`)
- [x] No TypeScript errors (`tsc --noEmit`)
- [x] Feature is deployed/running locally

## Smoke Test Results

### Test 1: Staleness Detection

**Expected:** isStale returns true for >90 day old learnings, false for fresh.
**Actual:** Correctly identifies stale learnings using confirmedAt, falls back to extractedAt.
**Status:** [x] PASS

### Test 2: Freshness Score

**Expected:** Linear score from 1.0 (just confirmed) to 0.0 (past cutoff).
**Actual:** Score of 1.0 for day-0, ~0.5 for day-45, 0.0 for day-100.
**Status:** [x] PASS

### Test 3: Reconfirmation

**Expected:** reconfirmLearning updates confirmedAt to now, saves to disk.
**Actual:** confirmedAt updated, seed file rewritten, verified on reload.
**Status:** [x] PASS

### Test 4: Review Prompt

**Expected:** Formatted prompt with stale learnings grouped by category.
**Actual:** Returns null for no stale, formatted text with IDs and ages otherwise.
**Status:** [x] PASS

## Browser Verification

**Status:** [x] N/A (no UI)

## API Verification

**Status:** [x] N/A (no API)

## Edge Case Verification

### No Learnings
**Test:** getFreshnessStats on empty seed.
**Result:** All zeros: `{ fresh: 0, stale: 0, total: 0 }`
**Status:** [x] PASS

### Custom Cutoff
**Test:** isStale with 30-day cutoff.
**Result:** Learning at 31 days flagged stale with cutoff=30, fresh with cutoff=60.
**Status:** [x] PASS

### confirmedAt vs extractedAt Priority
**Test:** Learning with old extractedAt (200d) but fresh confirmedAt (10d).
**Result:** Not stale — confirmedAt takes priority.
**Status:** [x] PASS

### Reconfirm Unknown ID
**Test:** reconfirmLearning with nonexistent ID.
**Result:** Returns `{ ok: false, error: "Learning not found: ..." }`
**Status:** [x] PASS

## Test Coverage Summary

| Metric | Value |
|--------|-------|
| Source files (F-015) | 1 new (freshness.ts) + 1 modified (cli.ts) |
| Test files (F-015) | 1 (freshness.test.ts) |
| Coverage ratio | 1.0 |
| F-015 tests | 19 pass, 0 fail |
| Total tests (all features) | 510 pass, 0 fail |
| All tests pass | [x] YES |

## Verification Summary

| Category | Status |
|----------|--------|
| Smoke tests | [x] PASS |
| Browser verification | [x] N/A |
| API verification | [x] N/A |
| Edge cases | [x] PASS |
| Test suite | [x] PASS |

## Sign-off

- [x] All verification items checked
- [x] No unfilled placeholders in this document
- [x] Feature works as specified in spec.md
- [x] Ready for `specflow complete`

**Verified by:** Claude Opus 4.5
**Date:** 2026-02-01
