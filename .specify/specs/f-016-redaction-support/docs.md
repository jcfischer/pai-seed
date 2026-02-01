# Documentation Updates: F-016 Redaction Support

## Files Updated

### API Surface Added

New file `src/redaction.ts` — Event redaction operations.

**Types:**
- `RedactionData` — Redaction event data (redactedEventId, reason?)
- `RedactResult` — Discriminated union result
- `RedactionOptions` — Options: eventsDir

**Schema:**
- `redactionDataSchema` — Zod schema for redaction event data

**Functions:**
- `getRedactedIds(options?)` — Returns Set of all redacted event IDs
- `isRedacted(eventId, options?)` — Check if specific event is redacted
- `redactEvent(eventId, reason?, options?)` — Append redaction marker

### Modified Files

**`src/events.ts`:**
- Added `"redaction"` to `eventTypeSchema` enum
- Added `includeRedacted?: boolean` to `ReadEventsOptions`
- `readEvents()` now excludes redacted events by default (two-pass filter)

**`src/cli.ts`:**
- Added `redact <event_id> [reason]` command

### Redaction Model

- Redaction is **append-only** — original events are never modified or deleted
- A redaction marker is a regular event with `type: "redaction"` and `data: { redactedEventId }`
- `readEvents()` excludes both the redacted event and the redaction marker by default
- Pass `includeRedacted: true` to see the full audit trail

### CLI Command

| Command | Description |
|---------|-------------|
| `pai-seed redact <id> [reason]` | Redact an event from the log |

### New File Locations

- `src/redaction.ts` — Redaction module (~110 lines)
- `tests/redaction.test.ts` — 16 tests
