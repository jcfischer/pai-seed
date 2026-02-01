# F-021: Feedback Loop + Monitoring — Technical Plan

## Architecture Overview

```
CURRENT:
  acceptProposal()     →  Convert to Learning, remove from proposals (no tracking)
  rejectProposal()     →  Set status "rejected" (no tracking)
  cmdStatus()          →  Path, version, validity, git status

NEW:
  acceptProposal()     →  Increment extractionStats, set decidedAt, then convert
  rejectProposal()     →  Increment extractionStats, set decidedAt, then reject
  cmdStatus()          →  + Extraction health section with stats and alerts
  acrLearningsToProposals() →  Preserve confidence score on Proposal
```

## Technology Stack

No new dependencies. Changes to existing files only.

## Data Model

### Schema additions (all optional, backward compatible)

```typescript
// Proposal: add optional fields
confidence?: number;   // ACR confidence score
decidedAt?: string;    // ISO timestamp of accept/reject

// StateLayer: add optional extractionStats
extractionStats?: {
  accepted: number;
  rejected: number;
  byType: {
    pattern: { accepted: number; rejected: number };
    insight: { accepted: number; rejected: number };
    self_knowledge: { accepted: number; rejected: number };
  };
  confidenceSum: { accepted: number; rejected: number };
  confidenceCount: { accepted: number; rejected: number };
};
```

### Why cumulative counters, not derived stats

Accepted proposals are **removed** from the proposals array (converted to learnings).
Rejected proposals are removed by `clean`. Neither survives long-term in state.
Git commit message parsing is fragile. Counters are the simplest reliable approach.

## API Contracts

| Function | Change |
|----------|--------|
| `proposalSchema` | Add `confidence?: number`, `decidedAt?: string` |
| `stateLayerSchema` | Add `extractionStats` optional object |
| `acrLearningsToProposals()` | Pass confidence through to Proposal |
| `acceptProposal()` | Increment stats, set decidedAt |
| `rejectProposal()` | Increment stats, set decidedAt |
| `acceptAllProposals()` | Increment stats for each |
| `rejectAllProposals()` | Increment stats for each |
| `cmdProposalsReview()` | Increment stats in batch |
| `cmdStatus()` | Add extraction health section |
| NEW `initExtractionStats()` | Return zero-valued stats object |
| NEW `updateExtractionStats()` | Increment counters for a decision |
| NEW `computeExtractionHealth()` | Compute rates, breakdown, alerts from stats |

## Implementation

### Phase 1: Schema

**File:** `src/schema.ts`

Add `confidence` and `decidedAt` as optional fields on proposalSchema.
Add `extractionStatsSchema` with cumulative counters.
Add `extractionStats` optional field on stateLayerSchema.

### Phase 2: Confidence preservation

**File:** `src/extraction.ts`

In `acrLearningsToProposals()`, include `confidence: l.confidence` in the mapped output.

### Phase 3: Stats tracking

**File:** `src/confirmation.ts`

New helpers:
- `initExtractionStats()`: Returns zero-valued ExtractionStats
- `updateExtractionStats(stats, type, action, confidence?)`: Increment counters

Wire into:
- `acceptProposal()`: set decidedAt, increment accepted counters
- `rejectProposal()`: set decidedAt, increment rejected counters
- `acceptAllProposals()`: set decidedAt on each, increment for each
- `rejectAllProposals()`: set decidedAt on each, increment for each

**File:** `src/cli.ts`
- `cmdProposalsReview()`: increment stats for each decision in batch

### Phase 4: Status display

**File:** `src/cli.ts`

New pure function `computeExtractionHealth(config)` returning formatted string.
Add to `cmdStatus()` after git status section.

Threshold alerts:
- Need 10+ decisions (accepted + rejected) for alerts
- >90% acceptance: "Warning: Extraction filter may be too loose"
- <10% acceptance: "Warning: Extraction producing mostly noise"

## File Structure

No new files. All changes in existing files:

```
src/
├── schema.ts         # +confidence, decidedAt, extractionStats
├── extraction.ts     # +confidence preservation
├── confirmation.ts   # +stats tracking helpers, wire into accept/reject
└── cli.ts            # +extraction health in status

tests/
├── confirmation.test.ts  # +stats tracking tests
└── cli.test.ts           # +status output tests (if integration test exists)
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Schema migration needed | Low | All new fields optional, existing seeds parse fine |
| Stats drift from reality | Low | Counters only increment on actual accept/reject |
| Bulk review stats wrong | Medium | Wire stats into review batch path carefully |
