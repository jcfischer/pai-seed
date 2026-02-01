# Technical Plan: F-017 — ACR Semantic Extraction

## Architecture Decision

Replace the regex-based `detectLearningSignals()` in `extractionHook()` with a call to ACR's `--extract-learnings` CLI endpoint. Keep regex as fallback when ACR is unavailable.

### Integration Boundary

pai-seed calls ACR via CLI (no code dependency):
```
echo "$transcript" | acr --extract-learnings --json --confidence 0.7
```

This matches the CLI-based integration pattern established in F-012.

## Implementation Approach

### Minimal Change Strategy

The existing extraction pipeline (`extractionHook()`) has a clean 4-step flow:
1. Detect signals → `detectLearningSignals(transcript)`
2. Create proposals → `extractProposals(signals, sessionId)`
3. Write proposals → `writeProposals(proposals, seedPath)`
4. Log event → `logEvent("learning_extracted", ...)`

F-017 inserts a new step before step 1:
1. **NEW: Try ACR** → `callAcrExtraction(transcript, options)`
2. If ACR succeeds → convert `AcrExtractionResult.learnings` to `Proposal[]`
3. If ACR fails → fall back to `detectLearningSignals()` (existing)
4. Write proposals (existing)
5. Log event with `method: "acr" | "regex"` (existing + metadata)

### Key Design Decisions

1. **ACR returns empty = valid response** — Do NOT fall back to regex. ACR saying "nothing learned" means the transcript genuinely had no learnings.
2. **Fall back to regex ONLY on ACR unavailability** — timeout, binary not found, non-zero exit, JSON parse error.
3. **Confidence threshold** — Default 0.7, configurable via `PAI_EXTRACTION_CONFIDENCE` env var.
4. **Proposal method field** — Optional `method?: "acr" | "regex"` on Proposal schema. Backward-compatible with existing proposals.

## Files to Modify

| File | Change |
|------|--------|
| `src/extraction.ts` | Add `callAcrExtraction()`, modify `extractionHook()` |
| `src/schema.ts` | Add optional `method` field to `proposalSchema` |
| `src/index.ts` | Export new types |
| `tests/extraction.test.ts` | New test cases for ACR path + fallback |

## Files to Create

None — all changes are modifications to existing files.

## Risk Assessment

- **Low risk**: The existing regex path is preserved as fallback
- **Low risk**: `method` field is optional, backward-compatible
- **Medium risk**: ACR binary availability — mitigated by graceful fallback
