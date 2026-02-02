# F-022: Implementation Tasks

## TDD Task Breakdown

Each task follows Red → Green → Refactor cycle with ISC criterion.

---

### T-22.1: formatRelevantLearnings with semantic results

**ISC:** Function returns scored learnings in semantic format
**Test:** `formatRelevantLearnings returns semantic format with scores`
**Acceptance:**
- Mock `retrieveRelevantLearnings` to return 3 items with scores [0.89, 0.84, 0.76]
- Output includes header `Relevant learnings (3/15):`
- Each line formatted as `  [0.89] pattern: content`
- No "Recent learnings" header

**Implementation:**
- Create `formatRelevantLearnings` async function
- Dynamic import `retrieveRelevantLearnings` from embeddings
- Check if scores > 0 → semantic format
- Format with 2 decimal score prefix

---

### T-22.2: formatRelevantLearnings with recency fallback

**ISC:** Function returns unscored learnings in recency format
**Test:** `formatRelevantLearnings returns recency format when score is zero`
**Acceptance:**
- Mock `retrieveRelevantLearnings` to return 5 items with score=0
- Output includes header `Recent learnings (5/15):`
- Each line formatted as `  - pattern: content` (no score)

**Implementation:**
- Check first item's score
- If score === 0 → recency format (fallback mode)
- Format without score prefix

---

### T-22.3: formatRelevantLearnings with zero learnings

**ISC:** Function returns empty string when no learnings exist
**Test:** `formatRelevantLearnings returns empty string for zero learnings`
**Acceptance:**
- Config with `learned.patterns = []`, `learned.insights = []`, `learned.selfKnowledge = []`
- Output is empty string `""`

**Implementation:**
- Check total learnings count before calling `retrieveRelevantLearnings`
- Return `""` early if total === 0

---

### T-22.4: formatCompactProposals with proposals

**ISC:** Function returns compact index with ID, type, truncated content, confidence
**Test:** `formatCompactProposals returns compact index format`
**Acceptance:**
- 3 proposals with IDs "abc123456", "def789012", "ghi345678"
- Content: "Short", "Medium length content here", "Very long content that exceeds forty characters and needs truncation"
- Confidences: 0.82, 0.71, 0.95
- Output format:
  ```
  Pending proposals (3):
    abc12 pattern  "Short" (0.82)
    def78 insight  "Medium length content here" (0.71)
    ghi34 pattern  "Very long content that exceeds forty ..." (0.95)

  Review: `pai-seed proposals review`
  ```
- ID truncated to 5 chars
- Content truncated to 40 chars with "..." if longer
- Confidence shown with 2 decimals

**Implementation:**
- Rename `formatProposals` → `formatCompactProposals`
- Use `proposal.id.slice(0, 5)` for ID
- Use `content.slice(0, 40) + (content.length > 40 ? "..." : "")` for truncation
- Format confidence as `(${p.confidence?.toFixed(2) ?? "N/A"})`
- Footer line: `Review: \`pai-seed proposals review\``

---

### T-22.5: formatCompactProposals with zero proposals

**ISC:** Function returns empty string when no proposals exist
**Test:** `formatCompactProposals returns empty string for zero proposals`
**Acceptance:**
- Config with `state.proposals = []` or all proposals with status="rejected"
- Output is empty string `""`

**Implementation:**
- Filter pending proposals first
- Return `""` if pending.length === 0

---

### T-22.6: formatCompactProposals with undefined confidence

**ISC:** Function handles proposals without confidence gracefully
**Test:** `formatCompactProposals shows N/A for undefined confidence`
**Acceptance:**
- Proposal with `confidence: undefined`
- Output shows `(N/A)` instead of crashing

**Implementation:**
- Use `p.confidence?.toFixed(2) ?? "N/A"`

---

### T-22.7: generateSessionContext includes metadata

**ISC:** SessionContext return value includes learningsShown, learningsTotal, tokenEstimate
**Test:** `generateSessionContext populates metadata fields`
**Acceptance:**
- Config with 15 total learnings, 5 shown
- Return value includes:
  - `learningsShown: 5`
  - `learningsTotal: 15`
  - `tokenEstimate: number` (rough estimate: chars / 4)

**Implementation:**
- Extend `SessionContext` type with optional fields
- Track learnings shown/total from `retrieveRelevantLearnings` call
- Estimate tokens: `Math.ceil(context.length / 4)`
- Return metadata in success case

---

### T-22.8: generateSessionContext handles empty seed

**ISC:** Empty seed produces valid context with zero metadata
**Test:** `generateSessionContext works with zero learnings and proposals`
**Acceptance:**
- Config with zero learnings, zero proposals
- Context still includes identity + state sections
- Metadata: `learningsShown: 0`, `learningsTotal: 0`, `tokenEstimate > 0`

**Implementation:**
- Verify empty learning/proposal sections don't break join
- Metadata fields handle zero values

---

### T-22.9: Integration — full context format

**ISC:** Complete session context matches expected format
**Test:** `generateSessionContext produces progressive disclosure format`
**Acceptance:**
- Config with 15 learnings (embeddings available), 3 proposals
- Context includes:
  - `Relevant learnings (5/15):`
  - Scored learning items
  - `Pending proposals (3):`
  - Compact proposal index
- No old `Learnings: X patterns, Y insights, Z self-knowledge` line

**Implementation:**
- Replace `formatLearningSummary()` call with `await formatRelevantLearnings()`
- Replace `formatProposals()` call with `formatCompactProposals()`
- Verify sections join correctly

---

## Implementation Order

1. ✅ T-22.3 (zero learnings) — simplest, no mocking
2. ✅ T-22.5 (zero proposals) — simplest, no mocking
3. ✅ T-22.6 (undefined confidence) — edge case
4. ✅ T-22.4 (compact proposals) — core format
5. ✅ T-22.1 (semantic format) — requires mock
6. ✅ T-22.2 (recency fallback) — requires mock
7. ✅ T-22.7 (metadata) — integration
8. ✅ T-22.8 (empty seed) — integration
9. ✅ T-22.9 (full format) — integration

## Test Execution Plan

**Red phase:**
- Add all 9 test cases to `tests/session.test.ts`
- Mock `retrieveRelevantLearnings` using dynamic import spy
- Run `bun test tests/session.test.ts` — expect 9 failures

**Green phase:**
- Implement changes to `src/session.ts`
- Run tests incrementally as functions are added
- All 9 tests pass

**Refactor phase:**
- Clean up formatting logic
- Extract magic numbers (40 chars, 5 char ID) to constants
- Verify 613+ tests still pass

## Success Metrics

- [x] All 9 new tests pass
- [x] All 613 existing tests pass
- [x] No breaking changes to public API
- [x] Output verified manually with real seed
