# F-019: Extraction Quality

## Problem

The learning extraction pipeline produces ~90% garbage proposals. Raw JSON, bash scripts, API responses, and conversation fragments end up as "learnings." This wastes context window at session start and erodes trust in the proposal system.

Root causes:
1. Regex fallback matches signal phrases inside code blocks, JSON, and quoted content
2. When ACR returns nothing above 0.7 confidence, regex fires and produces garbage
3. All proposals (currently 48) dump into the session-start system-reminder with no cap
4. No content length limit — proposals can contain 200+ lines of bash

## Solution

Three changes to the extraction pipeline:

### 1. Kill regex fallback when ACR succeeds

When ACR returns `ok: true` but no learnings pass the confidence threshold, accept silence. Do not fall back to regex. Regex fallback only fires when ACR itself fails (`ok: false` — binary not found, timeout, error).

**Current behavior (line 310-315 of extraction.ts):**
```typescript
if (filtered.length > 0) {
  proposals = acrLearningsToProposals(filtered, sessionId);
} else {
  // Falls back to regex — THIS PRODUCES GARBAGE
  proposals = extractProposals(transcript, sessionId);
}
```

**New behavior:**
```typescript
if (filtered.length > 0) {
  proposals = acrLearningsToProposals(filtered, sessionId);
} else {
  // ACR found nothing above threshold — accept silence
  proposals = [];
}
```

### 2. Pre-filter transcript before any extraction

Before passing transcript to ACR or regex, strip structured data regions while preserving surrounding prose for context:

- Fenced code blocks (``` ... ```)
- Inline JSON objects (`{...}` spanning multiple lines)
- Tool use blocks and their outputs
- Lines starting with line numbers (e.g., `   123→`)

This is applied as a pre-processing step to the transcript before it reaches ACR or regex.

### 3. Cap proposals surfaced at session start

In `formatProposals()` (session.ts), limit to top 5 proposals by recency. Show count of remaining.

**Current:** All 48 proposals formatted into system-reminder.
**New:** Top 5 + "... and 43 more. Run `pai-seed proposals review` to manage."

### 4. Content length cap

Proposals with content exceeding 200 characters are truncated at extraction time. Learnings should be concise statements, not paragraphs.

## User Scenarios

### S1: Session ends with ACR finding nothing above threshold
- ACR runs, returns 3 learnings all at confidence 0.4
- System accepts silence — 0 proposals created
- No regex fallback fires

### S2: Session ends with ACR unavailable
- ACR binary not found or times out
- Regex fires on pre-filtered transcript (code blocks stripped)
- Only clean prose matches produce proposals

### S3: Session start with many pending proposals
- 48 proposals pending
- System-reminder shows top 5 by recency
- Footer: "... and 43 more pending. Run `pai-seed proposals review`."

### S4: Extraction produces long content
- ACR returns a learning with 500-char content
- System truncates to 200 chars at proposal creation time

## Functional Requirements

### FR-1: Remove regex fallback when ACR succeeds
- **When:** ACR returns `ok: true` with 0 learnings above threshold
- **Then:** Return 0 proposals (no regex fallback)
- **Files:** `src/extraction.ts` lines 310-315

### FR-2: Pre-filter transcript
- **When:** Transcript is passed to extraction
- **Then:** Strip fenced code blocks, multi-line JSON, tool outputs, line-number prefixes
- **Preserve:** Surrounding prose for ACR context
- **Files:** `src/extraction.ts` (new function `stripStructuredContent()`)

### FR-3: Cap session-start surfacing
- **When:** Formatting proposals for session context
- **Then:** Show top 5 by recency, mention remaining count
- **Files:** `src/session.ts` `formatProposals()`

### FR-4: Content length cap
- **When:** Creating a proposal (ACR or regex)
- **Then:** Truncate content to 200 chars with "..." suffix
- **Files:** `src/extraction.ts` in `writeProposals()` and `acrLearningsToProposals()`

## Out of Scope

- User-initiated capture (F-020)
- Acceptance rate monitoring (F-021)
- Trust tiers / auto-accept (F-021)
- ACR binary improvements (separate project)

## Success Criteria

1. Regex fallback does not fire when ACR returns `ok: true`
2. Code blocks in transcripts do not appear in proposal content
3. Session start shows max 5 proposals, not all pending
4. No proposal content exceeds 200 characters
5. All existing tests pass (550+)
6. New tests cover all four functional requirements
