# Implementation Tasks: F-019 Extraction Quality

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☑ | stripStructuredContent pure function |
| T-1.2 | ☑ | stripStructuredContent tests (7 tests) |
| T-2.1 | ☑ | Kill regex fallback on ACR success |
| T-2.2 | ☑ | Pre-filter transcript in extractionHook |
| T-2.3 | ☑ | Update existing tests for new fallback behavior |
| T-3.1 | ☑ | truncateContent helper |
| T-3.2 | ☑ | Apply truncation in extractProposals + acrLearningsToProposals |
| T-3.3 | ☑ | Truncation tests (5 tests) |
| T-4.1 | ☑ | Cap formatProposals to 5 + recency sort |
| T-4.2 | ☑ | Update existing formatProposals tests + add cap tests (7 tests) |
| T-5.1 | ☑ | Full test suite regression: 569 pass, 0 fail, 1376 expect() |

---

## Group 1: Pre-filter Function [P]

### T-1.1: Create `stripStructuredContent()` [T]
- **File:** `src/extraction.ts` (insert before `extractionHook` at line ~273)
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** none
- **Description:** New exported pure function that strips structured data regions from transcript text:
  - Fenced code blocks (`` ``` ... ``` ``) → replace with ` [...] `
  - Line-number prefixed lines (`^\s*\d+[→│|]`) → remove
  - Tool use XML blocks (`<invoke>`, `<tool_result>`, `<function_results>`) → replace with ` [...] `
  - Multi-line JSON objects >200 chars → replace with ` [...] `
  - Collapse 3+ consecutive newlines to 2
- **Acceptance:** Function exported, handles all 4 content types, preserves prose around stripped regions

### T-1.2: Tests for `stripStructuredContent()` [T]
- **File:** `tests/extraction.test.ts` (new `describe("stripStructuredContent")` block)
- **Dependencies:** T-1.1
- **Description:** Test cases:
  1. Strips fenced code blocks, preserves surrounding prose
  2. Strips line-numbered content (e.g., `  123→ const x = 1`)
  3. Strips tool use XML blocks
  4. Strips large JSON objects (>200 chars), preserves small JSON (`{"ok": true}`)
  5. Returns original text when no structured content present
  6. Preserves signal phrases in prose around stripped code blocks
  7. Collapses 3+ newlines to 2

---

## Group 2: Kill Regex Fallback

### T-2.1: Remove regex fallback on ACR success
- **File:** `src/extraction.ts` lines 310-315
- **Dependencies:** none (logic change independent of T-1.1)
- **Description:** In `extractionHook()`, change the `else` branch at line 310 from calling `extractProposals()` to returning empty array:
  ```
  // BEFORE (line 310-315):
  } else {
    proposals = extractProposals(transcript, sessionId);
    for (const p of proposals) { p.method = "regex"; }
  }

  // AFTER:
  } else {
    // ACR succeeded but found nothing above threshold — accept silence
    proposals = [];
  }
  ```
- **Also update:** JSDoc comment at lines 280-285 (already says "no regex fallback" — verify accuracy)

### T-2.2: Pre-filter transcript in `extractionHook()` [P with T-2.1]
- **File:** `src/extraction.ts` lines 292-322
- **Dependencies:** T-1.1
- **Description:** Apply `stripStructuredContent()` as pre-processing:
  1. At line ~293 (top of try block), add: `const cleaned = stripStructuredContent(transcript);`
  2. Line 296: change `callAcrExtraction(transcript)` → `callAcrExtraction(cleaned)`
  3. Line 319 (ACR-failure branch): change `extractProposals(transcript, sessionId)` → `extractProposals(cleaned, sessionId)`

### T-2.3: Update existing ACR fallback tests [T]
- **File:** `tests/extraction.test.ts`
- **Dependencies:** T-2.1
- **Description:** Update tests that assert regex fallback fires when ACR returns empty filtered results:
  - **Line 998:** Test `"all learnings filtered below threshold: falls back to regex"` — rename to `"all learnings filtered below threshold: accepts silence"` and change assertion from `expect(result.total).toBeGreaterThanOrEqual(1)` to `expect(result.added).toBe(0)`
  - Verify all other `extractionHook` tests still pass with the new behavior

---

## Group 3: Content Truncation [P with Group 2]

### T-3.1: Create `truncateContent()` helper
- **File:** `src/extraction.ts` (insert near top, after imports)
- **Dependencies:** none
- **Description:** New function:
  ```typescript
  const MAX_PROPOSAL_CONTENT_LENGTH = 200;
  function truncateContent(content: string): string {
    if (content.length <= MAX_PROPOSAL_CONTENT_LENGTH) return content;
    return content.slice(0, MAX_PROPOSAL_CONTENT_LENGTH) + "...";
  }
  ```
  Export the constant for test access.

### T-3.2: Apply truncation in proposal creation
- **File:** `src/extraction.ts`
- **Dependencies:** T-3.1
- **Description:** Apply `truncateContent()` in two locations:
  1. `extractProposals()` line 165: `content: truncateContent(signal.content),`
  2. `acrLearningsToProposals()` line 265: `content: truncateContent(l.content),`

### T-3.3: Truncation tests [T]
- **File:** `tests/extraction.test.ts` (new `describe("truncateContent")` block)
- **Dependencies:** T-3.1, T-3.2
- **Description:** Test cases:
  1. Content at exactly 200 chars → unchanged
  2. Content at 201 chars → truncated to 200 + `"..."`  (203 total)
  3. Content at 50 chars → unchanged
  4. Content at 500 chars → truncated to 203 total
  5. Integration: `extractProposals()` with long signal content → proposal.content ≤ 203

---

## Group 4: Cap Proposal Surfacing [P with Groups 2 & 3]

### T-4.1: Cap `formatProposals()` to 5 with recency sort
- **File:** `src/session.ts` lines 110-125
- **Dependencies:** none
- **Description:** Modify `formatProposals()`:
  1. Add `MAX_SURFACED_PROPOSALS = 5` constant
  2. Sort pending proposals by `extractedAt` descending (most recent first)
  3. Slice to top 5
  4. If remaining > 0, append footer: `"... and N more pending. Run \`pai-seed proposals review\` to manage."`
  5. Header still shows total count: `"Pending proposals (48):"`

### T-4.2: Update + add `formatProposals` tests [T]
- **File:** `tests/session.test.ts` (in existing `describe("formatProposals")` block, line 221)
- **Dependencies:** T-4.1
- **Description:**
  - **Update existing tests:** Line 222-234 tests with 2 proposals should still pass (under cap)
  - **New test cases:**
    1. 3 proposals → all 3 shown, no footer
    2. 5 proposals → all 5 shown, no footer
    3. 6 proposals → 5 shown + `"... and 1 more pending"`
    4. 48 proposals → 5 shown + `"... and 43 more pending"` + contains `pai-seed proposals review`
    5. Proposals sorted by recency (most recent extractedAt shown first)
    6. Header shows total count (`Pending proposals (48):`)

---

## Group 5: Verification

### T-5.1: Full regression test suite
- **Test:** `bun test` (all files)
- **Dependencies:** T-1.2, T-2.3, T-3.3, T-4.2
- **Description:** Run full test suite. All 550+ existing tests must pass alongside new tests. Verify:
  - No proposal content in test output exceeds 200 chars (spot check)
  - Regex fallback behavior updated correctly
  - `formatProposals` cap working

---

## Execution Order

```
            T-1.1 (stripStructuredContent)
              │
         ┌────┴────┐
         │         │
       T-1.2    T-2.2 (pre-filter in hook)
      (tests)      │
                   │
  T-2.1 ──────────┤   T-3.1 (truncateContent)    T-4.1 (cap formatProposals)
  (kill fallback)  │     │                          │
         │         │   T-3.2 (apply truncation)   T-4.2 (cap tests)
       T-2.3       │     │                          │
     (update tests)│   T-3.3 (truncation tests)     │
                   │     │                          │
                   └─────┴──────────────────────────┘
                                   │
                                 T-5.1 (full regression)
```

**Parallel opportunities:**
- T-1.1, T-2.1, T-3.1, T-4.1 can all start simultaneously (no deps between them)
- T-1.2, T-2.3, T-3.3, T-4.2 (tests) can run once their implementation task completes
- T-2.2 waits for T-1.1 only
- T-5.1 waits for everything

**Recommended execution batches:**
1. **Batch 1:** T-1.1 + T-2.1 + T-3.1 + T-4.1 (all foundation, no deps)
2. **Batch 2:** T-1.2 + T-2.2 + T-2.3 + T-3.2 + T-3.3 + T-4.2 (all depend on batch 1)
3. **Batch 3:** T-5.1 (full regression)
