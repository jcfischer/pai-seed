# Implementation Tasks: Event Log Compaction (F-009)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-9.1 | ☐ | Zod schemas + types |
| T-9.2 | ☐ | generatePeriodSummary (pure) |
| T-9.3 | ☐ | formatCompactionMessage (pure) |
| T-9.4 | ☐ | SQLite index init + schema |
| T-9.5 | ☐ | SQLite index CRUD operations |
| T-9.6 | ☐ | rebuildIndex recovery |
| T-9.7 | ☐ | findEligiblePeriods |
| T-9.8 | ☐ | archivePeriod + isAlreadyArchived |
| T-9.9 | ☐ | removeSourceFiles |
| T-9.10 | ☐ | compactEvents orchestrator |
| T-9.11 | ☐ | Public API exports |
| T-9.12 | ☐ | Test suite |
| T-9.13 | ☐ | Regression check |

## Group 1: Foundation — Types, Schemas, Pure Functions

### T-9.1: Define compaction schemas and types [T]

- **File:** `src/compaction.ts` (top section, ~lines 1-100)
- **Test:** `tests/compaction.test.ts` (schema validation group)
- **Dependencies:** none
- **FRs:** FR-2 (Summary Generation), FR-5 (Idempotent Operation)
- **Description:**
  - Create `src/compaction.ts` with all Zod schemas following codebase Zod-first pattern
  - Import `SystemEvent`, `EventType` from `./events`
  - Define `timeDistributionSchema` — Zod object: `byDayOfWeek` (record of number), `byHour` (record of number)
  - Define `sessionStatsSchema` — Zod object: `totalSessions`, `avgEventsPerSession`, `longestSession` (object with `sessionId` + `eventCount`)
  - Define `anomalySchema` — Zod object: `zeroDays` (array of string), `highCountDays` (array of objects with `date` + `count`)
  - Define `periodSummarySchema` — Zod object: `id` (string min 1), `period` (string regex `/^\d{4}-\d{2}$/`), `createdAt` (string datetime), `eventCount` (number), `eventCounts` (record of number), `topPatterns` (object with `skills` + `errors` arrays), `timeDistribution`, `sessionStats`, `anomalies`, `sourceFiles` (array of string)
  - Define `CompactionResult` discriminated union: `{ ok: true; periodsProcessed; periodsSkipped; eventsArchived; summariesCreated; warnings: string[] }` | `{ ok: false; error: string }`
  - Define `CompactionOptions` type: `eventsDir?`, `archiveDir?`, `cutoffDays?` (default 90), `maxPeriodsPerRun?` (default 3)
  - Export all inferred types: `TimeDistribution`, `SessionStats`, `Anomaly`, `PeriodSummary`, `CompactionResult`, `CompactionOptions`
  - Implement `resolveArchiveDir(archiveDir?: string): string` — pure function, default `join(homedir(), ".pai", "archive")`

### T-9.2: Implement generatePeriodSummary [T]

- **File:** `src/compaction.ts` (~lines 100-220)
- **Test:** `tests/compaction.test.ts` (generatePeriodSummary group)
- **Dependencies:** T-9.1
- **FRs:** FR-2 (Summary Generation)
- **Description:**
  - Implement `generatePeriodSummary(period: string, events: SystemEvent[]): PeriodSummary`
  - **Pure function** — no I/O, deterministic (except `id` via nanoid and `createdAt`)
  - `eventCounts`: count events grouped by `type` field → `Record<string, number>`
  - `topPatterns.skills`: from `skill_invoked` events, extract `data.skill` (string), count frequencies, return top 10 as `{ name, count }[]`
  - `topPatterns.errors`: from `error` events, extract `data.error` (string), count frequencies, return top 10 as `{ name, count }[]`
  - `timeDistribution.byDayOfWeek`: parse each event timestamp, group by day name (Mon-Sun), count
  - `timeDistribution.byHour`: parse each event timestamp, group by hour (00-23), count
  - `sessionStats.totalSessions`: count distinct `sessionId` values
  - `sessionStats.avgEventsPerSession`: `events.length / totalSessions`
  - `sessionStats.longestSession`: find `sessionId` with max event count, return `{ sessionId, eventCount }`
  - `anomalies.zeroDays`: enumerate all dates in the period (YYYY-MM), find days with zero events
  - `anomalies.highCountDays`: compute mean and stddev of daily counts, flag days > mean + 2*stddev
  - `sourceFiles`: extract unique filenames from events using `events-${timestamp.slice(0,10)}.jsonl` pattern
  - Handle edge cases: empty events array → zero counts, single event, all same type

### T-9.3: Implement formatCompactionMessage [T]

- **File:** `src/compaction.ts` (~lines 220-260)
- **Test:** `tests/compaction.test.ts` (formatCompactionMessage group)
- **Dependencies:** T-9.1
- **FRs:** Spec UX requirement (verbose-on-change)
- **Description:**
  - Implement `formatCompactionMessage(result: CompactionResult): string | null`
  - **Pure function** — no I/O
  - If `result.ok === false`: return `"Compaction warning: <error>"`
  - If `result.ok === true` and `result.periodsProcessed === 0`: return `null` (silent)
  - If single period: return `"Compacted <N> events from <Month Year> → archive"`
  - If multiple periods: return `"Compacted <N> events from <Month1>-<Month2> <Year> → archive"` (or `<Month1 Year1>-<Month2 Year2>` if spanning years)
  - Month names in short format (Jan, Feb, etc.)

## Group 2: SQLite Index

### T-9.4: Implement initEventIndex [T]

- **File:** `src/compaction.ts` (SQLite section, ~lines 260-310)
- **Test:** `tests/compaction.test.ts` (SQLite index group)
- **Dependencies:** T-9.1
- **FRs:** FR-4 (SQLite Index)
- **Description:**
  - Implement `initEventIndex(eventsDir: string): Database`
  - Import `Database` from `bun:sqlite`
  - Open database at `join(eventsDir, "index.db")`
  - Set `PRAGMA journal_mode=WAL` for concurrent read support
  - Set `PRAGMA synchronous=NORMAL` for performance
  - Create tables via `CREATE TABLE IF NOT EXISTS` (idempotent):
    - `events` table: `id TEXT PRIMARY KEY`, `timestamp TEXT NOT NULL`, `session_id TEXT NOT NULL`, `type TEXT NOT NULL`
    - `summaries` table: `id TEXT PRIMARY KEY`, `period TEXT NOT NULL UNIQUE`, `created_at TEXT NOT NULL`, `event_count INTEGER NOT NULL`, `data TEXT NOT NULL`
    - `meta` table: `key TEXT PRIMARY KEY`, `value TEXT NOT NULL`
  - Create indexes: `idx_events_type`, `idx_events_session`, `idx_events_timestamp`, `idx_summaries_period`
  - Insert schema version: `INSERT OR IGNORE INTO meta VALUES ('schema_version', '1')`
  - Return `Database` instance
  - On open failure (corrupt db): delete `index.db` and retry once

### T-9.5: Implement SQLite CRUD operations [T]

- **File:** `src/compaction.ts` (~lines 310-380)
- **Test:** `tests/compaction.test.ts` (SQLite CRUD group)
- **Dependencies:** T-9.4
- **FRs:** FR-4 (SQLite Index)
- **Description:**
  - Implement `indexEvent(db: Database, event: SystemEvent): void`
    - Prepared statement: `INSERT OR IGNORE INTO events (id, timestamp, session_id, type) VALUES (?, ?, ?, ?)`
    - Uses `db.prepare()` for performance
  - Implement `indexEvents(db: Database, events: SystemEvent[]): void`
    - Batch insert within a transaction for performance
    - `db.transaction(() => { for (event of events) indexEvent(db, event); })()`
  - Implement `removeIndexEntries(db: Database, period: string): number`
    - Delete events matching `timestamp LIKE '<period>%'` (e.g., `2025-10%`)
    - Return count of deleted rows
  - Implement `insertSummary(db: Database, summary: PeriodSummary): void`
    - `INSERT OR REPLACE INTO summaries (id, period, created_at, event_count, data) VALUES (?, ?, ?, ?, ?)`
    - `data` column stores `JSON.stringify(summary)`
  - Implement `querySummaries(db: Database, period?: string): PeriodSummary[]`
    - Optional period filter
    - Parse `data` column back to `PeriodSummary`
    - Validate with `periodSummarySchema.safeParse()`

### T-9.6: Implement rebuildIndex [T]

- **File:** `src/compaction.ts` (~lines 380-430)
- **Test:** `tests/compaction.test.ts` (rebuildIndex group)
- **Dependencies:** T-9.4, T-9.5
- **FRs:** FR-4 (SQLite Index — corruption recovery)
- **Description:**
  - Implement `rebuildIndex(eventsDir: string): Promise<void>`
  - Delete existing `index.db` if present
  - Call `initEventIndex(eventsDir)` to create fresh database
  - Read all `events-*.jsonl` files via `readdir()` + file reading
  - Parse each line, validate with `systemEventSchema`
  - Batch-insert all valid events using `indexEvents()`
  - Also scan `archiveDir` for `summary-*.json` files and insert those
  - Recovery mechanism for corrupt SQLite — called when `initEventIndex` fails after retry

## Group 3: Period Detection and Archive I/O

### T-9.7: Implement findEligiblePeriods [T]

- **File:** `src/compaction.ts` (~lines 430-480)
- **Test:** `tests/compaction.test.ts` (findEligiblePeriods group)
- **Dependencies:** T-9.1
- **FRs:** FR-1 (Period Detection)
- **Description:**
  - Implement `findEligiblePeriods(eventsDir: string, cutoffDate: Date): Promise<string[]>`
  - List files matching `/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/` in eventsDir
  - Group filenames by YYYY-MM period
  - For each period: find the latest date among its files
  - If the latest date is before cutoffDate → period is eligible
  - Return sorted array of eligible period strings: `["2025-10", "2025-11"]`
  - Handle empty directory → return `[]`
  - Handle directory not existing → return `[]`
  - Only reads directory listing, not file contents (fast)

### T-9.8: Implement archivePeriod and isAlreadyArchived [T]

- **File:** `src/compaction.ts` (~lines 480-560)
- **Test:** `tests/compaction.test.ts` (archive group)
- **Dependencies:** T-9.1, T-9.2
- **FRs:** FR-3 (Archive Management), FR-5 (Idempotent Operation)
- **Description:**
  - Implement `isAlreadyArchived(archiveDir: string, period: string): Promise<boolean>`
    - Check if `archiveDir/YYYY/summary-YYYY-MM.json` exists using `access()`
    - Period format "2025-10" → year "2025", summary file "summary-2025-10.json"
    - Return `true` if summary file exists (sentinel for completed archive)
  - Implement `archivePeriod(period: string, sourceFiles: string[], eventsDir: string, archiveDir: string, summary: PeriodSummary): Promise<ArchiveResult>`
    - Define `ArchiveResult = { ok: true; filesArchived: number } | { ok: false; error: string }`
    - Create archive year directory: `mkdir(join(archiveDir, year), { recursive: true })`
    - Copy each source JSONL file: `copyFile(src, dest)` — skip if dest already exists (add warning)
    - Write summary atomically:
      1. Write to `summary-YYYY-MM.json.tmp`
      2. `rename()` to `summary-YYYY-MM.json`
    - Return count of files archived
    - On any error: return `{ ok: false, error }` — source files remain intact

### T-9.9: Implement removeSourceFiles [T]

- **File:** `src/compaction.ts` (~lines 560-590)
- **Test:** `tests/compaction.test.ts` (removeSourceFiles group)
- **Dependencies:** T-9.8
- **FRs:** FR-3 (Archive Management — cleanup)
- **Description:**
  - Implement `removeSourceFiles(eventsDir: string, filenames: string[]): Promise<{ removed: number; warnings: string[] }>`
  - For each filename: `rm(join(eventsDir, filename))`
  - Catch errors per-file — add to warnings, continue with next file
  - Return count of successfully removed files + any warnings
  - **Only called after archive is confirmed** (sentinel check)

## Group 4: Orchestrator

### T-9.10: Implement compactEvents [T]

- **File:** `src/compaction.ts` (~lines 590-690)
- **Test:** `tests/compaction.test.ts` (compactEvents integration group)
- **Dependencies:** T-9.2, T-9.3, T-9.5, T-9.7, T-9.8, T-9.9
- **FRs:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6 (all)
- **Description:**
  - Implement `compactEvents(options?: CompactionOptions): Promise<CompactionResult>`
  - **Main entry point — orchestrates the full pipeline**
  - Resolve directories: `resolveEventsDir(options?.eventsDir)`, `resolveArchiveDir(options?.archiveDir)`
  - Compute cutoff date: `new Date(Date.now() - (options?.cutoffDays ?? 90) * 86400000)`
  - Call `findEligiblePeriods(eventsDir, cutoffDate)`
  - Initialize SQLite: `initEventIndex(eventsDir)`
  - For each eligible period (up to `maxPeriodsPerRun ?? 3`):
    1. `isAlreadyArchived(archiveDir, period)` → skip if true, increment `periodsSkipped`
    2. `readEvents({ eventsDir, since: periodStart, until: periodEnd })` — load month's events
    3. `generatePeriodSummary(period, events)` — pure function
    4. `archivePeriod(period, sourceFiles, eventsDir, archiveDir, summary)` — I/O
    5. `removeIndexEntries(db, period)` + `insertSummary(db, summary)` — SQLite
    6. `removeSourceFiles(eventsDir, sourceFileNames)` — cleanup
    7. Accumulate: `periodsProcessed++`, `eventsArchived += events.length`, `summariesCreated++`
  - Close database: `db.close()`
  - Handle per-period errors: catch, add to warnings, continue with next period
  - Return aggregate `CompactionResult`
  - **Never throws** — all errors wrapped in result type
  - Wrap entire function in try/catch for unexpected errors

## Group 5: Integration

### T-9.11: Add public API exports [T]

- **File:** `src/index.ts` (add F-009 section after F-008)
- **Test:** Import test in `tests/compaction.test.ts` (verify exports resolve)
- **Dependencies:** T-9.10
- **FRs:** All (public surface area)
- **Description:**
  - Add new section to `src/index.ts` following existing pattern:
    ```
    // =============================================================================
    // F-009: Event log compaction
    // =============================================================================
    ```
  - Export types: `PeriodSummary`, `CompactionResult`, `CompactionOptions`, `TimeDistribution`, `SessionStats`, `Anomaly`
  - Export schemas: `periodSummarySchema`, `timeDistributionSchema`, `sessionStatsSchema`, `anomalySchema`
  - Export functions: `compactEvents`, `generatePeriodSummary`, `formatCompactionMessage`, `initEventIndex`, `rebuildIndex`, `findEligiblePeriods`, `resolveArchiveDir`
  - Verify no circular dependencies between `compaction.ts` and `events.ts`

## Group 6: Verification

### T-9.12: Write full test suite [T]

- **File:** `tests/compaction.test.ts`
- **Dependencies:** T-9.11 (all functions exported)
- **FRs:** All
- **Description:**
  - Create `tests/compaction.test.ts` following `events.test.ts` patterns:
    - Import from `bun:test`: `describe`, `expect`, `test`, `beforeEach`, `afterEach`
    - Temp dir setup: `mkdtemp(join(tmpdir(), "pai-compact-test-"))` in `beforeEach` — create `events/` and `archive/` subdirs
    - Cleanup: `rm(tempDir, { recursive: true, force: true })` in `afterEach`
    - Helper: `seedEvents(eventsDir, months)` — write JSONL files spanning configurable months with realistic event types
  - **Test groups and cases:**
    - `generatePeriodSummary` (10 tests) — pure function
      - Counts events by type correctly
      - Identifies top skill patterns from skill_invoked events
      - Identifies top error patterns from error events
      - Calculates day-of-week distribution
      - Calculates hourly distribution
      - Calculates session statistics (total, avg, longest)
      - Detects zero-activity days
      - Detects high-count anomaly days (> mean + 2σ)
      - Handles empty event array
      - Handles single event
    - `formatCompactionMessage` (4 tests) — pure function
      - Returns null when periodsProcessed is 0
      - Formats single period message
      - Formats multiple period range
      - Formats error message
    - `findEligiblePeriods` (5 tests)
      - Identifies months fully past cutoff
      - Excludes months with recent events
      - Handles mixed (partial month not eligible)
      - Returns empty for all-recent events
      - Handles empty/missing directory
    - `initEventIndex` (3 tests) — SQLite
      - Creates database with correct schema
      - Is idempotent (open twice, no error)
      - Handles corrupt database (recreate)
    - `indexEvent / indexEvents / removeIndexEntries / insertSummary` (6 tests)
      - indexEvent inserts event row
      - indexEvents batch inserts within transaction
      - removeIndexEntries deletes by period pattern
      - insertSummary stores summary with JSON data
      - querySummaries retrieves and parses summaries
      - removeIndexEntries returns correct deleted count
    - `rebuildIndex` (2 tests)
      - Rebuilds index matching JSONL content
      - Handles empty events directory
    - `isAlreadyArchived` (2 tests)
      - Returns true when summary file exists
      - Returns false when no summary file
    - `archivePeriod` (5 tests)
      - Copies JSONL files to archive/YYYY/
      - Writes summary JSON to archive/YYYY/
      - Preserves original file contents (byte-identical)
      - Uses atomic write for summary (tmp + rename)
      - Skips already-archived files with warning
    - `removeSourceFiles` (3 tests)
      - Removes listed files from events directory
      - Counts successfully removed files
      - Adds warning for files that can't be removed
    - `compactEvents` integration (9 tests)
      - Compacts eligible periods end-to-end
      - Skips already-archived periods (periodsSkipped incremented)
      - Respects maxPeriodsPerRun limit
      - Returns correct CompactionResult counts
      - Is idempotent (run 3x, verify same final state)
      - Leaves active window untouched (recent files remain)
      - Handles empty events directory
      - Handles no eligible periods (all recent)
      - Handles partial failure gracefully (one period fails, others succeed)
    - `Performance` (1 test)
      - Compacting 500 events across 3 months completes in < 2 seconds
  - **Total: ~50 tests**
  - All tests use explicit `eventsDir` and `archiveDir` in temp directories — never touch `~/.pai/`
  - Real file I/O and real SQLite against temp directories, no mocks

### T-9.13: Regression check

- **File:** none (run existing tests)
- **Dependencies:** T-9.12
- **FRs:** Non-functional (no regressions)
- **Description:**
  - Run `bun test` and confirm all existing F-001 through F-008 tests still pass
  - Verify F-008's `events.ts` is unmodified (no breaking changes to existing API)
  - Verify no import conflicts or namespace collisions in `src/index.ts`
  - Run `bun run typecheck` to confirm TypeScript compilation
  - Confirm `bun:sqlite` import doesn't break non-SQLite test runs

## Execution Order

```
T-9.1  (schemas + types — no deps)
  ↓
  ├── T-9.2  (generatePeriodSummary — needs types)
  │
  ├── T-9.3  (formatCompactionMessage — needs types)
  │
  ├── T-9.4  (initEventIndex — needs types)
  │     ↓
  │   T-9.5  (SQLite CRUD — needs init)
  │     ↓
  │   T-9.6  (rebuildIndex — needs CRUD)
  │
  └── T-9.7  (findEligiblePeriods — needs types)

[After T-9.2 + T-9.7:]
  T-9.8  (archivePeriod — needs summary gen + period detection)
    ↓
  T-9.9  (removeSourceFiles — needs archive)

[After T-9.2 + T-9.5 + T-9.7 + T-9.8 + T-9.9:]
  T-9.10 (compactEvents orchestrator — needs all pipeline steps)
    ↓
  T-9.11 (public API exports — needs all functions)
    ↓
  T-9.12 (test suite — needs exports)
    ↓
  T-9.13 (regression check — needs tests passing)
```

**Parallel opportunities:**
- T-9.2, T-9.3, T-9.4, T-9.7 can all start in parallel after T-9.1
- T-9.5 and T-9.6 are sequential (depend on T-9.4)
- T-9.8 needs T-9.2 (summary format) but not T-9.4 (SQLite)

**Critical path:** T-9.1 → T-9.2 → T-9.8 → T-9.9 → T-9.10 → T-9.11 → T-9.12 → T-9.13

## Implementation Notes

### TDD Cycle Per Task

For each task, follow the ISC loop:
1. **RED:** Write failing tests first (specific to this task's test group)
2. **GREEN:** Minimal implementation to pass tests
3. **BLUE:** Refactor while keeping tests green
4. **COMMIT:** `git commit -m "spec(F-009): implement T-9.X — <description>"`

### Shared Test Helper: seedEvents()

```typescript
async function seedEvents(
  eventsDir: string,
  config: {
    months: string[];      // ["2025-10", "2025-11", "2026-01"]
    eventsPerDay?: number; // default 5
    types?: EventType[];   // default all types
  },
): Promise<void>
```

Creates realistic JSONL files spanning configurable months. Used by most test groups. Define in `tests/compaction.test.ts` as a local helper.

### Feature Branch

All work on `spec/F-009-event-log-compaction` branch. Create before starting T-9.1:
```bash
git checkout -b spec/F-009-event-log-compaction
```
