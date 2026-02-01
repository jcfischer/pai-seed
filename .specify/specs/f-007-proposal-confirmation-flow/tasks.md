# Implementation Tasks: Proposal Confirmation Flow (F-007)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Result types + pure helpers |
| T-1.2 | ☐ | Pure helper tests |
| T-2.1 | ☐ | getPendingProposals |
| T-2.2 | ☐ | acceptProposal |
| T-2.3 | ☐ | rejectProposal |
| T-3.1 | ☐ | acceptAllProposals |
| T-3.2 | ☐ | rejectAllProposals |
| T-3.3 | ☐ | cleanRejected |
| T-4.1 | ☐ | Public API exports |
| T-4.2 | ☐ | Full test suite green |

## Group 1: Foundation

### T-1.1: Result types and pure helper functions [T]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** none
- **Description:**
  Create `src/confirmation.ts` with:
  1. Export result types: `PendingResult`, `ConfirmResult`, `RejectResult`, `BulkResult` (discriminated unions matching project pattern: `{ ok: true; ... } | { ok: false; error: string }`)
  2. Pure function `proposalToLearning(proposal: Proposal): Learning` — converts proposal to learning entry with `confirmed: true`, `confirmedAt` set to current ISO datetime, empty `tags` array, preserving `id`, `content`, `source`, `extractedAt`
  3. Pure function `addLearningToCategory(config: SeedConfig, learning: Learning, type: Proposal["type"]): void` — pushes learning to correct `learned.*` array: `"pattern"` → `learned.patterns`, `"insight"` → `learned.insights`, `"self_knowledge"` → `learned.selfKnowledge` (mutates in place, matching existing codebase convention)
  4. Import types from `./schema` (`Proposal`, `Learning`, `SeedConfig`)

### T-1.2: Pure helper unit tests [T] [P with T-2.1]
- **File:** `tests/confirmation.test.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Create `tests/confirmation.test.ts` with test infrastructure and pure function tests:
  1. Test setup: `beforeEach`/`afterEach` with `mkdtemp()` + `rm()` (matching `extraction.test.ts` pattern)
  2. Helper: `makeProposal(overrides?: Partial<Proposal>): Proposal` factory using nanoid
  3. Helper: `initTestGitRepo(dir)` and `writeSeedAndCommit(dir, config?)` (reuse pattern from extraction tests)
  4. `proposalToLearning` tests (~3):
     - Converts proposal fields correctly (id, content, source, extractedAt preserved)
     - Sets `confirmed: true` and `confirmedAt` to valid ISO datetime
     - Sets `tags` to empty array
  5. `addLearningToCategory` tests (~3):
     - Routes `"pattern"` type to `learned.patterns`
     - Routes `"insight"` type to `learned.insights`
     - Routes `"self_knowledge"` type to `learned.selfKnowledge`

## Group 2: Core Operations

### T-2.1: getPendingProposals [T] [P with T-1.2]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Implement `getPendingProposals(seedPath?: string): Promise<PendingResult>`:
  1. Load seed via `loadSeedWithGit(seedPath)`
  2. Handle load failure: return `{ ok: false, error }`
  3. Filter `state.proposals` to `status === "pending"`
  4. Sort by `extractedAt` ascending (oldest first)
  5. Return `{ ok: true, proposals, count }`
  6. Tests (~4):
     - Returns pending proposals sorted by extractedAt
     - Returns empty array when no proposals exist
     - Filters out rejected proposals (mixed statuses)
     - Handles seed load failure gracefully

### T-2.2: acceptProposal [T]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-2.1
- **Description:**
  Implement `acceptProposal(proposalId: string, seedPath?: string): Promise<ConfirmResult>`:
  1. Load seed via `loadSeedWithGit(seedPath)`
  2. Find proposal by ID in `state.proposals`
  3. If not found: return `{ ok: false, error: "Proposal 'xxx' not found" }`
  4. If not pending: return `{ ok: false, error: "Proposal 'xxx' is already rejected" }`
  5. Call `proposalToLearning(proposal)` to create Learning entry
  6. Call `addLearningToCategory(config, learning, proposal.type)` to route to correct array
  7. Remove proposal from `state.proposals` (filter out by ID)
  8. Write via `writeSeedWithCommit(config, "Confirm: accepted '{content.slice(0, 50)}'")` — truncate content in commit message
  9. Return `{ ok: true, learning }`
  10. Tests (~6):
      - Accepts pattern type → appears in `learned.patterns`
      - Accepts insight type → appears in `learned.insights`
      - Accepts self_knowledge type → appears in `learned.selfKnowledge`
      - Returns error when proposal ID not found
      - Returns error when proposal already rejected
      - Creates git commit with correct message format

### T-2.3: rejectProposal [T] [P with T-2.2]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-1.1, T-1.2, T-2.1
- **Description:**
  Implement `rejectProposal(proposalId: string, seedPath?: string): Promise<RejectResult>`:
  1. Load seed via `loadSeedWithGit(seedPath)`
  2. Find proposal by ID in `state.proposals`
  3. If not found: return `{ ok: false, error: "Proposal 'xxx' not found" }`
  4. If not pending: return `{ ok: false, error: "Proposal 'xxx' is already rejected" }`
  5. Set `proposal.status = "rejected"`
  6. Write via `writeSeedWithCommit(config, "Reject: rejected '{content.slice(0, 50)}'")` — truncate content
  7. Return `{ ok: true }`
  8. Tests (~4):
      - Rejects proposal successfully, status changes to "rejected"
      - Returns error when proposal ID not found
      - Returns error when proposal already rejected
      - Creates git commit with correct message format

## Group 3: Bulk Operations

### T-3.1: acceptAllProposals [T] [P with T-3.2, T-3.3]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-2.2
- **Description:**
  Implement `acceptAllProposals(seedPath?: string): Promise<BulkResult>`:
  1. Load seed via `loadSeedWithGit(seedPath)`
  2. Filter `state.proposals` to pending
  3. If none pending: return `{ ok: true, count: 0 }` (no write)
  4. For each pending: `proposalToLearning()` + `addLearningToCategory()`
  5. Remove all accepted from `state.proposals`
  6. Single `writeSeedWithCommit(config, "Confirm: accepted N proposals")`
  7. Return `{ ok: true, count }`
  8. Tests (~3):
      - Accepts all pending proposals, each routed to correct category
      - Returns count 0 when no pending proposals (no git commit)
      - Preserves rejected proposals in state (mixed statuses)

### T-3.2: rejectAllProposals [T] [P with T-3.1, T-3.3]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-2.3
- **Description:**
  Implement `rejectAllProposals(seedPath?: string): Promise<BulkResult>`:
  1. Load seed via `loadSeedWithGit(seedPath)`
  2. Filter `state.proposals` to pending
  3. If none pending: return `{ ok: true, count: 0 }` (no write)
  4. Set `status = "rejected"` on each pending
  5. Single `writeSeedWithCommit(config, "Reject: rejected N proposals")`
  6. Return `{ ok: true, count }`
  7. Tests (~3):
      - Rejects all pending proposals
      - Returns count 0 when no pending proposals (no git commit)
      - Preserves already-rejected proposals unchanged

### T-3.3: cleanRejected [T] [P with T-3.1, T-3.2]
- **File:** `src/confirmation.ts`
- **Test:** `tests/confirmation.test.ts`
- **Dependencies:** T-2.3
- **Description:**
  Implement `cleanRejected(seedPath?: string): Promise<BulkResult>`:
  1. Load seed via `loadSeedWithGit(seedPath)`
  2. Count rejected proposals in `state.proposals`
  3. If none rejected: return `{ ok: true, count: 0 }` (no write)
  4. Filter `state.proposals` to remove rejected (keep pending only)
  5. Write via `writeSeedWithCommit(config, "Cleanup: removed N rejected proposals")`
  6. Return `{ ok: true, count }`
  7. Tests (~4):
      - Removes rejected proposals from state
      - Returns count 0 when nothing to clean (no git commit)
      - Preserves pending proposals (mixed status filtering)
      - Verifies commit message includes correct count

## Group 4: Integration

### T-4.1: Public API exports
- **File:** `src/index.ts`
- **Test:** n/a (verified by T-4.2 compilation)
- **Dependencies:** T-1.1, T-2.1, T-2.2, T-2.3, T-3.1, T-3.2, T-3.3
- **Description:**
  Add F-007 export block to `src/index.ts` following existing section pattern:
  ```typescript
  // F-007: Proposal confirmation flow
  export type { PendingResult, ConfirmResult, RejectResult, BulkResult } from "./confirmation";
  export {
    proposalToLearning,
    getPendingProposals,
    acceptProposal,
    rejectProposal,
    acceptAllProposals,
    rejectAllProposals,
    cleanRejected,
  } from "./confirmation";
  ```

### T-4.2: Full test suite verification [T]
- **File:** all test files
- **Test:** `bun test`
- **Dependencies:** T-4.1
- **Description:**
  Run `bun test` and verify:
  1. All new F-007 tests pass (~30 tests)
  2. All existing tests pass (no regressions)
  3. TypeScript compilation clean (no type errors)
  4. Total test count validates (~30 new + existing)

## Execution Order

```
T-1.1  (foundation — no deps)
  │
  ├──> T-1.2  (pure tests)     ──┐
  │                                │
  └──> T-2.1  (getPending)     ──┤  [parallel]
                                   │
       T-2.2  (accept)  <─────────┤
       T-2.3  (reject)  <─────────┘  [parallel: T-2.2, T-2.3]
         │       │
         │       ├──> T-3.2  (rejectAll)  ──┐
         │       └──> T-3.3  (cleanRej)  ───┤  [parallel: T-3.1, T-3.2, T-3.3]
         │                                    │
         └──────> T-3.1  (acceptAll)  ───────┘
                          │
                          └──> T-4.1  (exports)
                                 │
                                 └──> T-4.2  (full suite)
```

**Critical path:** T-1.1 → T-2.1 → T-2.2 → T-3.1 → T-4.1 → T-4.2

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 10 |
| Parallelizable | 6 (T-1.2‖T-2.1, T-2.2‖T-2.3, T-3.1‖T-3.2‖T-3.3) |
| New files | 2 (`src/confirmation.ts`, `tests/confirmation.test.ts`) |
| Modified files | 1 (`src/index.ts`) |
| Estimated tests | ~30 |
