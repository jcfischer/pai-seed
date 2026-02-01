---
id: "F-017"
feature: "ACR semantic extraction"
status: "draft"
created: "2026-02-01"
---

# Specification: ACR Semantic Extraction

## Context

> Generated from SpecFlow on 2026-02-01
> Builds on: F-006 (post-session extraction hook), F-012 (ACR integration)
> Integrates with: ACR F-009 (seed indexing) — the ACR-side counterpart
> Replaces: F-006 regex-based signal detection (kept as fallback)

## Problem Statement

**Core Problem**: F-006's regex extraction uses 20 hardcoded signal phrases to detect learnings from session transcripts. This produces noisy, low-quality proposals — raw JSON fragments, partial sentences, and false positives that accumulate without review (38 pending proposals currently, most noise).

**Impact if Unsolved**: The learning loop is broken. Proposals are too noisy to review, so they accumulate indefinitely. The user loses trust in the system's ability to learn.

**Root Cause**: Pattern matching cannot distinguish meaningful learnings from text that happens to contain signal phrases. ACR already has semantic understanding of session content via embeddings — it should power extraction.

## Overview

Replace the regex signal detection in the extraction pipeline with a call to ACR's semantic extraction endpoint (`acr --extract-learnings`). ACR analyzes the session transcript using its embedding model and returns structured learning candidates. Pai-seed converts these to proposals using the existing F-006 pipeline (deduplication, writing, git commit). Regex extraction is kept as fallback when ACR is unavailable.

## Functional Requirements

### FR-1: ACR Extraction Interface

Define the contract for calling ACR's extraction endpoint:

```typescript
type AcrExtractionResult = {
  ok: true;
  learnings: Array<{
    type: "pattern" | "insight" | "self_knowledge";
    content: string;
    confidence: number; // 0.0-1.0
  }>;
} | {
  ok: false;
  error: string;
};
```

Call via CLI: `acr --extract-learnings --json < transcript.txt`

- Pipe session transcript to stdin
- Parse JSON response from stdout
- Timeout: 30 seconds (embedding inference can be slow)
- Filter results by confidence threshold (default: 0.7, configurable)

**Validation:** Unit test with mocked CLI output. Integration test with actual ACR binary.

### FR-2: Extraction Pipeline Upgrade

Modify `extractionHook()` to try ACR first, fall back to regex:

```
extractionHook(transcript, sessionId, seedPath)
  1. Try: callAcrExtraction(transcript)
  2. If ok: convert AcrExtractionResult.learnings → Proposal[]
  3. If fail: fall back to existing detectLearningSignals(transcript)
  4. Deduplicate (existing logic)
  5. Write proposals (existing writeProposals)
```

- Log which extraction method was used (event type: `learning_extracted`, metadata includes `method: "acr" | "regex"`)
- When ACR extraction produces 0 results, do NOT fall back — ACR saying "nothing learned" is valid
- Fall back to regex ONLY on ACR unavailability (timeout, binary not found, non-zero exit)

**Validation:** Unit test: ACR success path, ACR failure → fallback path, ACR returns empty (no fallback).

### FR-3: Confidence-Based Filtering

Apply confidence threshold before creating proposals:

- Default threshold: 0.7
- Configurable via environment variable: `PAI_EXTRACTION_CONFIDENCE=0.5`
- Learnings below threshold are discarded (not stored as low-confidence proposals)
- Log discarded count in extraction event metadata

**Validation:** Unit test: threshold filtering at boundary values (0.69 excluded, 0.70 included).

### FR-4: Extraction Method Metadata

Add `method` field to Proposal schema:

```typescript
type Proposal = {
  // existing fields...
  method?: "acr" | "regex"; // undefined for pre-F-017 proposals
};
```

- Backward compatible: existing proposals without `method` remain valid
- Used for quality tracking: compare acceptance rates by method over time

**Validation:** Schema migration test: old proposals without `method` pass validation.

## Non-Functional Requirements

- ACR extraction call completes < 30 seconds for typical session (50KB transcript)
- Fallback to regex adds < 10ms overhead (same as current F-006 performance)
- No hard dependency on ACR — system works without it installed
- Extraction event logs include method used for quality tracking

## Out of Scope

- ACR-side implementation (see ACR F-009)
- Changing the proposal confirmation flow (F-007)
- Retraining or fine-tuning the embedding model
- Real-time extraction during session (batch only, post-session)

## Assumptions

| Assumption | Invalidation Trigger | Detection |
|------------|---------------------|-----------|
| ACR binary available at `~/bin/acr` | Binary not found | Checked at extraction time, logged |
| Ollama running for embeddings | Connection refused | ACR returns error, fallback triggers |
| 30s timeout sufficient | Timeout on large transcripts | Event log shows timeout errors |
| 0.7 confidence threshold appropriate | High false-positive or false-negative rate | Compare acceptance rates: ACR vs regex proposals |
