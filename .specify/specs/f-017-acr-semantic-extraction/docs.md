# Documentation Updates: F-017 — ACR Semantic Extraction

## Files Modified

### src/schema.ts
- Added optional `method` field to `proposalSchema`: `method: z.enum(["acr", "regex"]).optional()`
- Backward compatible — existing proposals without `method` still validate

### src/extraction.ts
- Added `AcrExtractionResult` and `AcrExtractionOptions` types
- Added `callAcrExtraction(transcript, options?)` — calls `acr --extract-learnings --json` via CLI
- Added `acrLearningsToProposals()` — internal helper converting ACR output to Proposal[]
- Modified `extractionHook()` — tries ACR first, falls back to regex on unavailability
- Confidence filtering via `PAI_EXTRACTION_CONFIDENCE` env var (default 0.7)

### src/index.ts
- Added F-017 export section with `AcrExtractionResult`, `AcrExtractionOptions`, `callAcrExtraction`

### tests/extraction.test.ts
- Added 23 new tests covering: method field validation, callAcrExtraction (7 tests), pipeline upgrade (6 tests), confidence filtering (4 tests)

## Behavior Changes

### extractionHook() Pipeline (FR-2)
Before: `detectLearningSignals()` → `extractProposals()` → `writeProposals()`
After:
1. Try `callAcrExtraction(transcript)`
2. If ACR ok → filter by confidence → convert to proposals with `method: "acr"`
3. If ACR fail → fall back to `extractProposals()` with `method: "regex"`
4. Key: ACR returning empty = valid (no fallback). Fallback ONLY on ACR unavailability.

### Environment Variables
- `PAI_EXTRACTION_CONFIDENCE` — confidence threshold for ACR extraction (default: 0.7)
