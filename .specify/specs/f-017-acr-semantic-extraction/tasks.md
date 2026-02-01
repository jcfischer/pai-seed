# Implementation Tasks: F-017 — ACR Semantic Extraction

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☑ | Add method field to Proposal schema (4 tests) |
| T-1.2 | ☑ | Implement callAcrExtraction() (7 tests) |
| T-2.1 | ☑ | Upgrade extractionHook() pipeline (6 tests) |
| T-2.2 | ☑ | Add confidence threshold filtering (4 tests) |
| T-3.1 | ☑ | Exports and regression (531 tests, 0 fail) |
| T-3.2 | ☑ | End-to-end validation (covered by T-2.1 integration tests) |

## Group 1: Foundation

### T-1.1: Add method field to Proposal schema [T]
- **File:** `src/schema.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** none
- **Description:** Add optional `method` field to `proposalSchema`:
  ```typescript
  method: z.enum(["acr", "regex"]).optional(),
  ```
  - Backward compatible: existing proposals without `method` remain valid
  - Update `Proposal` type (auto-derived from schema)
  - Test: old proposals without method pass validation
  - Test: proposals with method: "acr" pass validation
  - Test: proposals with method: "regex" pass validation

### T-1.2: Implement callAcrExtraction() [T]
- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** none (parallel with T-1.1)
- **Description:** New function to call ACR's extraction CLI:
  ```typescript
  type AcrExtractionResult = {
    ok: true;
    learnings: Array<{
      type: "pattern" | "insight" | "self_knowledge";
      content: string;
      confidence: number;
    }>;
  } | {
    ok: false;
    error: string;
  };

  async function callAcrExtraction(
    transcript: string,
    options?: { acrBinary?: string; timeout?: number; confidence?: number }
  ): Promise<AcrExtractionResult>
  ```
  - Call: `echo "$transcript" | acr --extract-learnings --json --confidence $N`
  - Default binary: `acr` (from PATH) or `~/bin/acr`
  - Default timeout: 30000ms
  - Default confidence: `parseFloat(process.env.PAI_EXTRACTION_CONFIDENCE || "0.7")`
  - Parse JSON stdout, validate structure
  - On timeout → `{ ok: false, error: "ACR extraction timed out after 30s" }`
  - On binary not found → `{ ok: false, error: "ACR binary not found" }`
  - On non-zero exit → `{ ok: false, error: "ACR extraction failed: <stderr>" }`
  - On invalid JSON → `{ ok: false, error: "ACR returned invalid JSON" }`
  - Tests mock Bun.spawn/Bun.which (same pattern as ACR's seed-indexer tests)

## Group 2: Pipeline Upgrade

### T-2.1: Upgrade extractionHook() pipeline [T]
- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:** Modify `extractionHook()` to try ACR first, fall back to regex:
  ```
  1. Try: callAcrExtraction(transcript)
  2. If ok: convert learnings → Proposal[] (with method: "acr")
  3. If fail: fall back to detectLearningSignals(transcript) (with method: "regex")
  4. Key rule: ACR returns empty (ok: true, learnings: []) → NO fallback, this is valid
  5. Fall back ONLY on: ok: false (timeout, binary not found, non-zero exit)
  6. Deduplicate (existing logic)
  7. Write proposals (existing writeProposals)
  8. Log event with method metadata
  ```
  - New helper: `acrLearningsToProposals(learnings, sessionId)` — converts ACR output to Proposal[]
  - Event logging: add `method: "acr" | "regex"` to event data
  - Tests:
    - ACR success path: proposals have method "acr"
    - ACR failure → fallback: proposals have method "regex"
    - ACR returns empty (0 learnings) → no fallback, 0 proposals
    - ACR timeout → fallback to regex
    - ACR binary not found → fallback to regex

### T-2.2: Confidence threshold filtering [T]
- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** T-1.2
- **Description:** Apply confidence threshold before creating proposals:
  - Default: 0.7
  - Configurable: `PAI_EXTRACTION_CONFIDENCE` env var
  - Filter: `learnings.filter(l => l.confidence >= threshold)`
  - Log discarded count in event metadata: `discarded: N`
  - Tests:
    - 0.69 excluded, 0.70 included at default threshold
    - Custom threshold via env var
    - All filtered → empty result (valid, no fallback)

## Group 3: Integration

### T-3.1: Exports and regression [T]
- **File:** `src/index.ts`
- **Test:** `bun test`
- **Dependencies:** T-2.1, T-2.2
- **Description:** Add F-017 exports to `src/index.ts`:
  ```typescript
  // =============================================================================
  // F-017: ACR semantic extraction
  // =============================================================================

  // Types
  export type { AcrExtractionResult } from "./extraction";

  // Functions
  export { callAcrExtraction } from "./extraction";
  ```
  - Run full `bun test` — all tests must pass
  - No regressions in F-001 through F-016

### T-3.2: End-to-end validation [T]
- **File:** `tests/extraction.test.ts`
- **Dependencies:** T-3.1
- **Description:** Integration tests covering the full upgraded pipeline:
  - Mock ACR binary → extractionHook() → verify proposals written with method "acr"
  - Mock ACR unavailable → extractionHook() → verify fallback to regex with method "regex"
  - Mock ACR returns empty → extractionHook() → verify 0 proposals, no fallback
  - Verify event logging includes method field
  - Verify existing proposals without method field still load correctly
  - Performance: extractionHook() completes within 5 seconds

## Execution Order

```
Phase 1 (parallel):  T-1.1  T-1.2
                       │       │
Phase 2 (parallel):  T-2.1  T-2.2
                       │
Phase 3 (sequential): T-3.1 → T-3.2
```

## Spec Coverage Matrix

| Spec Requirement | Task(s) | Verification |
|------------------|---------|--------------|
| FR-1: ACR Extraction Interface | T-1.2 | callAcrExtraction() with CLI call |
| FR-2: Extraction Pipeline Upgrade | T-2.1 | extractionHook() tries ACR first |
| FR-3: Confidence-Based Filtering | T-2.2 | Threshold filtering at boundary |
| FR-4: Extraction Method Metadata | T-1.1 | method field on Proposal schema |
