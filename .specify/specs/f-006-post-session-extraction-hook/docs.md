# Documentation Updates: F-006 Post-Session Extraction Hook

**Feature:** F-006
**Date:** 2026-02-01

## What Was Created

### New Source Files

| File | Purpose |
|------|---------|
| `src/extraction.ts` | `detectLearningSignals()`, `extractProposals()`, `writeProposals()`, `extractionHook()` |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/extraction.test.ts` | 33 | Signal detection, proposal generation, git-backed write, hook orchestration, deduplication, performance |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added F-006 type and function exports |

## Public API Additions

Exported from `src/index.ts` (appended to F-001 through F-005 exports):

### Types
- `SignalType` -- `"pattern" | "insight" | "self_knowledge"`
- `LearningSignal` -- `{ type: SignalType; content: string; matchedPhrase: string }`
- `WriteProposalsResult` -- Discriminated union: `{ ok: true; added; skipped }` or `{ ok: false; error }`
- `ExtractionResult` -- Discriminated union: `{ ok: true; added; total }` or `{ ok: false; error }`

### Functions
- `detectLearningSignals(text: string): LearningSignal[]` -- Pure: detect learning signal phrases in text
- `extractProposals(transcript: string, sessionId?: string): Proposal[]` -- Pure: convert signals to Proposal objects with deduplication
- `writeProposals(proposals: Proposal[], seedPath?: string): Promise<WriteProposalsResult>` -- I/O: append proposals to seed.json via git
- `extractionHook(transcript: string, sessionId?: string, seedPath?: string): Promise<ExtractionResult>` -- I/O: orchestrate extract + write, never throws

## Design Decisions

### Rule-Based Extraction
- Uses a fixed set of 20 signal phrases (7 pattern, 7 insight, 6 self_knowledge)
- Case-insensitive matching with word boundary enforcement
- Deterministic, testable, fast (< 100ms for 100KB transcripts)
- No LLM dependency for v1

### Sentence Splitting
- Splits on `. `, `.\n`, `! `, `? `, `\n` (not bare `.`)
- Preserves URLs and abbreviations that contain dots
- Single-pass algorithm over the text

### Deduplication
- Two levels: within a single extraction (extractProposals) and against existing proposals (writeProposals)
- Case-insensitive content comparison
- First occurrence wins

## No External Documentation Changes

F-006 is a library layer for extraction. No README or user-facing documentation needed. CLI documentation will come with F-011.
