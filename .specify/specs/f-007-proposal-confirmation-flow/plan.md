# Technical Plan: Proposal Confirmation Flow (F-007)

## Architecture Overview

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  Caller (hook/CLI)   │────>│  confirmation.ts      │────>│  git.ts      │
│  AskUserQuestion UI  │     │  (F-007 library)      │     │  (F-003)     │
│  pai-seed confirm    │     │                        │     │              │
└──────────────────────┘     │  getPendingProposals() │     │ loadSeedWith │
                              │  acceptProposal()      │────>│   Git()      │
                              │  rejectProposal()      │     │ writeSeedWith│
                              │  acceptAllProposals()   │     │   Commit()   │
                              │  rejectAllProposals()   │     └──────────────┘
                              │  cleanRejected()        │
                              └──────────────────────┘
                                        │
                                        │ type routing
                                        ▼
                              ┌──────────────────────┐
                              │  seed.json            │
                              │                        │
                              │  state.proposals[]     │  ← read/remove
                              │  learned.patterns[]    │  ← write (pattern)
                              │  learned.insights[]    │  ← write (insight)
                              │  learned.selfKnowledge│  ← write (self_knowledge)
                              └──────────────────────┘
```

F-007 is a **pure library layer**. It provides data operations only. The caller (F-011 CLI or PAI hooks) handles UI presentation via `AskUserQuestion`. This matches the extraction.ts (F-006) pattern: pure functions + I/O functions, no UI concerns.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Types | Zod-inferred from schema.ts | Reuse existing `Proposal`, `Learning`, `SeedConfig` |
| I/O | `loadSeedWithGit()`, `writeSeedWithCommit()` from git.ts | Established atomic load/write with git commits |
| IDs | Reuse proposal IDs | Proposals already have nanoid-generated IDs; no new ID generation needed |
| Testing | `bun:test` with temp dirs | Matches extraction.test.ts, git.test.ts patterns |

**No new dependencies.** Everything builds on F-001 (types), F-003 (git ops).

## Data Model

### Existing Types (no changes)

```typescript
// From schema.ts — unchanged
type Proposal = {
  id: string;
  type: "pattern" | "insight" | "self_knowledge";
  content: string;
  source: string;
  extractedAt: string;   // ISO datetime
  status: "pending" | "accepted" | "rejected";
};

type Learning = {
  id: string;
  content: string;
  source: string;
  extractedAt: string;   // ISO datetime
  confirmedAt?: string;  // ISO datetime
  confirmed: boolean;
  tags: string[];
};
```

### New Result Types (confirmation.ts)

```typescript
type PendingResult =
  | { ok: true; proposals: Proposal[]; count: number }
  | { ok: false; error: string };

type ConfirmResult =
  | { ok: true; learning: Learning }
  | { ok: false; error: string };

type RejectResult =
  | { ok: true }
  | { ok: false; error: string };

type BulkResult =
  | { ok: true; count: number }
  | { ok: false; error: string };
```

These follow the project's established discriminated union pattern: `{ ok: true; ...data } | { ok: false; error: string }`.

### Type Routing Map

| Proposal.type | Target Array | Access Path |
|---------------|-------------|-------------|
| `"pattern"` | `learned.patterns` | `config.learned.patterns` |
| `"insight"` | `learned.insights` | `config.learned.insights` |
| `"self_knowledge"` | `learned.selfKnowledge` | `config.learned.selfKnowledge` |

### Proposal → Learning Conversion

```typescript
// Pure helper function
function proposalToLearning(proposal: Proposal): Learning {
  return {
    id: proposal.id,           // reuse ID
    content: proposal.content,
    source: proposal.source,
    extractedAt: proposal.extractedAt,
    confirmedAt: new Date().toISOString(),
    confirmed: true,
    tags: [],                   // empty initially
  };
}
```

## Implementation Phases

### Phase 1: Pure helpers

**Files:** `src/confirmation.ts`

1. `proposalToLearning(proposal: Proposal): Learning` — converts proposal to learning entry
2. `addLearningToCategory(config: SeedConfig, learning: Learning, type: Proposal["type"]): void` — pushes learning to the correct `learned.*` array (mutates in place, matching existing patterns)
3. Export result types: `PendingResult`, `ConfirmResult`, `RejectResult`, `BulkResult`

**Test:** Unit test pure functions with mock data. No I/O, no git.

### Phase 2: Read operation

**Files:** `src/confirmation.ts`

1. `getPendingProposals(seedPath?: string): Promise<PendingResult>`
   - Load via `loadSeedWithGit(seedPath)`
   - Filter `state.proposals` where `status === "pending"`
   - Sort by `extractedAt` ascending (oldest first)
   - Return `{ ok: true, proposals, count }`

**Test:** With temp dir + git. Test: has pending, empty, mixed statuses.

### Phase 3: Single operations

**Files:** `src/confirmation.ts`

1. `acceptProposal(proposalId: string, seedPath?: string): Promise<ConfirmResult>`
   - Load → find → validate pending → convert → route to category → remove from proposals → commit
   - Commit message: `"Confirm: accepted '{truncated content}'"`

2. `rejectProposal(proposalId: string, seedPath?: string): Promise<RejectResult>`
   - Load → find → validate pending → set status rejected → commit
   - Commit message: `"Reject: rejected '{truncated content}'"`

**Test:** Accept each type (pattern/insight/self_knowledge), reject, error cases (not found, already processed).

### Phase 4: Bulk operations

**Files:** `src/confirmation.ts`

1. `acceptAllProposals(seedPath?: string): Promise<BulkResult>`
   - Load → filter pending → convert all → route each → remove all from proposals → single commit
   - Commit: `"Confirm: accepted N proposals"`

2. `rejectAllProposals(seedPath?: string): Promise<BulkResult>`
   - Load → filter pending → mark all rejected → single commit
   - Commit: `"Reject: rejected N proposals"`

3. `cleanRejected(seedPath?: string): Promise<BulkResult>`
   - Load → filter out rejected → if none: return count 0, no write → else commit
   - Commit: `"Cleanup: removed N rejected proposals"`

**Test:** Bulk operations, empty arrays, mixed status preservation.

### Phase 5: Integration

**Files:** `src/index.ts`

1. Add F-007 export block to `src/index.ts` (following existing section pattern)
2. Run full test suite: `bun test`
3. Verify no regressions

## File Structure

```
src/
├── confirmation.ts          # NEW — all F-007 logic (6 public functions + 2 helpers)
├── schema.ts                # UNCHANGED — types already sufficient
├── index.ts                 # MODIFIED — add F-007 export section
├── git.ts                   # UNCHANGED — consumed as dependency
├── loader.ts                # UNCHANGED — consumed via git.ts
├── extraction.ts            # UNCHANGED — F-006
├── session.ts               # UNCHANGED — F-005
├── setup.ts                 # UNCHANGED — F-004
├── events.ts                # UNCHANGED — F-008
├── defaults.ts              # UNCHANGED
├── merge.ts                 # UNCHANGED
└── validate.ts              # UNCHANGED

tests/
├── confirmation.test.ts     # NEW — F-007 tests (~25-30 tests)
├── extraction.test.ts       # UNCHANGED
├── git.test.ts              # UNCHANGED
├── loader.test.ts           # UNCHANGED
├── schema.test.ts           # UNCHANGED
├── validate.test.ts         # UNCHANGED
├── setup.test.ts            # UNCHANGED
└── events.test.ts           # UNCHANGED
```

**Only 2 new files, 1 modified file.** No schema changes, no new dependencies.

## API Contracts

All functions follow the same `seedPath?` override pattern used by F-003 through F-008:

| Function | Input | Output | Side Effects |
|----------|-------|--------|-------------|
| `getPendingProposals(seedPath?)` | optional path | `PendingResult` | Read-only (git init if needed) |
| `acceptProposal(id, seedPath?)` | proposal ID + optional path | `ConfirmResult` | Writes seed.json, git commit |
| `rejectProposal(id, seedPath?)` | proposal ID + optional path | `RejectResult` | Writes seed.json, git commit |
| `acceptAllProposals(seedPath?)` | optional path | `BulkResult` | Writes seed.json, git commit |
| `rejectAllProposals(seedPath?)` | optional path | `BulkResult` | Writes seed.json, git commit |
| `cleanRejected(seedPath?)` | optional path | `BulkResult` | Writes seed.json, git commit (if any removed) |

### Error Cases

| Scenario | Function | Response |
|----------|----------|----------|
| Proposal not found | accept/reject | `{ ok: false, error: "Proposal 'xxx' not found" }` |
| Proposal not pending | accept/reject | `{ ok: false, error: "Proposal 'xxx' is already rejected" }` |
| No pending proposals | bulk accept/reject | `{ ok: true, count: 0 }` (success, not error) |
| No rejected to clean | cleanRejected | `{ ok: true, count: 0 }` (no write) |
| Seed load failure | any | `{ ok: false, error: loadResult.error.message }` |

## Dependencies

### Internal (existing, no changes)

| Module | Import | Used By |
|--------|--------|---------|
| `schema.ts` | `Proposal`, `Learning`, `SeedConfig` types | Type annotations |
| `git.ts` | `loadSeedWithGit()`, `writeSeedWithCommit()` | All I/O functions |

### External (none new)

No new npm packages. The feature uses only:
- `zod` (existing) — indirectly through schema types
- `nanoid` (existing) — NOT needed; proposal IDs are reused

### Test Dependencies

| Module | Import | Used By |
|--------|--------|---------|
| `bun:test` | `describe`, `test`, `expect`, `beforeEach`, `afterEach` | Test framework |
| `node:fs/promises` | `mkdtemp`, `rm` | Temp directory lifecycle |
| `node:os` | `tmpdir` | Temp directory base path |
| `defaults.ts` | `createDefaultSeed()` | Test fixture creation |
| `loader.ts` | `writeSeed()` | Test setup (write initial seed) |

## Test Strategy

### Test Structure (matching extraction.test.ts pattern)

```typescript
// tests/confirmation.test.ts

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirmation-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Reusable helper
function makeProposal(overrides?: Partial<Proposal>): Proposal {
  return {
    id: nanoid(),
    type: "pattern",
    content: "You prefer TypeScript",
    source: "session-123",
    extractedAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}
```

### Test Groups (~25-30 tests)

| Group | Tests | Type |
|-------|-------|------|
| `proposalToLearning` | 3 | Pure — conversion, confirmedAt set, tags empty |
| `addLearningToCategory` | 3 | Pure — pattern/insight/self_knowledge routing |
| `getPendingProposals` | 4 | I/O — has pending, empty, mixed statuses, load failure |
| `acceptProposal` | 6 | I/O — each type, not found, already accepted, already rejected, git commit |
| `rejectProposal` | 4 | I/O — success, not found, already rejected, git commit |
| `acceptAllProposals` | 3 | I/O — all pending, empty, mixed statuses |
| `rejectAllProposals` | 3 | I/O — all pending, empty |
| `cleanRejected` | 4 | I/O — has rejected, none to clean, mixed preserved, no write when empty |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Proposal status enum mismatch (spec says "accepted" but existing code uses "pending"/"rejected" only) | Medium | Low | Spec FR-2 step 6 removes accepted proposals from `state.proposals` entirely rather than changing status — no "accepted" status needed in practice. The proposal is deleted from state, not marked. |
| Content truncation in commit messages | Low | Medium | Truncate content to ~50 chars in commit messages to avoid overly long git messages. Use `content.slice(0, 50)` pattern. |
| Race condition: two callers accept same proposal | Medium | Low | Spec acknowledges single-user assumption. Each operation is atomic load-modify-write. Future: lock file (out of scope). |
| `writeSeedWithCommit` git failure doesn't fail write | Low | Low | This is existing behavior by design (git is best-effort). F-007 inherits this. |
| Proposal array mutation between load and write | Low | Very Low | Single load-modify-write cycle per operation. No async gaps between mutation and write. |

## Commit Message Conventions

Following existing patterns from git.ts:

| Operation | Commit Message Pattern |
|-----------|----------------------|
| Accept single | `"Confirm: accepted 'You prefer TypeScript...'"` |
| Reject single | `"Reject: rejected 'You prefer TypeScript...'"` |
| Accept all | `"Confirm: accepted 3 proposals"` |
| Reject all | `"Reject: rejected 3 proposals"` |
| Clean rejected | `"Cleanup: removed 2 rejected proposals"` |

Note: `writeSeedWithCommit` appends `"Automated by pai-seed"` trailer automatically.

## index.ts Export Addition

```typescript
// =============================================================================
// F-007: Proposal confirmation flow
// =============================================================================

// Types
export type { PendingResult, ConfirmResult, RejectResult, BulkResult } from "./confirmation";

// Functions
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
