# Technical Plan: Event Log Foundation

## Architecture Overview

```
Hook / Component                   events.ts                    ~/.pai/events/
┌──────────────┐    logEvent()    ┌──────────────┐    append    ┌─────────────────────────┐
│ session hook │──────────────────│              │─────────────│ events-2026-02-01.jsonl │
│ extraction   │    appendEvent() │   Event Log  │             │ events-2026-02-02.jsonl │
│ any module   │──────────────────│   Module     │    read     │ events-2026-02-03.jsonl │
└──────────────┘                  │              │◄────────────│ ...                     │
                  readEvents()    │ (src/events) │             └─────────────────────────┘
┌──────────────┐  countEvents()   │              │
│ F-009 compac │──────────────────│              │   One JSONL line per event:
│ F-010 ckpt   │                  └──────────────┘   {"id":"abc","timestamp":"...","type":"session_start",...}
│ F-012 ACR    │
└──────────────┘

Flow:
  logEvent(type, data, sessionId?)
    → creates SystemEvent (nanoid + ISO timestamp)
    → appendEvent(event, eventsDir?)
      → resolves dir (~/.pai/events/)
      → mkdir -p if needed
      → determines filename: events-YYYY-MM-DD.jsonl
      → JSON.stringify(event) + "\n" → append to file
      → returns { ok: true, eventId, file }

  readEvents(options?)
    → resolves dir
    → lists events-*.jsonl files
    → filters files by date range (from filename)
    → reads matching files line-by-line
    → parses + validates each line
    → applies filters (type, sessionId, since, until)
    → sorts chronologically, applies limit
    → returns SystemEvent[]

  countEvents(options?)
    → same filtering as readEvents
    → returns Record<EventType, number>
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard. `Bun.write()` for file I/O. |
| Validation | Zod | Project pattern. All types Zod-first, TS inferred. |
| IDs | nanoid | Already in `package.json` (`^5.0`). Used by F-006. |
| File format | JSONL | Human-readable, append-friendly, `cat`/`grep`/`jq` compatible. |
| Testing | bun:test | Project standard. Temp directories, no global state. |
| New deps | None | All dependencies already present. |

## Data Model

All types defined via Zod schemas in `src/events.ts`, following the project's Zod-first pattern where TypeScript types are inferred from schemas.

```typescript
import { z } from "zod";

// =============================================================================
// FR-1: Event Schema
// =============================================================================

export const eventTypeSchema = z.enum([
  "session_start",
  "session_end",
  "skill_invoked",
  "isc_verified",
  "learning_extracted",
  "proposal_accepted",
  "proposal_rejected",
  "error",
  "custom",
]);

export const systemEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  sessionId: z.string().min(1),
  type: eventTypeSchema,
  data: z.record(z.unknown()),
});

export type EventType = z.infer<typeof eventTypeSchema>;
export type SystemEvent = z.infer<typeof systemEventSchema>;

// =============================================================================
// FR-2: Append Result
// =============================================================================

export type AppendResult =
  | { ok: true; eventId: string; file: string }
  | { ok: false; error: string };

// =============================================================================
// FR-3: Read Options
// =============================================================================

export type ReadEventsOptions = {
  eventsDir?: string;
  type?: EventType;
  sessionId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};
```

### Entity Relationships

```
SystemEvent (JSONL line)
├── id: string (nanoid)
├── timestamp: string (ISO 8601)
├── sessionId: string (from env or caller)
├── type: EventType (discriminator)
└── data: Record<string, unknown> (typed payload)

Storage: ~/.pai/events/
├── events-2026-02-01.jsonl  (one SystemEvent per line)
├── events-2026-02-02.jsonl
└── ...
```

## API Contracts

### FR-2: `appendEvent(event, eventsDir?)`

```typescript
export async function appendEvent(
  event: SystemEvent,
  eventsDir?: string,
): Promise<AppendResult>
```

**Behavior:**
1. Validate event against `systemEventSchema`
2. Resolve directory via `resolveEventsDir(eventsDir)`
3. `mkdir(dir, { recursive: true })`
4. Filename: `events-${event.timestamp.slice(0, 10)}.jsonl`
5. Serialize: `JSON.stringify(event) + "\n"`
6. Append via `Bun.write()` with `{ append: true }` or `appendFile()`
7. Return `{ ok: true, eventId: event.id, file: filename }`

**Error handling:** Catch all, return `{ ok: false, error: message }`. Never throws.

### FR-3: `readEvents(options?)`

```typescript
export async function readEvents(
  options?: ReadEventsOptions,
): Promise<SystemEvent[]>
```

**Behavior:**
1. Resolve directory
2. `readdir()` to list `events-*.jsonl` files
3. Filter files by date range extracted from filename (`events-YYYY-MM-DD.jsonl`)
4. Read each file, split by `\n`, filter empty lines
5. `JSON.parse()` each line, validate with `systemEventSchema.safeParse()`
6. Skip invalid lines (log to stderr, don't throw)
7. Apply filters: `type`, `sessionId`, `since`, `until`
8. Sort by `timestamp` ascending
9. Apply `limit` (slice)
10. Return empty array if no files or no matches

### FR-4: `countEvents(options?)`

```typescript
export async function countEvents(
  options?: ReadEventsOptions,
): Promise<Record<string, number>>
```

**Behavior:**
1. Call `readEvents(options)` (reuse filtering logic)
2. Reduce to counts by `type`
3. Return `Record<EventType, number>` (only types with > 0 count)

**Note:** For v1, this reads full events then counts. Optimization (parsing only `type` field) deferred to F-009 when performance matters.

### FR-5: `logEvent(type, data, sessionId?, eventsDir?)`

```typescript
export async function logEvent(
  type: EventType,
  data: Record<string, unknown>,
  sessionId?: string,
  eventsDir?: string,
): Promise<AppendResult>
```

**Behavior:**
1. Create `SystemEvent`: `{ id: nanoid(), timestamp: new Date().toISOString(), sessionId: sessionId ?? process.env.PAI_SESSION_ID ?? "unknown", type, data }`
2. Call `appendEvent(event, eventsDir)`
3. Wrap in try/catch — **never throws**
4. On error: return `{ ok: false, error: message }`

### FR-6: `resolveEventsDir(eventsDir?)`

```typescript
export function resolveEventsDir(eventsDir?: string): string
```

**Behavior:**
1. If `eventsDir` provided: return `resolve(eventsDir)`
2. Default: `join(homedir(), ".pai", "events")`
3. Pure function, no I/O

## Implementation Phases

### Phase 1: Schema & Types

**Files:** `src/events.ts` (top section)

- Define `eventTypeSchema` (Zod enum)
- Define `systemEventSchema` (Zod object)
- Export inferred TypeScript types: `EventType`, `SystemEvent`
- Define `AppendResult`, `ReadEventsOptions` types
- Implement `resolveEventsDir()` (FR-6, pure function)

**Depends on:** Nothing. Foundation for all other phases.

### Phase 2: Event Writing

**Files:** `src/events.ts` (append section)

- Implement `appendEvent()` (FR-2)
  - Zod validation before write
  - Directory creation with `mkdir({ recursive: true })`
  - Day-partitioned filename from event timestamp
  - JSONL serialization (single line, no pretty-print)
  - File append operation
  - Result type return
- Implement `logEvent()` (FR-5)
  - Create SystemEvent with nanoid + ISO timestamp
  - Default sessionId from `process.env.PAI_SESSION_ID`
  - Delegate to `appendEvent()`
  - Never-throw wrapper

**Depends on:** Phase 1 (schemas and types).

### Phase 3: Event Reading

**Files:** `src/events.ts` (read section)

- Implement `readEvents()` (FR-3)
  - Directory listing with glob/readdir for `events-*.jsonl`
  - Date-range file filtering (parse date from filename)
  - Line-by-line parsing with validation
  - Filter chain: type, sessionId, since, until
  - Chronological sort + limit
- Implement `countEvents()` (FR-4)
  - Delegates to `readEvents()` for filtering
  - Reduces to type-keyed counts

**Depends on:** Phase 1 (schemas), Phase 2 (need written events to read in tests).

### Phase 4: Public API & Exports

**Files:** `src/index.ts`

- Add F-008 section to `src/index.ts` following existing pattern:
  ```typescript
  // =============================================================================
  // F-008: Event log foundation
  // =============================================================================

  // Types
  export type { EventType, SystemEvent, AppendResult, ReadEventsOptions } from "./events";

  // Schemas
  export { eventTypeSchema, systemEventSchema } from "./events";

  // Functions
  export { resolveEventsDir, appendEvent, readEvents, countEvents, logEvent } from "./events";
  ```

**Depends on:** Phase 2, Phase 3 (all functions exist).

### Phase 5: Tests

**Files:** `tests/events.test.ts`

Test structure mirrors existing patterns (`extraction.test.ts`, `loader.test.ts`):

```
tests/events.test.ts
├── Test Helpers
│   ├── createTempEventsDir()  — mkdtemp in tmpdir
│   └── cleanup()              — rm -rf
│
├── resolveEventsDir (FR-6)
│   ├── returns default ~/.pai/events/ path
│   └── returns custom path when provided
│
├── appendEvent (FR-2)
│   ├── writes single event to JSONL file
│   ├── appends multiple events to same day's file
│   ├── creates directory if missing
│   ├── creates file on first write
│   ├── uses correct day-partitioned filename
│   ├── each line is valid JSON
│   ├── returns eventId and filename on success
│   ├── rejects invalid events (Zod validation)
│   └── returns error on write failure (bad permissions)
│
├── readEvents (FR-3)
│   ├── reads all events from directory
│   ├── filters by event type
│   ├── filters by sessionId
│   ├── filters by date range (since/until)
│   ├── returns chronological order
│   ├── applies limit
│   ├── returns empty array for empty directory
│   ├── returns empty array for non-existent directory
│   ├── skips malformed lines
│   └── reads across multiple day files
│
├── countEvents (FR-4)
│   ├── counts all events by type
│   ├── counts with type filter
│   ├── returns empty record for no events
│   └── supports date range filter
│
├── logEvent (FR-5)
│   ├── creates event with nanoid and timestamp
│   ├── uses PAI_SESSION_ID from env
│   ├── defaults sessionId to "unknown"
│   ├── never throws on error
│   └── delegates to appendEvent
│
└── Performance
    └── appending 1000 events completes in < 1s
```

**Test patterns (matching codebase):**
- `beforeEach`: create temp directory via `mkdtemp(join(tmpdir(), "pai-events-"))`
- `afterEach`: cleanup via `rm(tempDir, { recursive: true, force: true })`
- All functions called with explicit `eventsDir` parameter (never touches `~/.pai/`)
- Assertions: `expect().toBe()`, `expect().toEqual()`, `expect().toContain()`
- No mocks — real file I/O against temp directories

**Depends on:** All phases complete.

## File Structure

```
src/
├── schema.ts          # (existing) Core seed schemas
├── validate.ts        # (existing) Validation
├── defaults.ts        # (existing) Default seed
├── loader.ts          # (existing) File I/O for seed
├── merge.ts           # (existing) Deep merge
├── git.ts             # (existing) Git integration
├── setup.ts           # (existing) Setup wizard
├── session.ts         # (existing) Session context
├── extraction.ts      # (existing) Learning extraction
├── json-schema.ts     # (existing) JSON Schema gen
├── events.ts          # NEW — Event log (schema + write + read + count + helper)
└── index.ts           # MODIFIED — Add F-008 exports

tests/
├── extraction.test.ts # (existing)
├── events.test.ts     # NEW — Event log tests
└── ...                # (existing test files unchanged)

~/.pai/
├── seed.json          # (existing)
└── events/            # NEW — Created on first appendEvent()
    ├── events-2026-02-01.jsonl
    ├── events-2026-02-02.jsonl
    └── ...
```

**Design decision:** Single `src/events.ts` file (not `src/events/` directory) because:
- Matches codebase pattern: each feature = one file in flat `src/`
- Module is self-contained (~150-200 lines estimated)
- All 6 FRs are tightly coupled (shared types, shared helpers)

## Dependencies

### Runtime Dependencies

| Dependency | Version | Usage | Status |
|-----------|---------|-------|--------|
| zod | ^3.23 | Event schema validation | Already in package.json |
| nanoid | ^5.0 | Event ID generation | Already in package.json |

**No new dependencies required.**

### Upstream (What F-008 Uses)

| Module | What | Why |
|--------|------|-----|
| `node:os` | `homedir()` | Default events directory path |
| `node:path` | `join()`, `resolve()` | Path construction |
| `node:fs/promises` | `mkdir()`, `readdir()`, `appendFile()` | File I/O |
| `nanoid` | `nanoid()` | Event ID generation |
| `zod` | Schema validation | Event validation |

### Downstream (What Uses F-008)

| Feature | What They Import | Status |
|---------|-----------------|--------|
| F-009 Compaction | `readEvents()`, event files | Future |
| F-010 Checkpoints | `logEvent()`, `appendEvent()` | Future |
| F-012 ACR | `readEvents()` | Future |
| F-016 Redaction | Event format knowledge | Future |

### Integration Points

F-008 is intentionally **standalone** — it does not import from `loader.ts`, `git.ts`, or other existing modules. The only shared code is the `nanoid` dependency. This keeps the event log decoupled from the seed system, as designed in the spec.

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Concurrent writes from multiple processes | Medium — interleaved JSON lines | Low — single Claude session typically | OS-level append atomicity for small writes (<4KB). Each event is a single `appendFile()` call. POSIX guarantees atomic appends under `PIPE_BUF` (4096 bytes). Documented as assumption. |
| Large JSONL files slow reads | Medium — degraded query performance | Low in v1 — event volume is low | Date-partitioned files limit per-file size. F-009 adds compaction and SQLite indexing. |
| Malformed lines in JSONL | Low — individual events unreadable | Low — we validate before writing | `readEvents()` skips invalid lines with stderr warning. Never throws on bad data. |
| Directory permissions | Medium — can't write events | Low — same dir pattern as seed | `mkdir({ recursive: true })` + error result type. Same pattern as `loader.ts`. |
| Clock skew across events | Low — out-of-order timestamps | Very Low — single machine | Sort by timestamp string (ISO 8601 sorts lexicographically). Documented assumption. |
| Disk space growth | Medium — unbounded append | Low in v1 | File-per-day naming enables manual cleanup. F-009 compaction handles this systematically. |

## Implementation Notes

### File Append Strategy

Use `appendFile()` from `node:fs/promises` rather than `Bun.write({ append: true })` because:
- `appendFile` is the standard Node.js API with well-defined append semantics
- Bun's `Bun.write` with append mode has less documented behavior for concurrent access
- Matches the "no external deps" constraint

### JSONL Format Invariants

- Each line is exactly one `JSON.stringify(event)` output (no pretty-print)
- Lines terminated with `\n`
- No header line, no footer
- Empty files are valid (zero events)
- Files can be concatenated: `cat events-*.jsonl` produces valid JSONL

### Date Extraction from Filenames

```typescript
// Extract date from "events-2026-02-01.jsonl" → "2026-02-01"
const DATE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;
```

File filtering by date range uses filename dates, not event timestamps. This is an optimization — avoids reading files outside the query window. Events within a file are still filtered by their actual timestamps.

### Session ID Resolution

```
logEvent sessionId parameter → process.env.PAI_SESSION_ID → "unknown"
```

This follows the same pattern as F-006's `extractProposals()` which defaults `sessionId` to `"unknown-session"`.
