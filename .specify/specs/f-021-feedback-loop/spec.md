# F-021: Feedback Loop + Monitoring

## Problem

The extraction pipeline has no feedback mechanism. There is no way to know if proposals are useful (high acceptance) or garbage (low acceptance). Without this signal, the system cannot self-tune and the user cannot assess extraction health.

## Solution

### 1. Track acceptance/rejection rates

Record every accept/reject action with timestamp. Compute running statistics:
- Total proposals created (lifetime)
- Total accepted / rejected / pending
- Acceptance rate (accepted / (accepted + rejected))
- Average confidence of accepted vs rejected proposals
- Per-type breakdown (pattern/insight/self_knowledge)

### 2. Alert on threshold violations

When acceptance rate data exists (minimum 10 decisions):
- **>90% accepted:** Warning — "Extraction filter may be too loose. Consider reviewing criteria."
- **<10% accepted:** Warning — "Extraction producing mostly noise. Consider adjusting ACR confidence threshold."

Alerts shown in `pai-seed status` output.

### 3. Show stats in `pai-seed status`

Add extraction health section to the existing `status` command:

```
Extraction health:
  Proposals: 48 total (5 accepted, 3 rejected, 40 pending)
  Acceptance rate: 62.5% (5/8 decided)
  By type: patterns 3/4 (75%), insights 2/3 (67%), self_knowledge 0/1 (0%)
  Avg confidence: accepted=0.82, rejected=0.51
```

## Data Model

### Proposal tracking fields

Add optional fields to the Proposal schema:

```typescript
// Already exists
status: "pending" | "accepted" | "rejected"

// New fields
decidedAt?: string;      // ISO timestamp of accept/reject
confidence?: number;     // ACR confidence score (preserved from extraction)
```

### Aggregated stats

Computed on-the-fly from proposal history (accepted/rejected entries in git log) and current seed state. No separate stats file needed — derive from existing data.

## User Scenarios

### S1: User runs `pai-seed status` with decision history
- 8 proposals decided (5 accepted, 3 rejected), 40 pending
- Status shows acceptance rate 62.5%
- No threshold alert (between 10% and 90%)

### S2: User rubber-stamps everything
- 20 proposals decided, 19 accepted
- Status shows: "Warning: 95% acceptance rate. Extraction filter may be too loose."

### S3: User rejects almost everything
- 15 proposals decided, 1 accepted
- Status shows: "Warning: 7% acceptance rate. Extraction producing mostly noise."

### S4: Not enough data yet
- Only 3 decisions made
- Status shows stats but no threshold alerts ("Need 10+ decisions for health assessment")

## Functional Requirements

### FR-1: Preserve confidence score on proposals
- **When:** ACR creates a proposal with confidence score
- **Then:** Store confidence on the Proposal object
- **Schema change:** Add optional `confidence: number` to Proposal

### FR-2: Track decision timestamps
- **When:** User accepts or rejects a proposal
- **Then:** Record `decidedAt` timestamp on the proposal before removal
- **Files:** `src/confirmation.ts` accept/reject functions

### FR-3: Compute acceptance stats
- **Input:** All proposals with status accepted/rejected (from git history or seed state)
- **Output:** Total, accepted count, rejected count, rate, per-type breakdown, avg confidence
- **Files:** New function in `src/confirmation.ts` or `src/stats.ts`

### FR-4: Display in `pai-seed status`
- **When:** Running `pai-seed status`
- **Then:** Show extraction health section with stats and threshold alerts
- **Files:** `src/cli.ts` status command

### FR-5: Threshold alerts
- **When:** Acceptance rate >90% or <10% with minimum 10 decisions
- **Then:** Show warning in status output
- **Not:** Do not block operations or change extraction behavior automatically

## Design Decisions

- **Stats from seed state, not separate file:** Accepted learnings are in `learned.*`, rejected proposals can be tracked by keeping a counter in `state.extractionStats` or by counting git commits with "Reject:" prefix.
- **No auto-tuning yet:** Alerts inform the user; they decide whether to adjust. Future versions may auto-tune ACR confidence threshold.
- **Minimum sample size:** 10 decisions before alerting. Below that, show stats but no warnings.

## Out of Scope

- Auto-tuning ACR confidence threshold based on acceptance rate
- Trust tiers (auto-accept high confidence)
- Per-session extraction quality scoring
- Historical trend graphs

## Success Criteria

1. `pai-seed status` shows extraction health stats when proposals have been decided
2. Confidence scores preserved on ACR-extracted proposals
3. Alert fires when acceptance rate >90% with 10+ decisions
4. Alert fires when acceptance rate <10% with 10+ decisions
5. No alert with fewer than 10 decisions
6. All existing tests pass
