# Implementation Tasks: F-021 Feedback Loop + Monitoring

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☑ | Add confidence + decidedAt to proposalSchema |
| T-1.2 | ☑ | Add extractionStats to stateLayerSchema |
| T-2.1 | ☑ | Preserve confidence in acrLearningsToProposals |
| T-3.1 | ☑ | Create initExtractionStats + updateExtractionStats helpers |
| T-3.2 | ☑ | Wire stats into acceptProposal + rejectProposal |
| T-3.3 | ☑ | Wire stats into acceptAll + rejectAll + review batch |
| T-4.1 | ☑ | Create computeExtractionHealth pure function |
| T-4.2 | ☑ | Add extraction health to cmdStatus |
| T-5.1 | ☑ | Tests for stats computation + alerts |
| T-5.2 | ☑ | Full regression — 589 pass, 0 fail |

---

## Group 1: Schema

### T-1.1: Add confidence + decidedAt to proposalSchema
- **File:** `src/schema.ts`
- **Description:** Add `confidence: z.number().optional()` and `decidedAt: z.string().datetime().optional()`

### T-1.2: Add extractionStats to stateLayerSchema
- **File:** `src/schema.ts`
- **Description:** Define extractionStatsSchema with accepted/rejected/byType/confidenceSum/confidenceCount; add as optional field

---

## Group 2: Confidence Preservation

### T-2.1: Preserve confidence in acrLearningsToProposals
- **File:** `src/extraction.ts`
- **Description:** Include `confidence: l.confidence` in the map output

---

## Group 3: Stats Tracking

### T-3.1: Create stats helpers
- **File:** `src/confirmation.ts`
- **Description:** `initExtractionStats()` returns zero object; `updateExtractionStats(stats, type, action, confidence?)` increments counters

### T-3.2: Wire into single accept/reject
- **File:** `src/confirmation.ts`
- **Description:** In acceptProposal and rejectProposal, set decidedAt, init stats if missing, call updateExtractionStats

### T-3.3: Wire into bulk + review
- **File:** `src/confirmation.ts` + `src/cli.ts`
- **Description:** acceptAllProposals, rejectAllProposals, cmdProposalsReview all increment stats

---

## Group 4: Display

### T-4.1: computeExtractionHealth pure function
- **File:** `src/cli.ts`
- **Description:** Takes SeedConfig, returns formatted string with stats + threshold alerts

### T-4.2: Add to cmdStatus
- **File:** `src/cli.ts`
- **Description:** Call computeExtractionHealth and print after git section

---

## Group 5: Tests + Verification

### T-5.1: Stats and alert tests
- **File:** `tests/confirmation.test.ts`
- **Description:** Test initExtractionStats, updateExtractionStats, threshold alerts

### T-5.2: Full regression
- **Test:** `bun test`
- **Description:** All tests pass

---

## Execution Order

T-1.1, T-1.2 independent (schema).
T-2.1 depends on T-1.1 (confidence field).
T-3.1 depends on T-1.2 (stats schema).
T-3.2, T-3.3 depend on T-3.1.
T-4.1, T-4.2 depend on T-1.2.
T-5.1, T-5.2 depend on all.
