---
id: "F-027"
feature: "Extraction pipeline fix"
status: "draft"
created: "2026-02-02"
depends_on: ["F-006", "F-017", "F-019"]
---

# Specification: Extraction Pipeline Fix

## Context

> Generated from diagnosis session on 2026-02-02
> Builds on: F-006 (extraction hook), F-017 (ACR semantic extraction), F-019 (extraction quality)
> Fixes: Critical JSONL parsing gap that caused zero extraction from all sessions

## Problem Statement

**Core Problem**: The extraction pipeline receives raw JSONL transcript bytes from `SeedExtraction.hook.ts` and treats them as natural language. Claude Code stores session transcripts as JSONL files where each line is a JSON object (`{"type":"assistant","message":{"content":[...]}}`). After `stripStructuredContent()` removes JSON-looking content, 0% natural language remains — so nothing is ever extracted.

**Secondary Problems**:
1. When JSONL is correctly parsed, the resulting conversation text (229K chars from an 11MB JSONL) exceeds what ACR can process in one shot, forcing regex-only fallback
2. Regex fallback picks up algorithm format artifacts ("Key insight from council**:", "For next time:**") as false positives
3. Empty or near-empty proposals are created (e.g., "Key Insight:**" with no actual content)

**Impact**: The learning loop has been completely broken since JSONL transcripts were introduced. Zero learnings extracted from any session. The "subconscious proposes, conscious decides" pattern cannot function without proposals.

**Evidence**: `pai-seed show` returns 0 entries after rich sessions. Manual test with `parseJsonlTranscript()` fix: 11MB JSONL -> 229KB conversation text -> 6 proposals extracted (vs 0 before). ACR on 10K sample found 19 signals at confidence >= 0.5.

## Overview

Four changes to restore and improve the extraction pipeline:

1. **JSONL parsing utility** in pai-seed (not just the hook) so any consumer can extract conversation text from JSONL transcripts
2. **Transcript size management** to keep input within ACR's effective range
3. **Regex noise filtering** to reject algorithm format artifacts
4. **Empty proposal prevention** to block garbage proposals at creation time

## User Scenarios

### S1: Session ends with JSONL transcript

- Hook reads JSONL transcript file
- Calls `parseJsonlTranscript()` to extract conversation text
- Passes parsed text (not raw JSONL) to `extractionHook()`
- ACR or regex produces meaningful proposals

### S2: Long session produces large transcript

- Parsed transcript is 229K chars
- System truncates to last 50K chars before ACR
- ACR processes manageable input, returns learnings with confidence scores
- Regex fallback (if needed) also operates on truncated text

### S3: Algorithm format text in transcript

- Transcript contains "Key insight from council**:" and "For next time:**"
- Regex matches these phrases but noise filter rejects them
- Only clean natural language matches produce proposals

### S4: Near-empty extraction result

- Regex produces a proposal with content "Key Insight:**"
- Minimum content length check (20 chars after cleaning) rejects it
- No garbage proposal is written to seed.json

## Functional Requirements

### FR-1: JSONL Transcript Parsing

Provide `parseJsonlTranscript(raw: string): string` in `src/extraction.ts` that:

```typescript
/**
 * Parse a Claude Code JSONL transcript into natural language text.
 * Extracts user and assistant message content, skipping tool calls,
 * progress events, file snapshots, and other metadata.
 */
export function parseJsonlTranscript(raw: string): string;
```

Parsing rules:
1. Split input by newlines, parse each line as JSON
2. Filter for entries with `type === "user"` or `type === "assistant"`
3. Extract text from `message.content`:
   - If `content` is a string: use directly
   - If `content` is an array: extract blocks where `block.type === "text"` and use `block.text`
   - Skip `tool_use`, `tool_result`, and other block types
4. Join extracted text parts with `\n\n`
5. Skip malformed lines silently (no throw)

**Validation:** Unit test: valid JSONL with mixed types, string content, array content, malformed lines, empty input.

### FR-2: Transcript Size Management

Add transcript truncation before extraction in `extractionHook()`:

```typescript
const MAX_EXTRACTION_CHARS = 50_000; // ~12.5K tokens

function truncateForExtraction(text: string, maxChars?: number): string;
```

Truncation rules:
1. Default limit: 50,000 characters (configurable via `PAI_EXTRACTION_MAX_CHARS` env var)
2. When text exceeds limit, take the **last** N characters (recency bias — recent conversation is more relevant than early greetings)
3. Find the first `\n\n` boundary after the cut point to avoid splitting mid-sentence
4. Log truncation to stderr: `[pai-seed] Truncated transcript from {original} to {truncated} chars`

**Rationale**: ACR's embedding model processes text in chunks. 50K chars (~12.5K tokens) keeps the input within effective range while capturing the most relevant recent conversation. The last portion of a session typically contains conclusions, decisions, and explicit learning statements.

**Validation:** Unit test: no truncation when under limit, truncation from start, paragraph boundary alignment, env var override.

### FR-3: Regex Noise Filtering

Add a blocklist check to `detectLearningSignals()` that rejects matches containing algorithm format artifacts:

```typescript
const NOISE_PATTERNS: RegExp[] = [
  /\*\*[^*]+\*\*:/,           // "**Bold label**:" markdown emphasis
  /[━═─]{3,}/,                // Box-drawing characters (algorithm headers)
  /^\s*[│┃|]\s/,              // Table/border prefixes
  /^\s*\d+\.\s*\[/,           // Numbered list with brackets "[type]"
  /^(?:Phase|OBSERVE|THINK|PLAN|BUILD|EXECUTE|VERIFY|LEARN)\b/i,  // Algorithm phase names
];
```

For each regex match candidate:
1. Check if the sentence matches any NOISE_PATTERN
2. If it matches, skip the signal (do not include in results)
3. Log skipped count at debug level

**Validation:** Unit test: clean sentences pass, algorithm format sentences blocked, edge cases (bold in normal text).

### FR-4: Empty Proposal Prevention

Strengthen content validation in `extractProposals()` and `acrLearningsToProposals()`:

```typescript
const MIN_PROPOSAL_CONTENT_LENGTH = 20;

function isValidProposalContent(content: string): boolean;
```

Validation rules:
1. Content must be >= 20 characters after trimming
2. Content must contain at least 3 word characters (`\w`) — rejects pure punctuation/formatting
3. Content must not be entirely markdown formatting (check: after stripping `*`, `_`, `#`, `-`, the remaining text must be >= 10 chars)

Apply this check:
- In `extractProposals()` before creating a Proposal
- In `acrLearningsToProposals()` before creating a Proposal

**Validation:** Unit test: valid content passes, short content rejected, pure formatting rejected, markdown-heavy content with substance passes.

### FR-5: Hook Update

Update `SeedExtraction.hook.ts` to use pai-seed's `parseJsonlTranscript()` instead of its own copy:

```typescript
import { extractionHook, logEvent, parseJsonlTranscript } from '/Users/fischer/work/pai-seed/src/index.ts';
```

The hook's current inline `parseJsonlTranscript()` becomes redundant once FR-1 is implemented. The hook should import from pai-seed to maintain single-source-of-truth.

**Validation:** Manual test: hook runs on session end, extracts proposals from JSONL transcript.

## Non-Functional Requirements

- **Performance:** `parseJsonlTranscript()` completes in < 500ms for 11MB JSONL files
- **Performance:** `truncateForExtraction()` completes in < 10ms regardless of input size
- **Backward compatibility:** Existing proposals and seed.json format unchanged
- **No new dependencies:** Uses only built-in string operations
- **Deterministic:** Same input always produces same output (except generated IDs)
- **Testability:** All new functions are pure (except hook update). Tests use inline strings, no fixture files needed.

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| parseJsonlTranscript | JSONL -> conversation text parser | New in F-027 |
| truncateForExtraction | Recency-biased transcript truncation | New in F-027 |
| NOISE_PATTERNS | Blocklist regexes for algorithm artifacts | New in F-027 |
| isValidProposalContent | Content quality gate | New in F-027 |
| MIN_PROPOSAL_CONTENT_LENGTH | Minimum content threshold (20 chars) | New in F-027 |
| MAX_EXTRACTION_CHARS | Truncation limit (50K chars) | New in F-027 |

## Success Criteria

- [ ] `parseJsonlTranscript()` extracts conversation text from JSONL format
- [ ] Raw JSONL is never passed directly to `extractionHook()` or `stripStructuredContent()`
- [ ] Transcripts > 50K chars are truncated to last 50K with paragraph boundary alignment
- [ ] Algorithm format artifacts in regex matches are filtered out
- [ ] Proposals with content < 20 chars or pure formatting are rejected
- [ ] Hook imports `parseJsonlTranscript` from pai-seed (single source of truth)
- [ ] All existing tests pass (622+)
- [ ] New tests cover all five functional requirements
- [ ] Manual test: session end produces meaningful proposals from JSONL transcript

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| JSONL format is stable across Claude Code versions | Format changes | parseJsonlTranscript returns empty/short text |
| 50K chars is sufficient for ACR quality | ACR needs more context | Compare extraction quality at different truncation points |
| Last-N-chars recency bias is appropriate | Important learnings happen early in session | Review missed learnings from long sessions |
| Noise patterns are comprehensive | New algorithm format artifacts appear | Monitor garbage proposal rate after fix |
| 20 char minimum is appropriate | Valid short learnings exist | User feedback on rejected proposals |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-006 | `extractProposals()`, `detectLearningSignals()`, `writeProposals()` | Signal detection and proposal writing |
| F-017 | `callAcrExtraction()`, `acrLearningsToProposals()` | ACR integration path |
| F-019 | `stripStructuredContent()`, `MAX_PROPOSAL_CONTENT_LENGTH` | Pre-filtering and truncation |
| Claude Code | JSONL transcript format | `parseJsonlTranscript()` parsing logic |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|------|
| SeedExtraction.hook.ts | `parseJsonlTranscript()`, `extractionHook()` | SessionEnd hook calls these |
| F-005 session start | Reads proposals written by extraction | Progressive disclosure |

## Out of Scope

- Changing ACR binary or embedding model (separate project)
- Transcript chunking for parallel ACR processing (future optimization)
- LLM-based extraction (would require API calls in hook)
- Changing JSONL format (Claude Code owned)
- Proposal review/confirmation UX (F-007, F-018)
