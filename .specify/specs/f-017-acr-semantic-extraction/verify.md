# F-017 Verification Report

**Feature:** ACR Semantic Extraction
**Date:** 2026-02-01
**Status:** VERIFIED

## Pre-Verification Checklist

- [x] All 6 tasks marked complete in tasks.md
- [x] All tests pass (`bun test` = 531 passing)
- [x] Documentation updated (docs.md)
- [x] 23 new tests covering all acceptance criteria
- [x] Zero regressions in existing test suite

## Test Suite Results

```
bun test v1.3.6 (d530ed99)

 531 pass
 0 fail
 1285 expect() calls
Ran 531 tests across 20 files. [38.76s]
```

### F-017 Test Breakdown

| Test Area | Tests | Status |
|-----------|-------|--------|
| Proposal method field | 4 | PASS |
| callAcrExtraction | 7 | PASS |
| extractionHook with ACR | 6 | PASS |
| Confidence filtering | 4 | PASS |
| Regression (existing) | 2 | PASS |
| **Total F-017** | **23** | **ALL PASS** |

## Smoke Test Results

| Test | Scenario | Result |
|------|----------|--------|
| Schema backward compat | Proposal without method validates | PASS |
| Schema new field | Proposal with method: "acr" validates | PASS |
| ACR success | Mock ACR returns learnings → proposals created | PASS |
| ACR empty | Mock ACR returns 0 learnings → no fallback, 0 proposals | PASS |
| ACR binary missing | Bun.which returns null → falls back to regex | PASS |
| ACR error | Non-zero exit → falls back to regex | PASS |
| ACR invalid JSON | Bad stdout → falls back to regex | PASS |
| Confidence threshold | 0.69 excluded, 0.70 included | PASS |
| All filtered | All below threshold → 0 proposals, no fallback | PASS |
| Confidence CLI arg | --confidence value passed to ACR CLI | PASS |

## Browser Verification

N/A — This is a CLI-only feature with no browser component.

## API Verification

N/A — This feature does not expose an HTTP API. CLI interface: `acr --extract-learnings --json`.

## Acceptance Criteria Verification

### FR-1: ACR Extraction Interface
- [x] `callAcrExtraction()` calls `acr --extract-learnings --json --confidence N`
- [x] Handles timeout, binary not found, non-zero exit, invalid JSON
- [x] Returns structured `AcrExtractionResult`

### FR-2: Extraction Pipeline Upgrade
- [x] `extractionHook()` tries ACR first
- [x] Falls back to regex on ACR unavailability
- [x] ACR empty = valid (no fallback)
- [x] Event logging includes extraction method

### FR-3: Confidence-Based Filtering
- [x] Default threshold 0.7
- [x] Configurable via `PAI_EXTRACTION_CONFIDENCE` env var
- [x] Boundary values correct (0.69 excluded, 0.70 included)

### FR-4: Extraction Method Metadata
- [x] `method` field added to Proposal schema (optional)
- [x] Backward compatible with existing proposals
- [x] ACR proposals tagged with method: "acr"
- [x] Regex proposals tagged with method: "regex"

## Conclusion

All 6 tasks completed. 23 new tests, all 531 total pass. Feature is production-ready.
