# Implementation Tasks: Post-Session Extraction Hook (F-006)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Types and signal phrase table |
| T-1.2 | ☐ | detectLearningSignals() |
| T-1.3 | ☐ | Tests for signal detection |
| T-2.1 | ☐ | extractProposals() |
| T-2.2 | ☐ | Tests for proposal generation |
| T-3.1 | ☐ | writeProposals() |
| T-3.2 | ☐ | extractionHook() |
| T-3.3 | ☐ | Tests for persistence and hook |
| T-4.1 | ☐ | Public exports in index.ts |
| T-4.2 | ☐ | Typecheck and full test suite |

---

## Group 1: Foundation — Signal Detection

### T-1.1: Define types and signal phrase table

- **File:** `src/extraction.ts`
- **Test:** N/A (types only)
- **Dependencies:** None
- **Description:**
  Create `src/extraction.ts` with all F-006 type definitions and the signal phrase lookup table.

  Types to define:
  - `SignalType` — `"pattern" | "insight" | "self_knowledge"`
  - `LearningSignal` — `{ type: SignalType; content: string; matchedPhrase: string }`
  - `WriteProposalsResult` — discriminated union `{ ok: true; added: number; skipped: number } | { ok: false; error: string }`
  - `ExtractionResult` — discriminated union `{ ok: true; added: number; total: number } | { ok: false; error: string }`

  Constant to define:
  - `SIGNAL_PHRASES: Record<string, SignalType>` — 20 phrases mapped to their signal type (7 pattern, 7 insight, 6 self_knowledge per spec FR-1)

  Follow the project's discriminated union pattern (matches `LoadResult`, `WriteResult`, `GitResult` from F-002/F-003).

### T-1.2: Implement detectLearningSignals() [T]

- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Implement `detectLearningSignals(text: string): LearningSignal[]` as a pure function.

  Algorithm:
  1. Split text into sentences on `. `, `.\n`, `! `, `? `, `\n` (not bare `.` — avoids splitting URLs/abbreviations)
  2. For each sentence, check each signal phrase (case-insensitive)
  3. Before matching, verify word boundary: character before match must be start-of-string, space, newline, or punctuation (prevents "bayou always" matching "you always")
  4. On match: trim whitespace, remove leading punctuation, normalize smart quotes to straight quotes
  5. Skip if cleaned content < 10 characters
  6. Return `LearningSignal` with type, cleaned content, and matched phrase

  Must be pure: no I/O, no side effects, deterministic output for same input.

### T-1.3: Tests for signal detection [T] [P with T-2.1]

- **File:** `tests/extraction.test.ts`
- **Test:** Self (this IS the test file)
- **Dependencies:** T-1.2
- **Description:**
  Create `tests/extraction.test.ts` with a `describe("detectLearningSignals")` block.

  Test cases (~12 tests):
  - Each signal type detected correctly (pattern, insight, self_knowledge) — 3 tests
  - Case-insensitive matching ("You Prefer" matches "you prefer")
  - Short content skipped (< 10 chars after cleaning)
  - No false positives on embedded words ("bayou always" should NOT match)
  - Empty string returns empty array
  - Multi-signal transcript returns all signals
  - Sentence boundary extraction preserves full sentence
  - Smart quotes normalized to straight quotes
  - Leading punctuation stripped from content
  - URL-containing text doesn't break sentence splitting ("visit example.com for details")

  Test fixtures:
  ```typescript
  const TRANSCRIPT_ALL_SIGNALS = `
  During our session, I learned that TypeScript generics are powerful.
  You prefer using discriminated unions for error handling.
  Note to self: always check the return type before assuming success.
  `;

  const TRANSCRIPT_NO_SIGNALS = `
  We discussed the implementation of the new feature.
  The code was refactored to improve readability.
  `;

  const TRANSCRIPT_EDGE_CASES = `
  Visit bayou-always-open.com for details.
  I learned x.
  `;
  ```

  No temp directories needed — pure function tests.

---

## Group 2: Proposal Generation

### T-2.1: Implement extractProposals() [T] [P with T-1.3]

- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** T-1.2
- **Description:**
  Implement `extractProposals(transcript: string, sessionId?: string): Proposal[]` as a pure function.

  Algorithm:
  1. Call `detectLearningSignals(transcript)`
  2. Map each `LearningSignal` to a `Proposal`:
     - `id`: `nanoid()` (default length)
     - `type`: from signal type (maps 1:1)
     - `content`: from signal content
     - `source`: `sessionId ?? "unknown-session"`
     - `extractedAt`: `new Date().toISOString()`
     - `status`: `"pending"`
  3. Deduplicate by content (case-insensitive, `.toLowerCase()` comparison), keep first occurrence
  4. Return array

  Import `nanoid` from `"nanoid"` and `Proposal` type from `"./schema"`.

### T-2.2: Tests for proposal generation [T]

- **File:** `tests/extraction.test.ts`
- **Test:** Self
- **Dependencies:** T-2.1
- **Description:**
  Add `describe("extractProposals")` block to `tests/extraction.test.ts`.

  Test cases (~8 tests):
  - Normal extraction produces valid Proposal objects
  - Each proposal has an `id` (nanoid string), correct `type`, `content`, `source`
  - `status` is always `"pending"`
  - `extractedAt` is valid ISO datetime
  - Deduplication: duplicate content → kept once
  - Empty transcript → empty array
  - No signals in transcript → empty array
  - Session ID flows to `source`; missing defaults to `"unknown-session"`
  - Generated proposals validate against `proposalSchema` from `src/schema.ts`

  No temp directories needed — pure function tests (except ISO datetime needs tolerance).

---

## Group 3: Persistence and Hook

### T-3.1: Implement writeProposals() [T]

- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Implement `async writeProposals(proposals: Proposal[], seedPath?: string): Promise<WriteProposalsResult>`.

  Algorithm:
  1. If `proposals` is empty, return `{ ok: true, added: 0, skipped: 0 }`
  2. Call `loadSeedWithGit(seedPath)` — import from `"./git"`
  3. If load fails (`!result.ok`), return `{ ok: false, error: result.error.message }`
  4. Get existing proposals: `seed.state.proposals ?? []`
  5. Build a Set of existing content (lowercase) for dedup lookup
  6. Filter new proposals: keep only those whose `.content.toLowerCase()` is NOT in the Set
  7. Append filtered proposals to `seed.state.proposals`
  8. Call `writeSeedWithCommit(config, "Learn: extracted N proposals", seedPath)` where N = added count
  9. If write fails, return `{ ok: false, error }`
  10. Return `{ ok: true, added: filtered.length, skipped: proposals.length - filtered.length }`

  Import `loadSeedWithGit` and `writeSeedWithCommit` from `"./git"`.

### T-3.2: Implement extractionHook() [T]

- **File:** `src/extraction.ts`
- **Test:** `tests/extraction.test.ts`
- **Dependencies:** T-3.1
- **Description:**
  Implement `async extractionHook(transcript: string, sessionId?: string, seedPath?: string): Promise<ExtractionResult>`.

  Algorithm:
  1. Wrap entire body in try/catch — **never throws**
  2. Call `extractProposals(transcript, sessionId)`
  3. If empty: return `{ ok: true, added: 0, total: 0 }`
  4. Call `writeProposals(proposals, seedPath)`
  5. If write failed (`!result.ok`): return `{ ok: false, error: result.error }`
  6. Return `{ ok: true, added: result.added, total: proposals.length }`
  7. Catch block: return `{ ok: false, error: String(e) }`

  This is the public entry point for the PreCompact hook script.

### T-3.3: Tests for persistence and hook [T]

- **File:** `tests/extraction.test.ts`
- **Test:** Self
- **Dependencies:** T-3.1, T-3.2
- **Description:**
  Add `describe("writeProposals")` and `describe("extractionHook")` blocks.

  Uses temp directories with git — follow the pattern from `tests/git.test.ts`:
  ```typescript
  let testDir: string;
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-extraction-test-"));
  });
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  ```

  Use `initTestGitRepo(testDir)` helper (define locally, same pattern as git.test.ts).

  **writeProposals tests** (~6 tests):
  - Normal write: proposals appended, returns `{ ok: true, added: N, skipped: 0 }`
  - Dedup with existing: proposals already in seed → skipped, not duplicated
  - Empty proposals array → `{ ok: true, added: 0, skipped: 0 }`
  - Load failure (bad path) → `{ ok: false, error }`
  - Git commit message format: "Learn: extracted N proposals"
  - Existing proposals preserved after write (append, not replace)

  **extractionHook tests** (~7 tests):
  - End-to-end: transcript with signals → proposals written to seed
  - No proposals path: no-signal transcript → `{ ok: true, added: 0, total: 0 }`
  - Write error handling: bad seed path → `{ ok: false, error }`
  - Never throws: force an error (e.g., null transcript) → returns error result, doesn't throw
  - Idempotent: same transcript twice → no duplicates on second run
  - Returns correct `added` and `total` counts
  - Large transcript (100KB) completes in < 100ms (performance budget)

---

## Group 4: Integration

### T-4.1: Add public exports to index.ts [T]

- **File:** `src/index.ts`
- **Test:** `bun run typecheck`
- **Dependencies:** T-3.2
- **Description:**
  Add F-006 exports to `src/index.ts`, following the existing pattern (types first, then functions).

  Add to type exports:
  ```typescript
  export type { LearningSignal, SignalType, WriteProposalsResult, ExtractionResult } from "./extraction";
  ```

  Add to function exports:
  ```typescript
  export { detectLearningSignals, extractProposals, writeProposals, extractionHook } from "./extraction";
  ```

  Group under a `// F-006: Post-session extraction` comment, matching the existing `// F-005: Session start hook` convention.

### T-4.2: Typecheck and full test suite [T]

- **File:** N/A (validation task)
- **Test:** All tests
- **Dependencies:** T-4.1
- **Description:**
  Final validation:
  1. `bun run typecheck` — must exit 0 with no errors
  2. `bun test` — all tests pass (existing 210+ tests + ~35 new extraction tests)
  3. No regressions in F-001 through F-005 tests

  If any failure: fix before marking complete.

---

## Execution Order

```
T-1.1  (types, no deps)
  │
  ▼
T-1.2  (detectLearningSignals, needs types)
  │
  ├────────────┐
  ▼            ▼
T-1.3  [P]   T-2.1  [P]   ← can run in parallel (both depend on T-1.2)
  │            │
  │            ▼
  │          T-2.2  (proposal generation tests)
  │            │
  └────────────┤
               ▼
             T-3.1  (writeProposals, needs extractProposals)
               │
               ▼
             T-3.2  (extractionHook, needs writeProposals)
               │
               ▼
             T-3.3  (persistence + hook tests)
               │
               ▼
             T-4.1  (exports)
               │
               ▼
             T-4.2  (final validation)
```

**Critical path:** T-1.1 → T-1.2 → T-2.1 → T-3.1 → T-3.2 → T-3.3 → T-4.1 → T-4.2

**Parallelizable pair:** T-1.3 and T-2.1 (both depend only on T-1.2, no mutual dependency)
