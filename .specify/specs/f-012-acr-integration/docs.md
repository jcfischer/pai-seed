# Documentation Updates: F-012 ACR Integration

## Files Updated

### API Surface Added

New file `src/acr.ts` — ACR document export functions.

**Types:**
- `AcrDocument` — Standard document format for ACR Tier 2 semantic search
- `AcrExportOptions` — Options: seedPath, eventsDir, eventWindowDays
- `AcrExportResult` — Discriminated union result type

**Schema:**
- `acrDocumentSchema` — Zod schema for AcrDocument (sourceId, content, source, lastUpdated, metadata)

**Functions:**
- `exportLearnings(options?)` — Export seed learnings as ACR documents
- `exportEventSummaries(options?)` — Export event log summaries grouped by day
- `exportAllForACR(options?)` — Combined export of learnings + event summaries

### Document Format

Each `AcrDocument` has:
- `sourceId` — Unique identifier (e.g., `seed:learning:p1`, `seed:event:2026-02-01`)
- `content` — Human-readable text with type prefix
- `source` — Origin identifier (`seed` for learnings, `seed:events` for events)
- `lastUpdated` — ISO datetime string
- `metadata` — Type-specific metadata record

### Learning Export Format

Learnings are prefixed by type:
- `Pattern: <content>`
- `Insight: <content>`
- `Self-knowledge: <content>`

### Event Summary Format

Events grouped by day:
- `Events on 2026-02-01: 5 total (3 session_start, 2 skill_invoked)`

### New File Locations

- `src/acr.ts` — ACR integration (~160 lines)
- `tests/acr.test.ts` — 14 tests
