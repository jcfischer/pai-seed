# Technical Plan: Post-Session Extraction Hook

## Architecture Overview

```
                        ┌─────────────────────┐
                        │  PreCompact Hook     │
                        │  (thin wrapper)      │
                        └──────────┬──────────┘
                                   │ transcript text
                                   ▼
                        ┌─────────────────────┐
                        │  extractionHook()    │  ← F-006 entry point
                        │  orchestrate + catch │
                        └──────────┬──────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼                             ▼
         ┌───────────────────┐         ┌───────────────────┐
         │ extractProposals() │         │ writeProposals()   │
         │ pure function      │         │ async, I/O         │
         └────────┬──────────┘         └────────┬──────────┘
                  │                             │
                  ▼                             ▼
         ┌───────────────────┐         ┌───────────────────┐
         │ detectLearning     │         │ loadSeedWithGit() │ ← F-003
         │ Signals()          │         │ writeSeedWith     │
         │ pure function      │         │ Commit()          │ ← F-003
         └───────────────────┘         └───────────────────┘
```

**Layer placement:** F-006 sits between F-003 (git persistence) and F-007 (proposal confirmation). It consumes F-003's read/write functions and produces proposals that F-007 will later present for review.

**Purity boundary:** `detectLearningSignals()` and `extractProposals()` are pure functions (no I/O). `writeProposals()` and `extractionHook()` perform I/O via F-003.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Language | TypeScript (strict) | Project standard |
| ID generation | nanoid | Already in deps, used by F-001 |
| Validation | Zod (via F-001 schemas) | Proposal validated through existing schema |
| Testing | bun:test | Project standard, 210 existing tests |
| Git operations | F-003 `loadSeedWithGit`, `writeSeedWithCommit` | Reuse, not rewrite |

**No new dependencies required.**

## Data Model

### New Types (defined in `src/extraction.ts`)

```typescript
import type { Proposal } from "./schema";

// Signal types map 1:1 to Proposal.type
type SignalType = "pattern" | "insight" | "self_knowledge";

// A raw learning signal detected in transcript text
type LearningSignal = {
  type: SignalType;
  content: string;        // cleaned sentence containing the signal
  matchedPhrase: string;  // the trigger phrase that was matched
};

// Result of writeProposals()
type WriteProposalsResult =
  | { ok: true; added: number; skipped: number }
  | { ok: false; error: string };

// Result of extractionHook()
type ExtractionResult =
  | { ok: true; added: number; total: number }
  | { ok: false; error: string };
```

### Existing Types (consumed from F-001)

```typescript
// From src/schema.ts — no changes needed
type Proposal = {
  id: string;
  type: "pattern" | "insight" | "self_knowledge";
  content: string;
  source: string;
  extractedAt: string;  // ISO datetime
  status: "pending" | "accepted" | "rejected";
};
```

### Signal Detection Rules

```typescript
// Case-insensitive phrase → SignalType mapping
const SIGNAL_PHRASES: Record<string, SignalType> = {
  // pattern signals
  "you prefer":       "pattern",
  "you like to":      "pattern",
  "you always":       "pattern",
  "you usually":      "pattern",
  "your preference":  "pattern",
  "your style":       "pattern",
  "you tend to":      "pattern",

  // insight signals
  "i learned":        "insight",
  "i noticed":        "insight",
  "i discovered":     "insight",
  "key insight":      "insight",
  "important finding":"insight",
  "takeaway":         "insight",
  "the lesson":       "insight",

  // self_knowledge signals
  "note to self":     "self_knowledge",
  "remember that":    "self_knowledge",
  "i should remember":"self_knowledge",
  "for next time":    "self_knowledge",
  "mental note":      "self_knowledge",
  "i need to remember":"self_knowledge",
};
```

## API Contracts

### Function Signatures

```typescript
// FR-1: Pure — detect signals in raw text
function detectLearningSignals(text: string): LearningSignal[];

// FR-2: Pure — convert signals to Proposal objects
function extractProposals(
  transcript: string,
  sessionId?: string,
): Proposal[];

// FR-3: Async — persist proposals to seed.json via git
async function writeProposals(
  proposals: Proposal[],
  seedPath?: string,
): Promise<WriteProposalsResult>;

// FR-4: Async — orchestrate extract + write, never throws
async function extractionHook(
  transcript: string,
  sessionId?: string,
  seedPath?: string,
): Promise<ExtractionResult>;
```

### Behavioral Contracts

| Function | Throws? | Side Effects | Deterministic |
|----------|---------|--------------|---------------|
| `detectLearningSignals` | Never | None | Yes (same input → same output) |
| `extractProposals` | Never | None | Yes, except for generated IDs |
| `writeProposals` | Never | Writes seed.json, git commit | N/A (I/O) |
| `extractionHook` | Never | Writes seed.json, git commit | N/A (I/O) |

## Implementation Phases

### Phase 1: Types and Signal Detection

**Goal:** `detectLearningSignals()` works and is fully tested.

**Steps:**
1. Create `src/extraction.ts` with type definitions (`SignalType`, `LearningSignal`, `WriteProposalsResult`, `ExtractionResult`)
2. Implement `SIGNAL_PHRASES` lookup table
3. Implement `detectLearningSignals(text)`:
   - Split text into sentences (split on `.`, `!`, `?`, newlines)
   - For each sentence, check if any signal phrase appears (case-insensitive)
   - On match: extract the sentence, clean it (trim, remove leading punctuation, normalize quotes)
   - Skip matches where cleaned content is < 10 characters
   - Return array of `LearningSignal` objects
4. Create `tests/extraction.test.ts`
5. Write tests for:
   - Each signal type detected correctly
   - Case-insensitive matching
   - Short content skipped (< 10 chars)
   - No false positives on common phrases (e.g., "you always" inside a word shouldn't match)
   - Empty string returns empty array
   - Multi-signal transcript returns all signals
   - Sentence boundary extraction works correctly

**Validation:** `bun test tests/extraction.test.ts` — all signal detection tests pass.

### Phase 2: Proposal Generation

**Goal:** `extractProposals()` converts signals to Proposal objects with deduplication.

**Steps:**
1. Import `nanoid` and `Proposal` type from schema
2. Implement `extractProposals(transcript, sessionId?)`:
   - Call `detectLearningSignals(transcript)`
   - Map each signal to a `Proposal` with nanoid ID, current ISO datetime, status "pending"
   - Deduplicate by content (case-insensitive comparison), keep first occurrence
   - Return array
3. Write tests for:
   - Normal extraction produces valid Proposals
   - Deduplication: duplicate content kept once
   - Empty transcript → empty array
   - No signals → empty array
   - Session ID flows through to `source` field
   - Missing session ID defaults to `"unknown-session"`
   - Generated proposals validate against `proposalSchema`

**Validation:** `bun test tests/extraction.test.ts` — all proposal generation tests pass.

### Phase 3: Write + Hook Integration

**Goal:** `writeProposals()` and `extractionHook()` work end-to-end with git.

**Steps:**
1. Implement `writeProposals(proposals, seedPath?)`:
   - Call `loadSeedWithGit(seedPath)`
   - If load fails: return `{ ok: false, error }`
   - Deduplicate against existing `seed.state.proposals` (case-insensitive content match)
   - Append new proposals to array
   - Call `writeSeedWithCommit(config, "Learn: extracted N proposals", seedPath)`
   - Return `{ ok: true, added, skipped }`
2. Implement `extractionHook(transcript, sessionId?, seedPath?)`:
   - Call `extractProposals(transcript, sessionId)`
   - If empty: return `{ ok: true, added: 0, total: 0 }`
   - Call `writeProposals(proposals, seedPath)`
   - If write fails: return `{ ok: false, error }`
   - Return `{ ok: true, added, total }`
   - Wrap entire body in try/catch — never throws
3. Write tests for:
   - `writeProposals`: normal write, dedup with existing proposals, empty proposals array, load failure
   - `extractionHook`: end-to-end flow, no proposals path, write error handling, never throws on any error
   - Git commit message format: "Learn: extracted N proposals"
   - Idempotency: running twice with same transcript doesn't duplicate
4. Tests use temp directories with `initTestGitRepo()` pattern from F-003 tests

**Validation:** `bun test tests/extraction.test.ts` — all tests pass. `bun test` — full suite passes (no regressions).

### Phase 4: Export and Finalize

**Goal:** Public API exports added, type checking passes.

**Steps:**
1. Add to `src/index.ts`:
   ```typescript
   // F-006
   export type { LearningSignal, SignalType, WriteProposalsResult, ExtractionResult } from "./extraction";
   export { detectLearningSignals, extractProposals, writeProposals, extractionHook } from "./extraction";
   ```
2. Run `bun run typecheck` — must exit 0
3. Run `bun test` — all 210+ tests pass (existing + new)

**Validation:** `bun run typecheck` clean. `bun test` all green.

## File Structure

```
src/
├── schema.ts          # F-001 (unchanged — Proposal type already defined)
├── loader.ts          # F-002 (unchanged)
├── git.ts             # F-003 (unchanged)
├── setup.ts           # F-004 (unchanged)
├── session.ts         # F-005 (unchanged)
├── extraction.ts      # F-006 (NEW — all extraction logic)
└── index.ts           # Add F-006 exports

tests/
├── extraction.test.ts # F-006 (NEW — extraction tests)
└── ...                # Existing tests unchanged
```

**Single module convention:** Following the project pattern where each feature is one source file + one test file. No sub-directories, no splitting across multiple files.

## Dependencies

### Upstream (consumed)

| Module | Import | Purpose |
|--------|--------|---------|
| `src/schema.ts` | `Proposal` type, `proposalSchema` | Validate generated proposals |
| `src/git.ts` | `loadSeedWithGit()`, `writeSeedWithCommit()` | Read/write seed with git |
| `nanoid` | `nanoid()` | Generate proposal IDs |

### Downstream (consumed by)

| Consumer | Import | Purpose |
|----------|--------|---------|
| F-007 | Reads `state.proposals` written by F-006 | Confirmation flow |
| PreCompact hook script | `extractionHook()` | Thin wrapper calls this |

### No New Packages

All dependencies already present in `package.json`:
- `nanoid` — ID generation
- `zod` — validation (indirect, via schema imports)

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Signal phrases match inside words** (e.g., "you always" in "bayou always") | Medium — false positives create noise proposals | Low | Use word boundary matching: check that the character before the phrase is a word boundary (start of string, space, newline, punctuation). Add negative test cases. |
| **Sentence splitting too naive** — periods in URLs, abbreviations, numbers split incorrectly | Medium — truncated or mangled signal content | Medium | Split on sentence-ending patterns (`. `, `.\n`, `! `, `? `) rather than bare `.`. Test with URLs and abbreviations in transcript. |
| **Large transcripts cause slow extraction** | Low — spec requires < 100ms for 100KB | Low | Signal phrases are a small fixed set. Single pass through text. No regex backtracking. Benchmark in tests if concerned. |
| **Git lock contention** — concurrent hook invocations race on seed.json | Medium — one invocation fails | Low | `writeSeedWithCommit` already handles git failures gracefully (non-fatal). The hook returns `{ ok: false }` and proposals are lost for that session but system continues. Acceptable for v1. |
| **Proposals array grows unbounded** | Low — addressed by future F-015 | Low | Out of scope per spec. F-015 (learning decay) handles cleanup. For v1, no mitigation needed. |

## Design Decisions

| Decision | Choice | Alternative Considered | Rationale |
|----------|--------|----------------------|-----------|
| Single file vs. multiple files | Single `extraction.ts` | Separate `signals.ts` + `extraction.ts` | Project convention: one feature = one file. Functions are small and cohesive. |
| Sentence splitting strategy | Split on `. `, `.\n`, `! `, `? `, `\n` | Regex-based NLP sentence tokenizer | Spec says rule-based, not NLP. Simple splitting is deterministic and fast. Edge cases acceptable for v1. |
| Dedup strategy | Case-insensitive content comparison | Content hash, fuzzy matching | Spec explicitly says case-insensitive dedup. Simple string comparison is sufficient. |
| ID generation | `nanoid()` (default length) | UUID, incrementing counter | Matches existing convention in test fixtures. Already a dependency. |
| Word boundary checking | Check char before match is boundary | Full regex with `\b` | Explicit boundary check is easier to test and debug than regex `\b` behavior across Unicode. |

## Test Strategy

### Test Count Estimate: ~35-40 new tests

| Category | Tests | Description |
|----------|-------|-------------|
| Signal detection basics | 8 | Each type detected, case-insensitive, empty input |
| Signal edge cases | 6 | Word boundaries, short content, URLs, multi-signal |
| Proposal generation | 7 | Normal, dedup, empty, no signals, session ID, schema validation |
| writeProposals | 6 | Normal write, dedup existing, empty array, load failure, commit message |
| extractionHook | 6 | End-to-end, no proposals, write error, never throws, idempotent |
| Integration | 4 | Full pipeline with git, regression with existing proposals |

### Test Fixtures Needed

```typescript
// Transcript with all three signal types
const TRANSCRIPT_ALL_SIGNALS = `
During our session, I learned that TypeScript generics are more powerful than I thought.
You prefer using discriminated unions over try/catch for error handling.
Note to self: always check the return type before assuming success.
`;

// Transcript with no signals
const TRANSCRIPT_NO_SIGNALS = `
We discussed the implementation of the new feature.
The code was refactored to improve readability.
Tests were added for edge cases.
`;

// Transcript with duplicates
const TRANSCRIPT_DUPLICATES = `
I learned that testing is important.
Later, I learned that testing is important.
`;

// Transcript with edge cases
const TRANSCRIPT_EDGE_CASES = `
Visit bayou-always-open.com for details.
You prefer short variable names. You prefer short variable names.
I learned x.
`;
```

### Test Infrastructure

- Uses `mkdtemp` + `afterEach` cleanup (existing pattern)
- Git tests use `initTestGitRepo()` helper from F-003 test patterns
- Pure function tests need no temp directories
- I/O tests (writeProposals, extractionHook) use temp directories with initialized git repos
