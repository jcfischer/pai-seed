---
feature: "ACR integration"
feature_id: "F-012"
created: "2026-02-01"
---

# Technical Plan: ACR Integration

## Architecture Overview

Single module (`src/acr.ts`) containing ACR document types and export functions. No dependency on ACR codebase — pai-seed defines the document format that ACR can consume.

## Design Decisions

### D-1: Document Format Owned by pai-seed
**Choice**: Define `AcrDocument` schema in pai-seed, not imported from ACR.
**Rationale**: Avoids cross-project dependency. ACR adapter can validate/transform as needed.

### D-2: Pure Export Functions
**Choice**: Export functions are pure transformations on loaded data. No side effects.
**Rationale**: ACR calls these during its indexing pass. pai-seed doesn't need to know about embeddings.

### D-3: Freshness via Timestamp
**Choice**: Include `lastUpdated` ISO timestamp per document. ACR uses this for decay/ranking.
**Rationale**: Simple, no complex scoring needed in pai-seed. ACR's ranker handles weighting.

## File Changes

| File | Change |
|------|--------|
| `src/acr.ts` | NEW — ACR document types + export functions (~150 lines) |
| `src/index.ts` | MODIFY — add F-012 exports |
| `tests/acr.test.ts` | NEW — export tests |
