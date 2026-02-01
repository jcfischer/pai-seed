---
feature: "ACR integration"
feature_id: "F-012"
created: "2026-02-01"
---

# Implementation Tasks: ACR Integration

## Task Groups

### Group 1: Types + Schema

#### T-12.1: ACR Document Schema
**File**: `src/acr.ts`
**Test**: `tests/acr.test.ts`

Define Zod schema and types:
- `AcrDocument` schema: sourceId, content, source, metadata, lastUpdated
- `AcrExportOptions` type: seedPath, eventsDir, eventWindowDays
- `AcrExportResult` type: discriminated union

Tests:
- [ ] Schema validates correct document
- [ ] Schema rejects missing fields

### Group 2: Export Functions

#### T-12.2: exportLearnings
**File**: `src/acr.ts`
**Test**: `tests/acr.test.ts`

Transform learnings to ACR documents:
- Load seed via loadSeed()
- Map each learning → AcrDocument
- sourceId: `seed:learning:<id>`
- content: `<Type>: <content>`
- metadata: { type, confirmed, extractedAt, tags }

Tests:
- [ ] Exports patterns with correct sourceId format
- [ ] Exports insights and selfKnowledge
- [ ] Returns empty array for no learnings
- [ ] Content includes type prefix
- [ ] Metadata includes correct fields

#### T-12.3: exportEventSummaries
**File**: `src/acr.ts`
**Test**: `tests/acr.test.ts`

Transform events to ACR documents:
- Read events via readEvents() for date window
- Group by day, count by type
- Generate one document per day with events
- sourceId: `seed:event:<date>`
- content: "Events on <date>: N total (X type_a, Y type_b...)"

Tests:
- [ ] Exports event summaries for date range
- [ ] Groups events by day correctly
- [ ] Returns empty array for no events
- [ ] Handles missing events directory gracefully

#### T-12.4: exportAllForACR
**File**: `src/acr.ts`
**Test**: `tests/acr.test.ts`

Combined export:
- Call exportLearnings + exportEventSummaries
- Concatenate results
- Return unified array

Tests:
- [ ] Combines learnings and event summaries
- [ ] Works with no learnings and no events

### Group 3: Integration

#### T-12.5: Exports and Barrel
**File**: `src/index.ts`
**Test**: `tests/acr.test.ts`

Add F-012 exports:
- Types: AcrDocument, AcrExportOptions, AcrExportResult
- Functions: exportLearnings, exportEventSummaries, exportAllForACR
- Schema: acrDocumentSchema

Tests:
- [ ] All exports importable from index

## Task Summary

| Task | Description | Tests |
|------|-------------|-------|
| T-12.1 | ACR document schema | 2 |
| T-12.2 | exportLearnings | 5 |
| T-12.3 | exportEventSummaries | 4 |
| T-12.4 | exportAllForACR | 2 |
| T-12.5 | Exports and barrel | 1 |
| **Total** | | **14** |
