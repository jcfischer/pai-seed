---
feature: "Redaction support"
feature_id: "F-016"
created: "2026-02-01"
---

# Implementation Plan: Redaction Support

## Architecture

Redaction is implemented as a new event type within the existing event system. A separate `src/redaction.ts` module provides the redaction-specific logic, while `src/events.ts` gains the new event type and filtering capability.

## Implementation Order

### Group 1: Event Type Extension
- Add `"redaction"` to `eventTypeSchema` enum in events.ts
- Define `redactionDataSchema` in redaction.ts

### Group 2: Core Redaction Functions
- `getRedactedIds(options?)` — Scan events for redaction markers, return Set of IDs
- `isRedacted(eventId, options?)` — Check single event
- `redactEvent(eventId, reason?, options?)` — Validate + append redaction marker

### Group 3: Query Integration
- Extend `ReadEventsOptions` with `includeRedacted?: boolean`
- Update `readEvents()` to filter redacted events by default

### Group 4: CLI
- Add `redact` command to cli.ts dispatcher

### Group 5: Integration
- Add exports to index.ts

## Key Decisions

1. **Redaction as event type** — Redaction markers are regular events with type `"redaction"` and data `{ redactedEventId }`. This preserves the append-only JSONL model.
2. **Default filtering** — `readEvents()` excludes redacted events by default. Pass `includeRedacted: true` to see all.
3. **Two-pass read** — When filtering, first collect redaction markers, then filter events. This adds one pass but keeps the code simple.
4. **Same-day file** — Redaction events go to the current day's JSONL file (not the original event's file), since they represent when the redaction happened.
