# Documentation Updates: F-008 Event Log Foundation

**Feature:** F-008
**Date:** 2026-02-01

## What Was Created

### New Source Files

| File | Purpose |
|------|---------|
| `src/events.ts` | `resolveEventsDir()`, `appendEvent()`, `readEvents()`, `countEvents()`, `logEvent()`, Zod schemas |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/events.test.ts` | 30 | Path resolution, event writing, reading with filters, counting, convenience helper, performance |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added F-008 type, schema, and function exports |

## Public API Additions

Exported from `src/index.ts`:

### Types
- `EventType` -- `"session_start" | "session_end" | "skill_invoked" | "isc_verified" | "learning_extracted" | "proposal_accepted" | "proposal_rejected" | "error" | "custom"`
- `SystemEvent` -- `{ id, timestamp, sessionId, type: EventType, data: Record<string, unknown> }`
- `AppendResult` -- `{ ok: true; eventId; file }` or `{ ok: false; error }`
- `ReadEventsOptions` -- `{ eventsDir?, type?, sessionId?, since?, until?, limit? }`

### Schemas
- `eventTypeSchema` -- Zod enum for event types
- `systemEventSchema` -- Zod object for full event validation

### Functions
- `resolveEventsDir(eventsDir?: string): string` -- Pure: resolve events directory path
- `appendEvent(event: SystemEvent, eventsDir?: string): Promise<AppendResult>` -- Append event to day-partitioned JSONL file
- `readEvents(options?: ReadEventsOptions): Promise<SystemEvent[]>` -- Read events with filtering, sorting, and limit
- `countEvents(options?: ReadEventsOptions): Promise<Record<string, number>>` -- Count events grouped by type
- `logEvent(type, data, sessionId?, eventsDir?): Promise<AppendResult>` -- Convenience wrapper, never throws

## Design Decisions

### JSONL Format
- One JSON object per line, day-partitioned files (`events-YYYY-MM-DD.jsonl`)
- Human-readable: compatible with `cat`, `grep`, `jq`
- Append-only: events never modified after writing
- No SQLite index in v1 (deferred to F-009 compaction)

### File-per-Day Partitioning
- Filename: `events-YYYY-MM-DD.jsonl` derived from event timestamp
- Enables efficient date-range filtering by filename before reading content
- Natural rotation and manual cleanup support

### v1 Simplifications
- `countEvents()` delegates to `readEvents()` (no optimized counting)
- No concurrent write protection beyond OS-level append atomicity
- SQLite index deferred to F-009

## No External Documentation Changes

F-008 is a foundation library layer. CLI documentation will come with F-011.
