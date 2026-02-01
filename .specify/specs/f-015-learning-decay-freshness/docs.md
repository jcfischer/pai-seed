# Documentation Updates: F-015 Learning Decay and Freshness

## Files Updated

### API Surface Added

New file `src/freshness.ts` — Freshness detection, scoring, and review.

**Types:**
- `StaleLearning` — Stale learning with category and days since confirmed
- `FreshnessStats` — Per-category fresh/stale/total counts
- `ReconfirmResult` — Discriminated union result

**Functions:**
- `isStale(learning, cutoffDays?, now?)` — Boolean staleness check (default 90 days)
- `getStaleLearnings(seed, cutoffDays?, now?)` — All stale learnings sorted by age
- `getFreshnessStats(seed, cutoffDays?, now?)` — Category-level freshness counts
- `freshnessScore(learning, cutoffDays?, now?)` — Linear 0.0-1.0 freshness score
- `reconfirmLearning(id, seedPath?)` — Update confirmedAt to now, save to disk
- `generateReviewPrompt(seed, cutoffDays?, now?)` — Human-readable review prompt or null

### Modified Files

**`src/cli.ts`:**
- Added `stale` command — List stale learnings
- Added `refresh <id>` command — Re-confirm a learning

### Freshness Model

- **Cutoff**: 90 days (configurable), consistent with F-009 compaction and F-012 ACR window
- **Reference date**: Uses `confirmedAt` if present, falls back to `extractedAt`
- **Score**: Linear decay from 1.0 (just confirmed) to 0.0 (at/past cutoff)
- **Advisory only**: Staleness flags learnings for review, never auto-deletes

### CLI Commands

| Command | Description |
|---------|-------------|
| `pai-seed stale` | List stale learnings (>90 days) |
| `pai-seed refresh <id>` | Re-confirm a learning |

### New File Locations

- `src/freshness.ts` — Freshness module (~210 lines)
- `tests/freshness.test.ts` — 19 tests
