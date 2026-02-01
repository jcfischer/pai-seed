# Documentation Updates: F-009 Event Log Compaction

## Files Updated

### README.md
No README update needed — F-009 is an internal infrastructure feature with no user-facing API changes. The existing roadmap section already lists F-009.

### AGENTS.md
No update needed — no new agent interactions introduced.

### API Surface Added

New exports in `src/index.ts`:

**Types:** `PeriodSummary`, `CompactionResult`, `CompactionOptions`, `TimeDistribution`, `SessionStats`, `Anomaly`

**Schemas:** `periodSummarySchema`, `timeDistributionSchema`, `sessionStatsSchema`, `anomalySchema`

**Functions:**
- `compactEvents(options?)` — Main entry point for compaction pipeline
- `generatePeriodSummary(period, events)` — Pure statistical summary generation
- `formatCompactionMessage(result)` — Format verbose-on-change output
- `initEventIndex(eventsDir)` — Initialize/open SQLite index
- `rebuildIndex(eventsDir)` — Recovery: rebuild index from JSONL files
- `findEligiblePeriods(eventsDir, cutoffDate)` — Identify compactable months
- `resolveArchiveDir(archiveDir?)` — Resolve archive directory path

### New File Locations

- `src/compaction.ts` — All compaction logic (~480 lines)
- `tests/compaction.test.ts` — 52 tests
- `~/.pai/events/index.db` — SQLite index (created on first compaction)
- `~/.pai/archive/YYYY/` — Archived JSONL files and period summaries
