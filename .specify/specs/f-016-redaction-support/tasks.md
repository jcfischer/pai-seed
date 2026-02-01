---
feature: "Redaction support"
feature_id: "F-016"
created: "2026-02-01"
---

# Implementation Tasks: Redaction Support

## Task Groups

### Group 1: Event Type Extension

#### T-16.1: Add Redaction Event Type
**File**: `src/events.ts`, `src/redaction.ts`
**Test**: `tests/redaction.test.ts`

- Add `"redaction"` to `eventTypeSchema`
- Define `redactionDataSchema`: { redactedEventId, reason? }
- Add `includeRedacted` to ReadEventsOptions

Tests:
- [ ] eventTypeSchema accepts "redaction"
- [ ] redactionDataSchema validates correct data
- [ ] redactionDataSchema rejects missing redactedEventId

### Group 2: Core Functions

#### T-16.2: getRedactedIds and isRedacted
**File**: `src/redaction.ts`
**Test**: `tests/redaction.test.ts`

- `getRedactedIds(options?)` — Returns Set<string> of redacted event IDs
- `isRedacted(eventId, options?)` — Checks single ID

Tests:
- [ ] getRedactedIds returns empty set for no redactions
- [ ] getRedactedIds finds redacted IDs
- [ ] isRedacted returns true for redacted event
- [ ] isRedacted returns false for non-redacted event

#### T-16.3: redactEvent
**File**: `src/redaction.ts`
**Test**: `tests/redaction.test.ts`

- `redactEvent(eventId, reason?, options?)` — Append redaction marker
- Validates target event exists
- Returns error if not found or already redacted

Tests:
- [ ] redactEvent creates redaction marker
- [ ] redactEvent returns error for nonexistent event
- [ ] redactEvent returns error for already redacted event
- [ ] redactEvent includes reason in data
- [ ] Audit trail: original event preserved in JSONL

### Group 3: Query Integration

#### T-16.4: readEvents Filtering
**File**: `src/events.ts`
**Test**: `tests/redaction.test.ts`

- Update readEvents to filter redacted events by default
- `includeRedacted: true` shows all events

Tests:
- [ ] readEvents excludes redacted events by default
- [ ] readEvents includes redacted events when includeRedacted=true
- [ ] readEvents still works with no redactions

### Group 4: CLI

#### T-16.5: CLI redact Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

- Add `redact <event_id> [reason]` command

Tests:
- [ ] redact command succeeds for valid event
- [ ] redact command fails for invalid event

### Group 5: Integration

#### T-16.6: Exports
**File**: `src/index.ts`
**Test**: `tests/redaction.test.ts`

Tests:
- [ ] All exports importable from index

## Task Summary

| Task | Description | Tests |
|------|-------------|-------|
| T-16.1 | Redaction event type | 3 |
| T-16.2 | getRedactedIds and isRedacted | 4 |
| T-16.3 | redactEvent | 5 |
| T-16.4 | readEvents filtering | 3 |
| T-16.5 | CLI redact command | 2 |
| T-16.6 | Exports | 1 |
| **Total** | | **18** |
