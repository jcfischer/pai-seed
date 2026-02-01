---
feature: "Event log compaction"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Event Log Compaction

## Architecture Overview

```
Session End Hook                     compaction.ts                    File System
┌──────────────┐   compactEvents()  ┌──────────────────────┐        ┌─────────────────────────┐
│ PreCompact / │──────────────────▶│                      │ read   │ ~/.pai/events/           │
│ SessionEnd   │                   │   Compaction Engine   │◄───────│  events-2025-10-01.jsonl │
│ Hook         │                   │                      │        │  events-2025-10-02.jsonl │
└──────────────┘                   │  1. findEligible()   │        │  events-2026-01-30.jsonl │
                                   │  2. generateSummary()│        │  events-2026-01-31.jsonl │
                                   │  3. archiveFiles()   │ move   │  index.db (SQLite)       │
                                   │  4. updateIndex()    │───────▶│                          │
                                   │  5. removeSources()  │        └─────────────────────────┘
                                   │                      │
                                   └──────────────────────┘        ┌─────────────────────────┐
                                          │                        │ ~/.pai/archive/          │
                                          │ archive                │  2025/                   │
                                          └───────────────────────▶│   events-2025-10-01.jsonl│
                                                                   │   events-2025-10-02.jsonl│
                                                                   │   summary-2025-10.json   │
                                                                   └─────────────────────────┘

Compaction Pipeline (per eligible period):

  findEligiblePeriods(eventsDir, cutoffDate)
         │
         ▼
  For each eligible YYYY-MM (incremental, max N per run):
         │
    ┌────▼─────────────────┐
    │ Already archived?    │──── yes ──▶ skip
    └────┬─────────────────┘
         │ no
    ┌────▼─────────────────┐
    │ readEvents() for     │  Read all events for the month
    │ the month            │  from JSONL files
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ generatePeriodSummary│  Counts, patterns, time distribution,
    │ (events[])           │  session stats, anomaly flags
    └────┬─────────────────┘  ← Pure function, no I/O
         │
    ┌────▼─────────────────┐
    │ archiveFiles()       │  Copy JSONL to ~/.pai/archive/YYYY/
    │ + writeSummary()     │  Write summary-YYYY-MM.json
    └────┬─────────────────┘  Uses temp + rename for atomicity
         │
    ┌────▼─────────────────┐
    │ updateIndex()        │  Remove old rows from SQLite
    │                      │  Insert summary record
    └────┬─────────────────┘
         │
    ┌────▼─────────────────┐
    │ removeSourceFiles()  │  Delete original JSONL from events/
    └────┬─────────────────┘  Only after archive confirmed
         │
         ▼
  CompactionResult { periodsProcessed, eventsArchived, ... }
```

**Design principle:** Compaction is a pipeline of pure functions + I/O steps. Each step is independently testable. The pipeline is idempotent — re-running detects already-archived periods and skips them. Failure at any step leaves source data intact for retry.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| SQLite | `bun:sqlite` | Built-in, zero dependency. WAL mode for concurrent reads |
| Validation | Zod | Project pattern. Summary schema validated before write |
| File I/O | `node:fs/promises` | `copyFile()` for archive, `rename()` for atomic writes, `rm()` for cleanup |
| IDs | nanoid | Already in package.json. Used for summary IDs |
| Testing | `bun:test` | Project standard. Temp directories, real file I/O |
| New deps | **None** | `bun:sqlite` is built-in. All others already in package.json |

## Constitutional Compliance

- [x] **CLI-First:** Hook-triggered; CLI exposure deferred to F-011
- [x] **Library-First:** All functions exported as library. Hook is a thin wrapper
- [x] **Test-First:** TDD — tests before implementation for each phase
- [x] **Deterministic:** Pure summary generation. I/O isolated to specific functions
- [x] **Code Before Prompts:** All logic in TypeScript, no prompt engineering

## Data Model

All types defined via Zod schemas in `src/compaction.ts`, following the project's Zod-first pattern.

```typescript
import { z } from "zod";

// =============================================================================
// FR-2: Period Summary Schema
// =============================================================================

export const timeDistributionSchema = z.object({
  byDayOfWeek: z.record(z.number()),    // { "Mon": 47, "Tue": 32, ... }
  byHour: z.record(z.number()),          // { "08": 12, "09": 45, ... }
});

export const sessionStatsSchema = z.object({
  totalSessions: z.number(),
  avgEventsPerSession: z.number(),
  longestSession: z.object({
    sessionId: z.string(),
    eventCount: z.number(),
  }),
});

export const anomalySchema = z.object({
  zeroDays: z.array(z.string()),         // ["2025-10-15", "2025-10-22"]
  highCountDays: z.array(z.object({      // days > 2σ above mean
    date: z.string(),
    count: z.number(),
  })),
});

export const periodSummarySchema = z.object({
  id: z.string().min(1),                 // nanoid
  period: z.string().regex(/^\d{4}-\d{2}$/), // "2025-10"
  createdAt: z.string().datetime(),
  eventCount: z.number(),
  eventCounts: z.record(z.number()),     // { "session_start": 12, ... }
  topPatterns: z.object({
    skills: z.array(z.object({ name: z.string(), count: z.number() })),
    errors: z.array(z.object({ name: z.string(), count: z.number() })),
  }),
  timeDistribution: timeDistributionSchema,
  sessionStats: sessionStatsSchema,
  anomalies: anomalySchema,
  sourceFiles: z.array(z.string()),      // original JSONL filenames
});

// =============================================================================
// FR-5/FR-6: Compaction Result
// =============================================================================

export const compactionResultSchema = z.object({
  ok: z.literal(true),
  periodsProcessed: z.number(),
  periodsSkipped: z.number(),
  eventsArchived: z.number(),
  summariesCreated: z.number(),
  warnings: z.array(z.string()),
}).or(z.object({
  ok: z.literal(false),
  error: z.string(),
}));

// =============================================================================
// Inferred Types
// =============================================================================

export type TimeDistribution = z.infer<typeof timeDistributionSchema>;
export type SessionStats = z.infer<typeof sessionStatsSchema>;
export type Anomaly = z.infer<typeof anomalySchema>;
export type PeriodSummary = z.infer<typeof periodSummarySchema>;

export type CompactionResult =
  | {
      ok: true;
      periodsProcessed: number;
      periodsSkipped: number;
      eventsArchived: number;
      summariesCreated: number;
      warnings: string[];
    }
  | { ok: false; error: string };

export type CompactionOptions = {
  eventsDir?: string;    // default: ~/.pai/events/
  archiveDir?: string;   // default: ~/.pai/archive/
  cutoffDays?: number;   // default: 90
  maxPeriodsPerRun?: number; // default: 3 (incremental)
};
```

### Database Schema (SQLite — `index.db`)

```sql
-- Event index for active window queries
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

-- Period summaries (inserted during compaction)
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL UNIQUE,  -- "2025-10"
  created_at TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  data TEXT NOT NULL             -- JSON blob of full PeriodSummary
);
CREATE INDEX IF NOT EXISTS idx_summaries_period ON summaries(period);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- INSERT OR IGNORE INTO meta VALUES ('schema_version', '1');
```

### Entity Relationships

```
SystemEvent (JSONL line — from F-008)     PeriodSummary (JSON file + SQLite row)
├── id: string (nanoid)                   ├── id: string (nanoid)
├── timestamp: string (ISO 8601)          ├── period: string ("2025-10")
├── sessionId: string                     ├── createdAt: string (ISO 8601)
├── type: EventType                       ├── eventCount: number
└── data: Record<string, unknown>         ├── eventCounts: Record<EventType, number>
                                          ├── topPatterns: { skills, errors }
Storage: ~/.pai/events/                   ├── timeDistribution: { byDayOfWeek, byHour }
├── events-YYYY-MM-DD.jsonl               ├── sessionStats: { total, avg, longest }
├── index.db (NEW)                        ├── anomalies: { zeroDays, highCountDays }
└── ...                                   └── sourceFiles: string[]

Archive: ~/.pai/archive/                  Storage: ~/.pai/archive/YYYY/
├── 2025/                                 ├── summary-2025-10.json  (PeriodSummary)
│   ├── events-2025-10-01.jsonl           └── events-2025-10-*.jsonl (raw archive)
│   ├── events-2025-10-02.jsonl
│   ├── summary-2025-10.json
│   └── ...
└── 2026/
    └── ...
```

## API Contracts

### `compactEvents(options?: CompactionOptions): Promise<CompactionResult>`

Main entry point. Orchestrates the full compaction pipeline.

| Aspect | Detail |
|--------|--------|
| Default eventsDir | `~/.pai/events/` (via `resolveEventsDir()`) |
| Default archiveDir | `~/.pai/archive/` |
| Default cutoff | 90 days from now |
| Default maxPeriodsPerRun | 3 (incremental) |
| Returns | `{ ok: true, periodsProcessed, periodsSkipped, eventsArchived, summariesCreated, warnings }` |
| On error | `{ ok: false, error }` |
| Never throws | All errors wrapped in result type |
| Idempotent | Re-running skips already-archived periods |

**Algorithm:**
1. `findEligiblePeriods(eventsDir, cutoffDate)` — scan JSONL filenames
2. For each eligible period (up to `maxPeriodsPerRun`):
   a. Check `archiveDir/YYYY/summary-YYYY-MM.json` exists → skip if so
   b. `readEvents({ eventsDir, since, until })` — load month's events
   c. `generatePeriodSummary(period, events)` — pure function
   d. `archivePeriod(period, eventsDir, archiveDir, summary)` — I/O
   e. `updateIndex(eventsDir, period, summary)` — SQLite
   f. `removeSourceFiles(eventsDir, filenames)` — cleanup
3. Return aggregate CompactionResult

### `findEligiblePeriods(eventsDir: string, cutoffDate: Date): Promise<string[]>`

Scans JSONL filenames to identify months where ALL events are older than cutoff.

| Aspect | Detail |
|--------|--------|
| Returns | Array of period strings: `["2025-10", "2025-11"]` |
| Logic | Group `events-YYYY-MM-DD.jsonl` by YYYY-MM. If latest DD in a group is before cutoff, the period is eligible |
| Empty dir | Returns `[]` |
| Pure-ish | Only reads directory listing, not file contents |

### `generatePeriodSummary(period: string, events: SystemEvent[]): PeriodSummary`

**Pure function** — no I/O. Generates full statistical summary.

| Aspect | Detail |
|--------|--------|
| Input | Period string + array of SystemEvents |
| Output | PeriodSummary object |
| eventCounts | `Record<EventType, number>` — count per type |
| topPatterns.skills | Top 10 `data.skill` values from `skill_invoked` events |
| topPatterns.errors | Top 10 `data.error` values from `error` events |
| timeDistribution.byDayOfWeek | Events per day name (Mon-Sun) |
| timeDistribution.byHour | Events per hour (00-23) |
| sessionStats | Total sessions, avg events/session, longest session |
| anomalies.zeroDays | Days within the period with zero events |
| anomalies.highCountDays | Days with count > mean + 2*stddev |
| Deterministic | Same input always produces same output (except `id` and `createdAt`) |

### `archivePeriod(period, sourceFiles, eventsDir, archiveDir, summary): Promise<ArchiveResult>`

Moves JSONL files to archive and writes summary.

| Aspect | Detail |
|--------|--------|
| Archive path | `archiveDir/YYYY/events-YYYY-MM-DD.jsonl` |
| Summary path | `archiveDir/YYYY/summary-YYYY-MM.json` |
| Atomicity | Write summary to `.tmp` first, then `rename()` |
| Copy strategy | `copyFile()` source → archive, then verify. Delete source only after all copies confirmed |
| Already exists | Skip file, add warning |
| Returns | `{ ok: true, filesArchived: number }` or `{ ok: false, error }` |

### `initEventIndex(eventsDir: string): Database`

Initialize or open the SQLite index database.

| Aspect | Detail |
|--------|--------|
| Path | `eventsDir/index.db` |
| Mode | WAL mode for concurrent reads |
| Schema | Created via `CREATE TABLE IF NOT EXISTS` (idempotent) |
| Returns | `bun:sqlite` Database instance |
| Corruption | On open failure, delete and recreate |

### `rebuildIndex(eventsDir: string): Promise<void>`

Rebuild SQLite index from JSONL files. Recovery mechanism.

| Aspect | Detail |
|--------|--------|
| Deletes | Existing `index.db` |
| Scans | All `events-*.jsonl` in eventsDir |
| Inserts | id, timestamp, sessionId, type for each event |
| Batch | Uses transactions for performance |

### `formatCompactionMessage(result: CompactionResult): string | null`

**Pure function.** Formats verbose-on-change output.

| Aspect | Detail |
|--------|--------|
| Nothing compacted | Returns `null` (silent) |
| Compacted | Returns `"Compacted 142 events from Oct 2025 → archive"` |
| Multiple periods | Returns `"Compacted 340 events from Oct-Nov 2025 → archive"` |
| Error | Returns `"Compaction warning: <error>"` |

## Implementation Phases

### Phase 1: Types, Schemas, and Pure Functions

**Files:** `src/compaction.ts` (schemas + `generatePeriodSummary` + `formatCompactionMessage`)

- Define all Zod schemas: `periodSummarySchema`, `compactionResultSchema`, `timeDistributionSchema`, etc.
- Export inferred TypeScript types
- Implement `generatePeriodSummary()` — pure function, full statistical analysis
- Implement `formatCompactionMessage()` — pure function, verbose-on-change output
- Implement `resolveArchiveDir()` — pure path resolution

**Depends on:** F-008 types (SystemEvent, EventType)

### Phase 2: SQLite Index

**Files:** `src/compaction.ts` (add `initEventIndex`, `indexEvent`, `removeIndexEntries`, `insertSummary`, `rebuildIndex`)

- Implement `initEventIndex(eventsDir)` — open/create `index.db` with WAL mode
- Implement `indexEvent(db, event)` — insert single event row
- Implement `removeIndexEntries(db, period)` — delete rows for a YYYY-MM period
- Implement `insertSummary(db, summary)` — insert summary row
- Implement `rebuildIndex(eventsDir)` — full rebuild from JSONL
- All use prepared statements for performance

**Depends on:** Phase 1 (types)

### Phase 3: Period Detection and Archive I/O

**Files:** `src/compaction.ts` (add `findEligiblePeriods`, `archivePeriod`, `isAlreadyArchived`, `removeSourceFiles`)

- Implement `findEligiblePeriods(eventsDir, cutoffDate)` — scan filenames, group by month
- Implement `isAlreadyArchived(archiveDir, period)` — check for summary file
- Implement `archivePeriod(...)` — copy files + write summary with temp+rename
- Implement `removeSourceFiles(eventsDir, filenames)` — delete originals after archive

**Depends on:** Phase 1 (types), Phase 2 (index operations)

### Phase 4: Compaction Orchestrator

**Files:** `src/compaction.ts` (add `compactEvents`)

- Implement `compactEvents(options?)` — main pipeline orchestrator
- Wire together: findEligible → for-each → read → summarize → archive → index → remove
- Incremental processing with `maxPeriodsPerRun`
- Aggregate results into CompactionResult
- Handle partial failure (some periods succeed, some fail)

**Depends on:** Phases 1-3

### Phase 5: Public API and Exports

**Files:** `src/index.ts` (add F-009 section)

- Add barrel exports for all public types and functions:
  ```typescript
  // F-009: Event log compaction
  export type { PeriodSummary, CompactionResult, CompactionOptions, ... } from "./compaction";
  export { periodSummarySchema, compactionResultSchema } from "./compaction";
  export { compactEvents, generatePeriodSummary, formatCompactionMessage,
           initEventIndex, rebuildIndex } from "./compaction";
  ```
- Verify no circular dependencies with events.ts

**Depends on:** Phase 4

### Phase 6: Tests

**Files:** `tests/compaction.test.ts`

Test structure:

```
tests/compaction.test.ts
├── Test Helpers
│   ├── createTempDirs()      — mkdtemp for events/ and archive/
│   ├── seedEvents()          — write test JSONL files spanning months
│   └── cleanup()             — rm -rf
│
├── generatePeriodSummary (FR-2) — Pure function tests
│   ├── counts events by type correctly
│   ├── identifies top skill patterns
│   ├── identifies top error patterns
│   ├── calculates day-of-week distribution
│   ├── calculates hourly distribution
│   ├── calculates session statistics
│   ├── detects zero-activity days
│   ├── detects high-count anomaly days
│   ├── handles empty event array
│   └── handles single event
│
├── findEligiblePeriods (FR-1)
│   ├── identifies months fully past cutoff
│   ├── excludes months with recent events
│   ├── handles mixed months (partial)
│   ├── returns empty for all-recent events
│   └── handles empty directory
│
├── SQLite Index (FR-4)
│   ├── initEventIndex creates database with schema
│   ├── indexEvent inserts event row
│   ├── removeIndexEntries deletes by period
│   ├── insertSummary stores summary data
│   ├── rebuildIndex matches JSONL content
│   └── handles corrupt database (recreate)
│
├── archivePeriod (FR-3)
│   ├── copies JSONL files to archive/YYYY/
│   ├── writes summary JSON to archive/YYYY/
│   ├── preserves original file contents
│   ├── uses atomic write (temp + rename)
│   └── skips already-archived files
│
├── compactEvents (FR-5, FR-6) — Integration tests
│   ├── compacts eligible periods end-to-end
│   ├── skips already-archived periods
│   ├── respects maxPeriodsPerRun limit
│   ├── returns correct CompactionResult counts
│   ├── is idempotent (run 3x, same state)
│   ├── leaves active window untouched
│   ├── handles empty events directory
│   ├── handles no eligible periods
│   └── handles partial failure gracefully
│
├── formatCompactionMessage
│   ├── returns null when nothing compacted
│   ├── formats single period
│   ├── formats multiple periods
│   └── formats error
│
└── Performance
    └── compacting 500 events completes in < 2s
```

**Test patterns:**
- `beforeEach`: create temp dirs via `mkdtemp`
- `afterEach`: cleanup via `rm({ recursive: true, force: true })`
- All functions called with explicit dir parameters
- No mocks — real file I/O and real SQLite against temp directories
- `seedEvents()` helper writes JSONL files with events spanning configurable months

**Depends on:** All phases complete.

## File Structure

```
src/
├── schema.ts          # F-001 (unchanged)
├── validate.ts        # F-001 (unchanged)
├── defaults.ts        # F-001 (unchanged)
├── json-schema.ts     # F-001 (unchanged)
├── merge.ts           # F-002 (unchanged)
├── loader.ts          # F-002 (unchanged)
├── git.ts             # F-003 (unchanged)
├── setup.ts           # F-004 (unchanged)
├── session.ts         # F-005 (unchanged)
├── extraction.ts      # F-006 (unchanged)
├── confirmation.ts    # F-007 (unchanged)
├── events.ts          # F-008 (unchanged — no modifications needed)
├── compaction.ts      # NEW — All F-009 logic
└── index.ts           # MODIFIED — Add F-009 exports

tests/
├── schema.test.ts     # (unchanged)
├── loader.test.ts     # (unchanged)
├── git.test.ts        # (unchanged)
├── setup.test.ts      # (unchanged)
├── session.test.ts    # (unchanged)
├── extraction.test.ts # (unchanged)
├── confirmation.test.ts # (unchanged)
├── events.test.ts     # (unchanged)
├── compaction.test.ts # NEW — All F-009 tests
└── fixtures/          # (unchanged)

~/.pai/
├── seed.json          # (existing)
├── events/            # (existing from F-008)
│   ├── events-2026-01-30.jsonl   # active window
│   ├── events-2026-01-31.jsonl
│   └── index.db       # NEW — SQLite index
└── archive/           # NEW
    └── 2025/
        ├── events-2025-10-01.jsonl
        ├── events-2025-10-02.jsonl
        ├── summary-2025-10.json
        └── ...
```

**Design decision:** Single `src/compaction.ts` file because:
- Matches codebase pattern: each feature = one file in flat `src/`
- All compaction functions share types and helpers
- Estimated ~350-400 lines (larger than events.ts but manageable)
- Clean import from `events.ts` — no circular dependency

**Design decision:** events.ts remains UNCHANGED. F-009 reads JSONL files directly and uses `readEvents()` from F-008. No modifications to F-008's public API.

## Dependencies

### Runtime Dependencies

| Dependency | Version | Usage | Status |
|-----------|---------|-------|--------|
| zod | ^3.23 | Summary schema validation | Already in package.json |
| nanoid | ^5.0 | Summary ID generation | Already in package.json |
| bun:sqlite | built-in | Event index database | **No install needed** |

**No new package.json dependencies.**

### Upstream (What F-009 Uses)

| Module | What | Why |
|--------|------|-----|
| `src/events.ts` | `readEvents()`, `resolveEventsDir()`, `SystemEvent`, `EventType` | Read events for summarization |
| `bun:sqlite` | `Database` class | Index database |
| `node:fs/promises` | `copyFile`, `rename`, `rm`, `readdir`, `mkdir`, `writeFile`, `readFile`, `access` | Archive I/O |
| `node:path` | `join`, `resolve`, `dirname` | Path construction |
| `node:os` | `homedir` | Default archive path |
| `nanoid` | `nanoid()` | Summary IDs |

### Downstream (What Uses F-009)

| Feature | What They Import | Status |
|---------|-----------------|--------|
| F-010 Checkpoint | Uses bounded event window guaranteed by compaction | Future |
| F-011 CLI | `compactEvents()` for manual trigger | Future |
| F-012 ACR | `PeriodSummary` for semantic indexing | Future |
| F-016 Redaction | Must check both active and archive | Future |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| SQLite lock contention (hook + readEvents concurrent) | Medium | Low | WAL mode allows concurrent reads. Compaction is the only writer |
| Archive directory permissions | Medium | Low | `mkdir({ recursive: true })`. Same pattern as events/ |
| Large month (10k+ events) slows summary generation | Low | Very Low | `generatePeriodSummary` is O(n) — 10k events processes in <100ms |
| JSONL file locked by another process during archive | Medium | Very Low | Copy-then-verify-then-delete. If copy fails, skip and retry next session |
| SQLite database corruption | Medium | Low | `rebuildIndex()` recovery — delete and recreate from JSONL |
| Filename pattern assumption | Low | Very Low | Reuses F-008's `JSONL_FILE_PATTERN` regex. Same pattern, same guarantee |
| Clock rollback creates future-dated files | Low | Very Low | Period detection uses filename dates only. Out-of-order dates are harmless |

## Failure Mode Analysis

### How This Code Can Fail

| Failure Mode | Trigger | Detection | Degradation | Recovery |
|-------------|---------|-----------|-------------|----------|
| Archive write fails | Disk full, permissions | `copyFile` error | Skip period, add warning | Retry next session |
| SQLite open fails | Corrupt db, locked | `Database()` exception | Fall back to JSONL-only reads | `rebuildIndex()` |
| Source delete fails after archive | Permissions, locked file | `rm()` error | Duplicated data (archive + source) | Idempotent re-run skips archived, retries delete |
| Summary generation crashes | Unexpected data shape | Try/catch in pipeline | Skip period, add warning | Fix edge case, retry |
| Partial run (3/5 periods) | maxPeriodsPerRun limit | Normal behavior | Remaining periods queued for next run | Next session continues |

### Assumptions That Could Break

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| `bun:sqlite` is available | Running under Node.js instead of Bun | Import fails at load time — caught in try/catch |
| Events volume < 1000/day | Heavy automation generating 10k+/day | Monitor summary `eventCount` values |
| 90-day window sufficient | User needs deeper history | Feature request for configurable retention (out of scope) |
| Single writer (no concurrent compaction) | Multi-device with shared ~/.pai/ | Check for `.compacting` lock file (future enhancement) |

### Blast Radius

- **Files touched:** 2 (new: `compaction.ts`, modified: `index.ts`)
- **Systems affected:** Event log storage, archive directory
- **Rollback strategy:** Delete `compaction.ts`, remove exports from `index.ts`. Archive directory and index.db can be manually deleted. JSONL source files are untouched until archive is confirmed.

## Implementation Notes

### Idempotency Strategy

Compaction achieves idempotency through detection, not prevention:

1. **`isAlreadyArchived(archiveDir, period)`** — checks for `summary-YYYY-MM.json` in archive
2. If summary exists → period is complete → skip
3. If summary doesn't exist but some JSONL files are in archive → partial state → re-archive missing files, generate summary
4. Re-running after full completion: all periods detected as archived, `periodsSkipped` incremented, zero work done

### Atomic Archive Writes

```typescript
// Write summary atomically
const tmpPath = join(archivePeriodDir, `summary-${period}.json.tmp`);
const finalPath = join(archivePeriodDir, `summary-${period}.json`);
await writeFile(tmpPath, JSON.stringify(summary, null, 2));
await rename(tmpPath, finalPath);  // atomic on same filesystem
```

JSONL files use `copyFile()` (not move) so source is intact until `removeSourceFiles()`.

### SQLite WAL Mode

```typescript
const db = new Database(join(eventsDir, "index.db"));
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA synchronous=NORMAL");
```

WAL mode allows `readEvents()`-style queries to proceed while compaction writes. The index is an optimization — if it fails, JSONL scan is the fallback.

### Incremental Processing

Default `maxPeriodsPerRun = 3` means:
- If 6 months are eligible, first session compacts 3, second session compacts remaining 3
- Keeps session-end latency bounded
- Each run is complete for its processed periods (no half-archived months)

### Archive Directory Convention

```
~/.pai/archive/
└── YYYY/                          # Year directory
    ├── events-YYYY-MM-DD.jsonl    # Preserved JSONL files (byte-identical to source)
    └── summary-YYYY-MM.json       # Statistical summary (the compaction artifact)
```

Summary filename is the sentinel: if `summary-YYYY-MM.json` exists, the period is considered fully archived.

## Longevity Assessment

### Maintainability Indicators

| Indicator | Status | Notes |
|-----------|--------|-------|
| **Readability:** Can a developer understand this in 6 months? | Yes | Pure functions separated from I/O. Clear pipeline |
| **Testability:** Can changes be verified without manual testing? | Yes | Full test suite with temp directories |
| **Documentation:** Is the "why" captured, not just the "what"? | Yes | ADRs inline, spec.md tracks interview decisions |

### Evolution Vectors

| What Might Change | Preparation | Impact |
|------------------|-------------|--------|
| Configurable retention window | `cutoffDays` parameter already exists | Low — change default |
| Compression of archives | Archive format is plain JSONL | Low — add gzip step in archivePeriod |
| Archive querying | Summary JSON is self-contained | Low — new reader function |
| SQLite for active queries (not just index) | Index schema supports full event data | Medium — add data column |

### Deletion Criteria

- [ ] Feature superseded by: External event store (e.g., ClickHouse)
- [ ] Dependency deprecated: `bun:sqlite` removed from Bun
- [ ] User need eliminated: Event log itself removed
- [ ] Maintenance cost exceeds value when: Never — compaction is essential for bounded storage
