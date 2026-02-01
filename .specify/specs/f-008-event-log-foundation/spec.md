---
id: "F-008"
feature: "Event log foundation"
status: "draft"
created: "2026-02-01"
depends_on: ["F-002"]
---

# Specification: Event Log Foundation

## Overview

Provide an append-only event log at `~/.pai/events/` that records system events as JSONL (JSON Lines). Each event has a timestamp, session ID, typed event category, and data payload. Events are written synchronously to JSONL files and optionally indexed for querying.

This is the foundation layer — it provides event writing and reading functions. Higher features (F-009 compaction, F-010 checkpoints, F-012 ACR integration) build on this.

The event log uses JSONL files (one per day) for simplicity, durability, and human readability. No SQLite index in v1 — that's deferred to F-009 compaction when query performance matters.

## User Scenarios

### Scenario 1: Recording a system event

**As a** PAI system component
**I want** to append a typed event to the log
**So that** system activity is auditable and analyzable

**Acceptance Criteria:**
- [ ] `appendEvent(event)` writes a JSONL line to the current day's log file
- [ ] Event includes timestamp, sessionId, type, and typed data payload
- [ ] Events are append-only — never modified after writing
- [ ] File created automatically if it doesn't exist

### Scenario 2: Reading recent events

**As a** PAI system analyzing recent activity
**I want** to read events from the log with filtering
**So that** I can query recent activity by type or time range

**Acceptance Criteria:**
- [ ] `readEvents(options?)` returns events matching filters
- [ ] Filter by event type
- [ ] Filter by date range (last N days)
- [ ] Filter by session ID
- [ ] Events returned in chronological order

### Scenario 3: Counting events

**As a** PAI system providing summary statistics
**I want** to count events by type
**So that** dashboards and summaries have accurate numbers

**Acceptance Criteria:**
- [ ] `countEvents(options?)` returns counts by type
- [ ] Supports same filters as readEvents
- [ ] Efficient — doesn't load all event data

### Scenario 4: Hook integration

**As a** Claude Code hook
**I want** a simple function to log events from hooks
**So that** hook scripts can record activity with minimal code

**Acceptance Criteria:**
- [ ] `logEvent(type, data, sessionId?)` is a thin wrapper for appendEvent
- [ ] Never throws — errors are logged and swallowed
- [ ] Auto-resolves events directory path

## Functional Requirements

### FR-1: Event Schema

Define typed events using discriminated union:

```typescript
type EventType =
  | "session_start"
  | "session_end"
  | "skill_invoked"
  | "isc_verified"
  | "learning_extracted"
  | "proposal_accepted"
  | "proposal_rejected"
  | "error"
  | "custom";

type EventBase = {
  id: string;            // nanoid
  timestamp: string;     // ISO datetime
  sessionId: string;     // identifies the session
  type: EventType;       // discriminator
};

type SystemEvent = EventBase & {
  data: Record<string, unknown>;  // typed payload per event type
};
```

Validate events with a Zod schema. Events must be self-contained — each JSONL line is a complete, parseable JSON object.

**Validation:** Unit test: each event type validates, invalid events rejected.

### FR-2: Event Writing

Provide `appendEvent(event: SystemEvent, eventsDir?: string): Promise<AppendResult>` that:

```typescript
type AppendResult =
  | { ok: true; eventId: string; file: string }
  | { ok: false; error: string };
```

1. Resolve events directory: `eventsDir ?? ~/.pai/events/`
2. Create directory if it doesn't exist
3. Determine filename: `events-YYYY-MM-DD.jsonl` (current date)
4. Serialize event to JSON (single line, no pretty-print)
5. Append line + newline to file
6. Return event ID and filename

**Constraints:**
- Append-only — never modify existing lines
- One event per line (JSONL format)
- File-per-day naming for easy rotation
- Create parent directories if missing

**Validation:** Unit test: append single event, append multiple events to same file, file created on first write, directory created if missing.

### FR-3: Event Reading

Provide `readEvents(options?: ReadEventsOptions): Promise<SystemEvent[]>` that:

```typescript
type ReadEventsOptions = {
  eventsDir?: string;
  type?: EventType;
  sessionId?: string;
  since?: Date;          // events after this timestamp
  until?: Date;          // events before this timestamp
  limit?: number;        // max events to return
};
```

1. Resolve events directory
2. List `events-*.jsonl` files in directory
3. Filter files by date range (from filename) for efficiency
4. Read matching files line by line
5. Parse each line as JSON, validate as SystemEvent
6. Apply filters (type, sessionId, since, until)
7. Sort chronologically (ascending)
8. Apply limit
9. Return array (empty if no matches or no files)

**Validation:** Unit test: read all, filter by type, filter by date, filter by session, limit, empty directory.

### FR-4: Event Counting

Provide `countEvents(options?: ReadEventsOptions): Promise<Record<EventType, number>>` that:

1. Uses same filtering as readEvents
2. Returns counts grouped by event type
3. Only reads lines needed (can skip data parsing for count-only)

**Validation:** Unit test: count all, count with filters, empty.

### FR-5: Event Logging Helper

Provide `logEvent(type: EventType, data: Record<string, unknown>, sessionId?: string, eventsDir?: string): Promise<AppendResult>` that:

1. Create a SystemEvent with nanoid ID and current timestamp
2. Default sessionId to `process.env.PAI_SESSION_ID ?? "unknown"`
3. Call appendEvent
4. Never throws — wrap in try/catch

This is the convenience function hooks and other components call.

**Validation:** Unit test: log event, default session, never throws.

### FR-6: Events Directory Resolution

Provide `resolveEventsDir(eventsDir?: string): string` that:

1. If provided: return as-is
2. Default: `~/.pai/events/`
3. Pure function

**Validation:** Unit test: custom path, default path.

## Non-Functional Requirements

- **Performance:** `appendEvent()` completes in < 10ms (single file append)
- **Durability:** Events survive process crashes (flush after each write)
- **No external deps:** Uses only nanoid (already in deps) and fs operations
- **Testability:** All functions accept directory overrides. Tests use temp directories.
- **Human readable:** JSONL files can be read with `cat`, `grep`, `jq`

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| SystemEvent | A single logged event | New in F-008 |
| EventType | Discriminated event category | New in F-008 |
| AppendResult | Result of writing an event | New in F-008 |
| ReadEventsOptions | Filters for reading events | New in F-008 |

## Success Criteria

- [ ] `appendEvent()` writes JSONL lines to day-partitioned files
- [ ] `readEvents()` reads and filters events from JSONL files
- [ ] `countEvents()` counts events by type
- [ ] `logEvent()` is a convenience wrapper that never throws
- [ ] Events validate against Zod schema
- [ ] JSONL files are human-readable (one JSON object per line)
- [ ] Day-partitioned filenames (`events-YYYY-MM-DD.jsonl`)
- [ ] Tests use temp directories
- [ ] Existing F-001 through F-006 tests pass (no regressions)
- [ ] `bun test` passes all tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| File-per-day is sufficient granularity | Very high event volume | Monitor file sizes |
| JSONL without index is fast enough for reads | Need for complex queries | F-009 adds SQLite index |
| No concurrent write contention | Multiple processes logging simultaneously | OS-level append atomicity for small writes |
| 50MB active store limit is future concern | Handled by F-009 compaction | Out of scope for F-008 |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-002 | Path resolution patterns | Default directory convention |
| nanoid | ID generation | Event ID format |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|------|
| F-009 | readEvents, event files | Compaction reads and archives |
| F-010 | logEvent, appendEvent | Checkpoint records events |
| F-012 | readEvents | ACR indexes event content |
| F-016 | Event format | Redaction marks events |

## Out of Scope

- SQLite index (F-009 concern)
- Event compaction and archival (F-009)
- Checkpoint storage (F-010)
- Event redaction (F-016)
- Event streaming / real-time subscription
