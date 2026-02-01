# Implementation Tasks: Event Log Foundation (F-008)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Zod schemas + types |
| T-1.2 | ☐ | resolveEventsDir |
| T-2.1 | ☐ | appendEvent |
| T-2.2 | ☐ | logEvent |
| T-3.1 | ☐ | readEvents |
| T-3.2 | ☐ | countEvents |
| T-4.1 | ☐ | Public API exports |
| T-5.1 | ☐ | Test suite |
| T-5.2 | ☐ | Regression check |

## Group 1: Foundation

### T-1.1: Define event schemas and types [T]

- **File:** `src/events.ts` (top section, lines ~1-50)
- **Test:** `tests/events.test.ts` (schema validation group)
- **Dependencies:** none
- **FRs:** FR-1 (Event Schema)
- **Description:**
  - Create `src/events.ts` with Zod schemas following codebase Zod-first pattern
  - Define `eventTypeSchema` — Zod enum with 9 event types: `session_start`, `session_end`, `skill_invoked`, `isc_verified`, `learning_extracted`, `proposal_accepted`, `proposal_rejected`, `error`, `custom`
  - Define `systemEventSchema` — Zod object: `id` (string min 1), `timestamp` (string datetime), `sessionId` (string min 1), `type` (eventTypeSchema), `data` (record of unknown)
  - Export inferred types: `EventType`, `SystemEvent`
  - Define and export `AppendResult` discriminated union type: `{ ok: true; eventId: string; file: string } | { ok: false; error: string }`
  - Define and export `ReadEventsOptions` type: `eventsDir?`, `type?`, `sessionId?`, `since?`, `until?`, `limit?`

### T-1.2: Implement resolveEventsDir [T]

- **File:** `src/events.ts` (after types, ~lines 50-65)
- **Test:** `tests/events.test.ts` (resolveEventsDir group)
- **Dependencies:** T-1.1
- **FRs:** FR-6 (Events Directory Resolution)
- **Description:**
  - Implement `resolveEventsDir(eventsDir?: string): string`
  - If `eventsDir` provided: return `resolve(eventsDir)`
  - Default: `join(homedir(), ".pai", "events")`
  - Pure function, no I/O, no async
  - Import `homedir` from `node:os`, `join`/`resolve` from `node:path`

## Group 2: Core Write

### T-2.1: Implement appendEvent [T]

- **File:** `src/events.ts` (write section, ~lines 65-110)
- **Test:** `tests/events.test.ts` (appendEvent group)
- **Dependencies:** T-1.1, T-1.2
- **FRs:** FR-2 (Event Writing)
- **Description:**
  - Implement `appendEvent(event: SystemEvent, eventsDir?: string): Promise<AppendResult>`
  - Validate event with `systemEventSchema.safeParse(event)` — return error result if invalid
  - Resolve directory via `resolveEventsDir(eventsDir)`
  - `mkdir(dir, { recursive: true })` to ensure directory exists
  - Compute filename: `events-${event.timestamp.slice(0, 10)}.jsonl` (day-partitioned)
  - Serialize: `JSON.stringify(event) + "\n"` (single line, no pretty-print)
  - Append via `appendFile(join(dir, filename), line)` from `node:fs/promises`
  - Return `{ ok: true, eventId: event.id, file: filename }`
  - Wrap in try/catch — return `{ ok: false, error: e.message }` on failure
  - **Never throws**

### T-2.2: Implement logEvent [T] [P with T-3.1, T-3.2]

- **File:** `src/events.ts` (helper section, ~lines 110-140)
- **Test:** `tests/events.test.ts` (logEvent group)
- **Dependencies:** T-2.1
- **FRs:** FR-5 (Event Logging Helper)
- **Description:**
  - Implement `logEvent(type: EventType, data: Record<string, unknown>, sessionId?: string, eventsDir?: string): Promise<AppendResult>`
  - Create `SystemEvent`: `{ id: nanoid(), timestamp: new Date().toISOString(), sessionId: sessionId ?? process.env.PAI_SESSION_ID ?? "unknown", type, data }`
  - Call `appendEvent(event, eventsDir)`
  - Wrap entire function in try/catch — return `{ ok: false, error: message }` on any error
  - **Never throws** — this is the hook-safe convenience function
  - Import `nanoid` from `nanoid`

## Group 3: Core Read

### T-3.1: Implement readEvents [T] [P with T-2.2]

- **File:** `src/events.ts` (read section, ~lines 140-210)
- **Test:** `tests/events.test.ts` (readEvents group)
- **Dependencies:** T-1.1, T-1.2
- **FRs:** FR-3 (Event Reading)
- **Description:**
  - Implement `readEvents(options?: ReadEventsOptions): Promise<SystemEvent[]>`
  - Resolve directory via `resolveEventsDir(options?.eventsDir)`
  - List files with `readdir()`, filter to `events-*.jsonl` pattern using regex: `/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/`
  - Filter files by date range: extract date from filename, skip files outside `since`/`until` window
  - Read each matching file, split by `\n`, filter empty lines
  - Parse each line: `JSON.parse(line)`, validate with `systemEventSchema.safeParse()`
  - Skip invalid lines silently (no throw)
  - Apply filters: `type` (exact match), `sessionId` (exact match), `since` (timestamp >= since.toISOString()), `until` (timestamp <= until.toISOString())
  - Sort by `timestamp` ascending (ISO 8601 sorts lexicographically)
  - Apply `limit` via `.slice(0, limit)`
  - Return empty array if directory doesn't exist or no matches
  - Handle non-existent directory gracefully (return `[]`, don't throw)

### T-3.2: Implement countEvents [T] [P with T-2.2]

- **File:** `src/events.ts` (count section, ~lines 210-230)
- **Test:** `tests/events.test.ts` (countEvents group)
- **Dependencies:** T-3.1
- **FRs:** FR-4 (Event Counting)
- **Description:**
  - Implement `countEvents(options?: ReadEventsOptions): Promise<Record<string, number>>`
  - Call `readEvents(options)` to get filtered events
  - Reduce to counts by `type` field: `events.reduce((acc, e) => { acc[e.type] = (acc[e.type] ?? 0) + 1; return acc; }, {})`
  - Return only types with count > 0
  - Note: v1 delegates to readEvents for simplicity. Optimization deferred to F-009.

## Group 4: Integration

### T-4.1: Add public API exports [T]

- **File:** `src/index.ts` (add F-008 section after F-006)
- **Test:** Import test in `tests/events.test.ts` (verify exports resolve)
- **Dependencies:** T-2.1, T-2.2, T-3.1, T-3.2
- **FRs:** All (public surface area)
- **Description:**
  - Add new section to `src/index.ts` following existing pattern:
    ```
    // =============================================================================
    // F-008: Event log foundation
    // =============================================================================
    ```
  - Export types: `EventType`, `SystemEvent`, `AppendResult`, `ReadEventsOptions`
  - Export schemas: `eventTypeSchema`, `systemEventSchema`
  - Export functions: `resolveEventsDir`, `appendEvent`, `readEvents`, `countEvents`, `logEvent`

## Group 5: Verification

### T-5.1: Write full test suite [T]

- **File:** `tests/events.test.ts`
- **Dependencies:** T-4.1 (all functions exported)
- **FRs:** All
- **Description:**
  - Create `tests/events.test.ts` following `extraction.test.ts` patterns:
    - Import from `bun:test`: `describe`, `expect`, `test`, `beforeEach`, `afterEach`
    - Temp dir setup: `mkdtemp(join(tmpdir(), "pai-events-test-"))` in `beforeEach`
    - Cleanup: `rm(tempDir, { recursive: true, force: true })` in `afterEach`
  - **Test groups and cases:**
    - `resolveEventsDir` (2 tests)
      - Returns default `~/.pai/events/` path when no arg
      - Returns resolved custom path when provided
    - `appendEvent` (8 tests)
      - Writes single event to JSONL file
      - Appends multiple events to same day's file
      - Creates directory if missing
      - Creates file on first write
      - Uses correct day-partitioned filename (`events-YYYY-MM-DD.jsonl`)
      - Each line is valid parseable JSON
      - Returns `{ ok: true, eventId, file }` on success
      - Returns `{ ok: false, error }` for invalid event (Zod rejection)
    - `readEvents` (10 tests)
      - Reads all events from directory
      - Filters by event type
      - Filters by sessionId
      - Filters by date range (since)
      - Filters by date range (until)
      - Returns chronological order
      - Applies limit
      - Returns empty array for empty directory
      - Returns empty array for non-existent directory
      - Skips malformed JSONL lines
    - `countEvents` (4 tests)
      - Counts all events grouped by type
      - Counts with type filter applied
      - Returns empty record for no events
      - Supports date range filtering
    - `logEvent` (5 tests)
      - Creates event with nanoid ID and ISO timestamp
      - Uses `PAI_SESSION_ID` env var when set
      - Defaults sessionId to `"unknown"` when env unset
      - Never throws on error (bad dir permissions)
      - Returns AppendResult from appendEvent
    - `Performance` (1 test)
      - Appending 100 events completes in < 1 second
  - **Total: ~30 tests**
  - All tests use explicit `eventsDir` parameter — never touch `~/.pai/`
  - Real file I/O against temp directories, no mocks

### T-5.2: Regression check

- **File:** none (run existing tests)
- **Dependencies:** T-5.1
- **FRs:** Non-functional (no regressions)
- **Description:**
  - Run `bun test` and confirm all existing F-001 through F-006 tests still pass
  - Verify no import conflicts or namespace collisions in `src/index.ts`
  - Confirm `bun run build` (if applicable) succeeds

## Execution Order

```
T-1.1  (foundation — no deps)
  ↓
T-1.2  (needs types from T-1.1)
  ↓
  ├── T-2.1  (write — needs T-1.1, T-1.2)
  │     ↓
  │   T-2.2  ──────────────────────────┐
  │                                     │
  ├── T-3.1  (read — needs T-1.1, T-1.2) [parallel with T-2.2]
  │     ↓                              │
  │   T-3.2  (count — needs T-3.1)     │
  │                                     │
  └─────────────────────────────────────┘
                    ↓
                  T-4.1  (exports — needs all functions)
                    ↓
                  T-5.1  (tests — needs exports)
                    ↓
                  T-5.2  (regression — needs tests passing)
```

**Parallel opportunities:**
- T-2.2 (logEvent) and T-3.1 (readEvents) can be implemented in parallel after T-2.1
- T-3.1 implementation doesn't depend on T-2.1 code, only on T-1.x (shared types/resolver). However, T-3.1 *tests* need written events — write the implementation first, test after T-2.1 exists.

**Critical path:** T-1.1 → T-1.2 → T-2.1 → T-3.1 → T-3.2 → T-4.1 → T-5.1 → T-5.2
