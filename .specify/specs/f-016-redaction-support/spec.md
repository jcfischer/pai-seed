---
feature: "Redaction support"
feature_id: "F-016"
created: "2026-02-01"
depends_on: ["F-008"]
---

# Specification: Redaction Support

## Overview

Users can redact events from the event log. Redaction appends a new event that marks the original as redacted. The JSONL file preserves the full audit trail (original + redaction marker). Query functions exclude redacted events by default. CLI command: `pai-seed redact <event_id>`.

## Requirements

### R-1: Redaction Event Type
- Add `"redaction"` to eventTypeSchema enum
- Redaction event data contains: `{ redactedEventId, reason? }`
- Zod schema for redaction data

### R-2: Redact Function
- `redactEvent(eventId, reason?, options?)` — Append redaction marker
- Validates the target event exists before redacting
- Returns error if event not found or already redacted
- Appends redaction event to the same day's JSONL file as the original

### R-3: Query Filtering
- `readEvents()` gains `includeRedacted?: boolean` option (default false)
- When `includeRedacted` is false (default), events whose IDs appear in redaction markers are excluded
- `isRedacted(eventId, options?)` — Check if a specific event has been redacted
- `getRedactedIds(options?)` — Return set of all redacted event IDs

### R-4: CLI Command
- `pai-seed redact <event_id> [reason]` — Redact an event
- Shows confirmation of what was redacted

### R-5: Audit Trail
- Original event lines remain in JSONL — never deleted or modified
- Redaction is append-only
- Full history reconstructable by reading with `includeRedacted: true`

## Out of Scope
- Bulk redaction (multiple IDs at once)
- Redaction of redaction events
- Auto-redaction based on patterns
- UI for browsing redacted events

## Architecture

- Modified file: `src/events.ts` — Add redaction type, filtering
- New file: `src/redaction.ts` — Redaction operations
- Modified file: `src/cli.ts` — Add `redact` command
- New test: `tests/redaction.test.ts`
- Exports added to `src/index.ts`
