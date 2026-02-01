---
id: "F-006"
feature: "Post-session extraction hook"
status: "draft"
created: "2026-02-01"
depends_on: ["F-002", "F-003"]
---

# Specification: Post-Session Extraction Hook

## Overview

Provide functions that analyze session transcript text and extract learning candidates (patterns, insights, self-knowledge). Extracted candidates are stored as pending proposals in seed.json's `state.proposals` array via F-003's git-backed write.

This is a library layer — it provides extraction and proposal-writing functions. The actual hook script (Claude Code PreCompact hook) is a thin wrapper that calls these functions.

The extraction itself is rule-based (pattern matching), not LLM-based. It looks for explicit learning signals in the transcript text — phrases like "I learned that", "you prefer", "note to self", "remember that", etc. This keeps extraction deterministic, testable, and fast.

## User Scenarios

### Scenario 1: Session with learnable content

**As a** PAI system finishing a session
**I want** learning candidates extracted from the transcript
**So that** patterns and insights are captured for future sessions

**Acceptance Criteria:**
- [ ] `extractProposals(transcript)` returns an array of Proposal objects
- [ ] Each proposal has type, content, source (session ID), and pending status
- [ ] Extraction detects explicit learning signals in text
- [ ] Duplicate content is not extracted if already in proposals

### Scenario 2: Session with no learning signals

**As a** PAI system finishing a routine session
**I want** no noise proposals created
**So that** the user isn't bothered with empty reviews

**Acceptance Criteria:**
- [ ] Empty transcript returns empty proposals array
- [ ] Transcript with no learning signals returns empty array
- [ ] Short trivial sessions produce no proposals

### Scenario 3: Writing proposals to seed

**As a** PAI system after extraction
**I want** proposals persisted to seed.json with git commit
**So that** they survive across sessions

**Acceptance Criteria:**
- [ ] `writeProposals(proposals, seedPath?)` appends to seed.json state.proposals
- [ ] Existing proposals are preserved (append, not replace)
- [ ] Git commit with descriptive message: "Learn: extracted N proposals"
- [ ] Duplicate proposals (same content) are deduplicated

### Scenario 4: Hook entry point

**As a** Claude Code PreCompact hook
**I want** a single function to call with the transcript
**So that** the hook script is minimal

**Acceptance Criteria:**
- [ ] `extractionHook(transcript, seedPath?)` orchestrates extract + write
- [ ] Returns count of new proposals added
- [ ] Never throws — errors are logged and swallowed
- [ ] Idempotent — running twice with same transcript doesn't duplicate

## Functional Requirements

### FR-1: Learning Signal Detection

Provide `detectLearningSignals(text: string): LearningSignal[]` that:

```typescript
type SignalType = "pattern" | "insight" | "self_knowledge";

type LearningSignal = {
  type: SignalType;
  content: string;
  matchedPhrase: string;
};
```

Detection rules (case-insensitive):
- **pattern** signals: "you prefer", "you like to", "you always", "you usually", "your preference", "your style", "you tend to"
- **insight** signals: "I learned", "I noticed", "I discovered", "key insight", "important finding", "takeaway", "the lesson"
- **self_knowledge** signals: "note to self", "remember that", "I should remember", "for next time", "mental note", "I need to remember"

For each match:
1. Extract the sentence containing the signal phrase
2. Clean up: trim whitespace, remove leading punctuation, normalize quotes
3. Classify into the appropriate type
4. Skip matches shorter than 10 characters (after cleaning)

**Validation:** Unit test: each signal type detected, no false positives on common phrases, short content skipped.

### FR-2: Proposal Generation

Provide `extractProposals(transcript: string, sessionId?: string): Proposal[]` that:

1. Call `detectLearningSignals(transcript)`
2. For each signal, create a `Proposal` (from F-001 schema):
   - `id`: generated via `nanoid()`
   - `type`: from signal type
   - `content`: cleaned signal content
   - `source`: `sessionId ?? "unknown-session"`
   - `extractedAt`: current ISO datetime
   - `status`: `"pending"`
3. Deduplicate by content (case-insensitive) — keep first occurrence
4. Return array of proposals

**Validation:** Unit test: normal extraction, deduplication, empty transcript, no signals.

### FR-3: Proposal Writing

Provide `writeProposals(proposals: Proposal[], seedPath?: string): Promise<WriteProposalsResult>` that:

```typescript
type WriteProposalsResult =
  | { ok: true; added: number; skipped: number }
  | { ok: false; error: string };
```

1. Load current seed via `loadSeedWithGit(seedPath)`
2. If load fails: return error
3. Filter out proposals whose content already exists in `seed.state.proposals` (case-insensitive dedup)
4. Append new proposals to `seed.state.proposals`
5. Write via `writeSeedWithCommit(config, "Learn: extracted N proposals", seedPath)`
6. Return count of added and skipped

**Validation:** Unit test: normal write, dedup with existing, empty proposals, load failure.

### FR-4: Extraction Hook Entry Point

Provide `extractionHook(transcript: string, sessionId?: string, seedPath?: string): Promise<ExtractionResult>` that:

```typescript
type ExtractionResult =
  | { ok: true; added: number; total: number }
  | { ok: false; error: string };
```

1. Call `extractProposals(transcript, sessionId)`
2. If no proposals: return `{ ok: true, added: 0, total: 0 }`
3. Call `writeProposals(proposals, seedPath)`
4. Return result
5. Never throws — wrap all errors

**Validation:** Unit test: normal flow, no proposals, write error, never throws.

## Non-Functional Requirements

- **Performance:** `extractProposals()` completes in < 100ms for transcripts up to 100KB
- **No side effects on extract:** `extractProposals()` and `detectLearningSignals()` are pure functions
- **Deterministic:** Same transcript always produces same proposals (except for generated IDs)
- **Testability:** All functions accept path overrides. Tests use temp directories.
- **No new dependencies:** Uses nanoid (already in deps) for ID generation

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| LearningSignal | Detected signal from transcript | New in F-006 |
| Proposal | Pending learning candidate | F-001 |
| SeedConfig | Root config with state.proposals | F-001 |
| WriteProposalsResult | Result of writing proposals | New in F-006 |
| ExtractionResult | Result of extraction hook | New in F-006 |

## Success Criteria

- [ ] `detectLearningSignals()` finds pattern/insight/self_knowledge signals
- [ ] `extractProposals()` returns valid Proposal objects
- [ ] `writeProposals()` appends to seed.json without losing existing proposals
- [ ] `extractionHook()` orchestrates extract + write end-to-end
- [ ] Deduplication prevents duplicate proposals (by content)
- [ ] Empty/no-signal transcripts produce no proposals
- [ ] All extraction functions are pure (no I/O)
- [ ] Tests use temp directories
- [ ] Existing F-001 through F-005 tests pass (no regressions)
- [ ] `bun test` passes all tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Rule-based extraction is sufficient for v1 | Need LLM-based extraction | User feedback on proposal quality |
| Transcript is plain text | Structured transcript format | Schema evolution |
| Signal phrases are English-only | Multi-language support needed | Locale detection |
| Proposals array doesn't grow unbounded | Very long-running system | F-009 compaction handles this |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-001 | `Proposal` type, `proposalSchema` | Proposal shape |
| F-002 | `loadSeed()`, `writeSeed()`, `resolveSeedPath()` | Load/write behavior |
| F-003 | `loadSeedWithGit()`, `writeSeedWithCommit()` | Git integration |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|------|
| F-007 | Reads proposals written by F-006 | Confirmation flow |
| PAI hooks | `extractionHook()` | PreCompact hook calls this |

## Out of Scope

- LLM-based extraction (v1 is rule-based)
- Transcript parsing/formatting (assumes plain text input)
- Proposal review/confirmation (F-007)
- Proposal expiry/cleanup (F-015)
