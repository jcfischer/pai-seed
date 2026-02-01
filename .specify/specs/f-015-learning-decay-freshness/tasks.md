---
feature: "Learning decay and freshness"
feature_id: "F-015"
created: "2026-02-01"
---

# Implementation Tasks: Learning Decay and Freshness

## Task Groups

### Group 1: Detection Functions

#### T-15.1: isStale and getStaleLearnings
**File**: `src/freshness.ts`
**Test**: `tests/freshness.test.ts`

Tests:
- [ ] isStale returns true for learning older than cutoff
- [ ] isStale returns false for fresh learning
- [ ] isStale uses confirmedAt over extractedAt
- [ ] isStale respects custom cutoffDays
- [ ] getStaleLearnings returns stale learnings from all categories
- [ ] getStaleLearnings returns empty for all fresh

#### T-15.2: getFreshnessStats
**File**: `src/freshness.ts`
**Test**: `tests/freshness.test.ts`

Tests:
- [ ] Returns correct counts per category
- [ ] Handles empty seed

### Group 2: Scoring

#### T-15.3: freshnessScore
**File**: `src/freshness.ts`
**Test**: `tests/freshness.test.ts`

Tests:
- [ ] Returns 1.0 for just-confirmed learning
- [ ] Returns ~0.5 for learning at half the cutoff
- [ ] Returns 0.0 for learning past cutoff
- [ ] Clamps to 0.0 minimum

### Group 3: Actions

#### T-15.4: reconfirmLearning
**File**: `src/freshness.ts`
**Test**: `tests/freshness.test.ts`

Tests:
- [ ] Updates confirmedAt to now
- [ ] Returns error for unknown ID
- [ ] Saves updated seed to disk

### Group 4: Review Prompt

#### T-15.5: generateReviewPrompt
**File**: `src/freshness.ts`
**Test**: `tests/freshness.test.ts`

Tests:
- [ ] Returns null when no stale learnings
- [ ] Returns formatted prompt with stale learnings
- [ ] Groups by category

### Group 5: CLI

#### T-15.6: CLI stale and refresh Commands
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Tests:
- [ ] stale command lists stale learnings
- [ ] stale command shows "none" when all fresh
- [ ] refresh command updates confirmedAt

### Group 6: Integration

#### T-15.7: Exports
**File**: `src/index.ts`
**Test**: `tests/freshness.test.ts`

Tests:
- [ ] All exports importable from index

## Task Summary

| Task | Description | Tests |
|------|-------------|-------|
| T-15.1 | isStale and getStaleLearnings | 6 |
| T-15.2 | getFreshnessStats | 2 |
| T-15.3 | freshnessScore | 4 |
| T-15.4 | reconfirmLearning | 3 |
| T-15.5 | generateReviewPrompt | 3 |
| T-15.6 | CLI stale and refresh | 3 |
| T-15.7 | Exports | 1 |
| **Total** | | **22** |
