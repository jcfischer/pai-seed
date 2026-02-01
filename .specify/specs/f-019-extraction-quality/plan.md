# F-019: Extraction Quality — Technical Plan

## Architecture Overview

```
CURRENT PIPELINE:
  transcript ──────────────────────┐
                                   ▼
                          callAcrExtraction()
                           (extraction.ts:354)
                                   │
                      ┌────────────┴───────────┐
                      │ ok: true               │ ok: false
                      ▼                        ▼
              filter ≥ threshold        extractProposals()  ◄── REGEX FALLBACK
              (extraction.ts:300)       (extraction.ts:143)
                      │
              ┌───────┴────────┐
              │ matches > 0    │ matches = 0
              ▼                ▼
    acrLearningsToProposals   extractProposals()  ◄── REGEX FALLBACK (GARBAGE SOURCE)
    (extraction.ts:243)       (extraction.ts:143)
              │                        │
              └────────┬───────────────┘
                       ▼
               writeProposals()
               (extraction.ts:188)
                       │
                       ▼
             formatProposals()  ──── ALL proposals surfaced (no cap)
             (session.ts:110)


NEW PIPELINE:
  transcript
       │
       ▼
  stripStructuredContent()  ◄── NEW: remove code blocks, JSON, tool output
  (extraction.ts — new)
       │
       ▼  cleaned transcript
  callAcrExtraction(cleaned)
  (extraction.ts:354)
       │
  ┌────┴──────────────┐
  │ ok: true          │ ok: false (binary missing/timeout)
  ▼                   ▼
  filter ≥ threshold  extractProposals(cleaned)  ◄── REGEX on CLEANED text only
  │                   + truncateContent(200)
  ┌───┴──────┐
  │ > 0      │ = 0
  ▼          ▼
  acrToP()   []  ◄── ACCEPT SILENCE (no regex fallback)
  + truncate
       │
       ▼
  writeProposals()
       │
       ▼
  formatProposals()  ──── TOP 5 by recency + "N more pending" footer
  (session.ts:110)
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Testing | Bun test runner | Already in use — 550+ tests, `describe`/`test`/`expect` |
| Validation | Zod | Proposal schema already Zod-validated (`schema.ts:25`) |
| No new deps | — | All changes are pure function additions + logic edits |

## Data Model

No schema changes. The `Proposal` type (`schema.ts:25-33`) is unchanged:

```typescript
// Existing — no modifications needed
export const proposalSchema = z.object({
  id: z.string(),
  type: z.enum(["pattern", "insight", "self_knowledge"]),
  content: z.string().min(1),
  source: z.string().min(1),
  extractedAt: z.string().datetime(),
  status: z.enum(["pending", "accepted", "rejected"]),
  method: z.enum(["acr", "regex"]).optional(),
});
```

The `content` field remains `z.string().min(1)` — truncation happens before validation, not via schema constraint.

## API Contracts

No API changes. Internal function signatures are modified:

| Function | Change |
|----------|--------|
| `extractionHook()` | Pre-filters transcript, removes regex fallback on ACR success |
| `extractProposals()` | Applies `truncateContent()` to each proposal |
| `acrLearningsToProposals()` | Applies `truncateContent()` to each proposal |
| `formatProposals()` | Caps at 5 proposals, adds footer |
| `stripStructuredContent()` | **New** pure function |
| `truncateContent()` | **New** pure helper |

Return types unchanged. Callers unaffected.

## Implementation Phases

### Phase 1: `stripStructuredContent()` — Pre-filter function

**File:** `src/extraction.ts` (insert before `extractionHook` at ~line 280)

New pure function that strips structured data regions from transcript text:

```typescript
const FENCED_CODE_BLOCK = /^```[\s\S]*?^```/gm;
const LINE_NUMBER_PREFIX = /^\s*\d+[→│|]\s*.*$/gm;
const TOOL_BLOCKS = /<(?:antml:invoke|tool_result|function_results)[\s\S]*?<\/(?:antml:invoke|tool_result|function_results)>/g;
const MULTILINE_JSON = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g; // nested 1 level, >200 chars

export function stripStructuredContent(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(FENCED_CODE_BLOCK, " [...] ");
  cleaned = cleaned.replace(LINE_NUMBER_PREFIX, "");
  cleaned = cleaned.replace(TOOL_BLOCKS, " [...] ");
  // Only strip JSON objects > 200 chars (likely structured data, not inline)
  cleaned = cleaned.replace(MULTILINE_JSON, (match) =>
    match.length > 200 ? " [...] " : match
  );
  // Collapse multiple whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned;
}
```

**Design decisions:**
- Replace with `[...]` placeholder to preserve sentence boundaries for downstream splitting
- JSON threshold at 200 chars — small objects like `{"ok": true}` preserved
- Line-number prefix pattern `\d+→` matches the PAI status line format seen in proposals
- Tool blocks match `<invoke>`, `<tool_result>`, `<function_results>` patterns from Claude transcripts

**Tests (Phase 1):**
- Strips fenced code blocks, preserves surrounding prose
- Strips line-numbered content (e.g., `  123→ const x = 1`)
- Strips tool use XML blocks
- Strips large JSON objects (>200 chars), preserves small ones
- Returns original text when no structured content present
- Preserves signal phrases in prose around code blocks
- Collapses excessive newlines

### Phase 2: Kill regex fallback on ACR success

**File:** `src/extraction.ts`, `extractionHook()` (lines 287-334)

**Current code (lines 307-315):**
```typescript
if (filtered.length > 0) {
  proposals = acrLearningsToProposals(filtered, sessionId);
} else {
  // ACR returned nothing above threshold — fall back to regex
  proposals = extractProposals(transcript, sessionId);
  for (const p of proposals) {
    p.method = "regex";
  }
}
```

**New code:**
```typescript
if (filtered.length > 0) {
  proposals = acrLearningsToProposals(filtered, sessionId);
} else {
  // ACR succeeded but found nothing above threshold — accept silence
  proposals = [];
}
```

Also apply pre-filtering at the top of the try block (~line 293):
```typescript
const cleaned = stripStructuredContent(transcript);
const acrResult = await callAcrExtraction(cleaned);
```

And update the ACR-failure branch (~line 318) to use cleaned transcript:
```typescript
} else {
  // ACR unavailable — regex on pre-filtered transcript
  proposals = extractProposals(cleaned, sessionId);
  for (const p of proposals) p.method = "regex";
}
```

**Tests (Phase 2):**
- ACR ok=true, 0 learnings above threshold → 0 proposals (NOT regex fallback)
- ACR ok=false → regex fires on stripped transcript
- Existing ACR success tests still pass
- `extractionHook` receives pre-filtered transcript (mock ACR to verify cleaned input)

**Test updates required:**
- `tests/extraction.test.ts` lines ~880-916: Tests asserting regex fallback on empty ACR results must now assert `added: 0, total: 0`
- Specifically: "Below-threshold filtering" test and "All learnings below threshold" test

### Phase 3: Content truncation

**File:** `src/extraction.ts`

New helper (insert near top, after imports):
```typescript
const MAX_PROPOSAL_CONTENT_LENGTH = 200;

function truncateContent(content: string): string {
  if (content.length <= MAX_PROPOSAL_CONTENT_LENGTH) return content;
  return content.slice(0, MAX_PROPOSAL_CONTENT_LENGTH) + "...";
}
```

Apply in two locations:

1. **`extractProposals()`** (line ~163): wrap content at proposal creation
   ```typescript
   content: truncateContent(signal.content),
   ```

2. **`acrLearningsToProposals()`** (line ~258): wrap content at proposal creation
   ```typescript
   content: truncateContent(learning.content),
   ```

**Tests (Phase 3):**
- Content at 200 chars → unchanged
- Content at 201 chars → truncated to 200 + "..."
- Content at 50 chars → unchanged
- Empty content → unchanged (min(1) in schema still enforced)

### Phase 4: Cap proposal surfacing

**File:** `src/session.ts`, `formatProposals()` (lines 110-125)

**Current implementation:**
```typescript
export function formatProposals(proposals: Proposal[]): string {
  const pending = proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return "";
  const lines: string[] = [`Pending proposals (${pending.length}):`];
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    lines.push(`  ${i + 1}. [${p.type}] "${p.content}" (from ${p.source})`);
  }
  return lines.join("\n");
}
```

**New implementation:**
```typescript
const MAX_SURFACED_PROPOSALS = 5;

export function formatProposals(proposals: Proposal[]): string {
  const pending = proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return "";

  // Sort by recency (most recent first)
  const sorted = [...pending].sort(
    (a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime()
  );

  const shown = sorted.slice(0, MAX_SURFACED_PROPOSALS);
  const remaining = pending.length - shown.length;

  const lines: string[] = [`Pending proposals (${pending.length}):`];
  for (let i = 0; i < shown.length; i++) {
    const p = shown[i];
    lines.push(`  ${i + 1}. [${p.type}] "${p.content}" (from ${p.source})`);
  }

  if (remaining > 0) {
    lines.push(
      `\n  ... and ${remaining} more pending. Run \`pai-seed proposals review\` to manage.`
    );
  }

  return lines.join("\n");
}
```

**Tests (Phase 4):**
- 0 proposals → empty string (unchanged)
- 3 proposals → all 3 shown, no footer
- 5 proposals → all 5 shown, no footer
- 6 proposals → 5 shown + "... and 1 more pending..."
- 48 proposals → 5 shown + "... and 43 more pending..."
- Proposals sorted by recency (most recent first)
- Footer contains `pai-seed proposals review` command

## File Structure

No new files. All changes in existing files:

```
src/
├── extraction.ts      # +stripStructuredContent(), +truncateContent(),
│                      #  modify extractionHook(), extractProposals(),
│                      #  acrLearningsToProposals()
├── session.ts         # modify formatProposals()
└── schema.ts          # UNCHANGED

tests/
├── extraction.test.ts # +stripStructuredContent tests, +truncation tests,
│                      #  update ACR fallback behavior tests
└── session.test.ts    # +formatProposals cap tests (may need to create if absent)
```

## Dependencies

- **No new packages** — all changes use built-in regex, string operations, and Bun test runner
- **No schema migration** — Proposal type unchanged
- **ACR binary interface unchanged** — still receives transcript text, returns JSON
- **Git integration unchanged** — `writeSeedWithCommit()` API same

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `stripStructuredContent()` regex over-strips legitimate prose | Medium — some learnings missed | Low — patterns are specific (fenced blocks, line numbers, XML tags) | Replace with `[...]` placeholder; conservative thresholds; test with real transcripts |
| Multiline JSON regex too greedy | Medium — removes prose containing `{` and `}` | Medium — prose rarely has balanced braces >200 chars | Only strip when match >200 chars; test with edge cases |
| ACR silence produces zero learnings long-term | Low — user loses implicit extraction | Low — ACR typically finds something if real learnings exist | Regex still fires when ACR is unavailable; users can `pai-seed learn` manually |
| Existing tests break on fallback behavior change | Low — localized | High — tests explicitly assert regex fallback | Phase 2 specifically identifies which tests to update |
| Truncation at 200 chars loses important context | Low — 200 chars is ~2 sentences | Low — learnings should be concise by nature | 200 is generous; users see truncated content can review original in proposals |
| Existing 48 garbage proposals remain | Medium — clutter persists until cleaned | Certain — F-019 prevents future, doesn't fix past | Document: run `pai-seed proposals reject-all && pai-seed proposals clean` |

## Implementation Order

```
Phase 1: stripStructuredContent()     # Pure function, independently testable
  └── Phase 2: Kill regex fallback    # Depends on Phase 1 (uses cleaned transcript)
        └── Phase 3: Content truncation  # Independent but logical after pipeline changes
              └── Phase 4: Cap surfacing # Independent, session.ts change
```

Phase 1 and 4 could run in parallel (different files, no dependencies). Phases 2-3 depend on Phase 1.

## Verification Plan

| Spec Criterion | How to Verify |
|----------------|---------------|
| Regex fallback does not fire when ACR returns ok:true | Unit test: mock ACR ok=true + empty filtered → assert 0 proposals |
| Code blocks in transcripts do not appear in proposals | Unit test: transcript with fenced code block containing signal phrase → 0 proposals from code |
| Session start shows max 5 proposals | Unit test: formatProposals with 48 proposals → output has exactly 5 entries + footer |
| No proposal content exceeds 200 characters | Unit test: extractProposals with 500-char signal → proposal content ≤ 203 chars (200 + "...") |
| All existing tests pass | `bun test` — 550+ tests green |
| New tests cover all four FRs | At least 2 tests per FR = minimum 8 new tests |
