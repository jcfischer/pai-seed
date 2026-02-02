# F-022: Implementation Plan

## Problem Summary

Session start injects ALL learnings and proposals with full content, wasting context window (~800-1200 tokens) and duplicating content already handled by ACR. F-025 provides semantic retrieval — use it to inject only relevant learnings, and compact proposals to index format.

## Architecture

### Current Flow (src/session.ts)
```
generateSessionContext()
  ├─ formatIdentitySummary()     [always]
  ├─ formatLearningSummary()     [dumps top 5 per category]
  ├─ formatProposals()           [dumps top 5 with full content]
  └─ formatSessionState()        [always]
```

### New Flow (F-022)
```
generateSessionContext()
  ├─ formatIdentitySummary()          [always]
  ├─ formatRelevantLearnings()        [semantic via F-025, compact]
  │   └─ retrieveRelevantLearnings()  [from embeddings.ts]
  ├─ formatCompactProposals()         [index: ID, type, 40 chars, conf]
  └─ formatSessionState()             [always]
```

## API Design

### New Function: formatRelevantLearnings
```typescript
/**
 * Format relevant learnings using F-025 semantic retrieval.
 * Falls back to recency when embeddings unavailable.
 * Returns empty string when no learnings exist.
 */
function formatRelevantLearnings(
  config: SeedConfig,
  context: { project?: string; cwd?: string }
): Promise<string>
```

**Output format:**
```
Relevant learnings (3/15):
  [0.89] pattern: Prefers explicit error handling over silent failures
  [0.84] pattern: Uses Zod for all schema validation
  [0.76] insight: ACR confidence threshold 0.7 balances recall/precision
```

**Fallback (no embeddings):**
```
Recent learnings (5/15):
  - pattern: Prefers explicit error handling over silent failures
  - pattern: Uses Zod for all schema validation
  ...
```

### Modified Function: formatProposals
Rewrite to compact index format:
```typescript
/**
 * Format proposals as compact index.
 * ID prefix (5 chars), type, truncated content (40 chars), confidence.
 */
function formatCompactProposals(proposals: Proposal[]): string
```

**Output format:**
```
Pending proposals (5):
  abc12 pattern  "Prefers explicit error handling..." (0.82)
  def45 insight  "TypeScript strict mode catches..." (0.71)
  ...

Review: `pai-seed proposals review`
```

### Modified Type: SessionContext
Extend with metadata:
```typescript
export type SessionContext = {
  ok: true;
  context: string;
  needsSetup: boolean;
  config: SeedConfig | null;
  proposalCount: number;
  // F-022 additions:
  tokenEstimate?: number;       // Approximate tokens in context
  learningsShown?: number;      // N in "Relevant learnings (N/total)"
  learningsTotal?: number;      // total
} | { ok: false; error: string };
```

## TDD Strategy

### Test Structure
- **Unit tests** for pure functions (`formatRelevantLearnings`, `formatCompactProposals`)
  - Mock `retrieveRelevantLearnings` to avoid embedding dependencies
  - Test edge cases: zero learnings, zero proposals, fallback mode
- **Integration tests** for `generateSessionContext`
  - Verify metadata fields populated
  - Verify format structure

### Test Cases (tasks.md will detail each)

1. **T-22.1**: `formatRelevantLearnings` with semantic results
   - Mock `retrieveRelevantLearnings` to return scored learnings
   - Assert format: `[score] type: content`
   - Assert header: `Relevant learnings (N/total)`

2. **T-22.2**: `formatRelevantLearnings` with recency fallback
   - Mock `retrieveRelevantLearnings` to return score=0 results
   - Assert format: `- type: content` (no score)
   - Assert header: `Recent learnings (N/total)`

3. **T-22.3**: `formatRelevantLearnings` with zero learnings
   - Config with empty learned layer
   - Assert returns empty string

4. **T-22.4**: `formatCompactProposals` with proposals
   - Proposals with varying content lengths
   - Assert: 5-char ID, type badge, 40-char truncation, confidence
   - Assert footer: `Review: \`pai-seed proposals review\``

5. **T-22.5**: `formatCompactProposals` with zero proposals
   - Assert returns empty string

6. **T-22.6**: `formatCompactProposals` with long content
   - Proposal content > 100 chars
   - Assert truncates to 40 chars with ellipsis

7. **T-22.7**: `generateSessionContext` includes metadata
   - Call with config containing learnings/proposals
   - Assert `learningsShown`, `learningsTotal`, `tokenEstimate` fields populated

8. **T-22.8**: `generateSessionContext` handles empty seed
   - Config with zero learnings, zero proposals
   - Assert context still includes identity + state
   - Assert metadata fields reflect zeros

## Implementation Sequence

1. **Write tests** (red) — tests/session.test.ts
   - Mock `retrieveRelevantLearnings` import
   - Add test cases T-22.1 through T-22.8

2. **Implement `formatRelevantLearnings`** (green)
   - Dynamic import of `retrieveRelevantLearnings`
   - Format scored results vs recency fallback
   - Handle empty case

3. **Rewrite `formatCompactProposals`** (green)
   - Replace `formatProposals` body
   - 5-char ID via `.slice(0, 5)`
   - Truncate content to 40 chars
   - Show confidence with 2 decimal places

4. **Modify `generateSessionContext`** (green)
   - Replace `formatLearningSummary()` call with `formatRelevantLearnings()`
   - Replace `formatProposals()` call with `formatCompactProposals()`
   - Add metadata fields to return value
   - Estimate tokens (rough: chars / 4)

5. **Extend `SessionContext` type** (green)
   - Add optional fields: `tokenEstimate`, `learningsShown`, `learningsTotal`

6. **Verify all tests pass** (589+ existing + 8 new)

7. **Manual smoke test** — run `sessionStartHook()` with real seed, verify output format

## Files to Modify

- `src/session.ts` — core changes
- `tests/session.test.ts` — new test cases
- `.specify/specs/f-022-progressive-disclosure/tasks.md` — TDD task list

## Dependencies

- **F-025** `retrieveRelevantLearnings()` — already implemented ✅
- No other blockers

## Success Criteria

1. `formatRelevantLearnings` uses F-025 semantic retrieval
2. Recency fallback works (score=0 indicates fallback)
3. `formatCompactProposals` shows ID prefix, type, 40-char content, confidence
4. `SessionContext` includes token estimate and selection metadata
5. All 8 new tests pass
6. All 613 existing tests still pass
7. Manual verification: output is compact and relevant
