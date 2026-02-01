# Documentation Updates: F-007 Proposal Confirmation Flow

**Feature:** F-007
**Date:** 2026-02-01

## What Was Created

### New Source Files

| File | Purpose |
|------|---------|
| `src/confirmation.ts` | `proposalToLearning()`, `addLearningToCategory()`, `getPendingProposals()`, `acceptProposal()`, `rejectProposal()`, `acceptAllProposals()`, `rejectAllProposals()`, `cleanRejected()`, result types |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/confirmation.test.ts` | 30 | Pure helpers, type routing, single/bulk accept/reject, cleanup, error cases, git commits |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added F-007 type and function exports |

## Public API Additions

Exported from `src/index.ts`:

### Types
- `PendingResult` -- `{ ok: true; proposals: Proposal[]; count: number }` or `{ ok: false; error: string }`
- `ConfirmResult` -- `{ ok: true; learning: Learning }` or `{ ok: false; error: string }`
- `RejectResult` -- `{ ok: true }` or `{ ok: false; error: string }`
- `BulkResult` -- `{ ok: true; count: number }` or `{ ok: false; error: string }`

### Functions
- `proposalToLearning(proposal: Proposal): Learning` -- Pure: convert proposal to confirmed learning entry
- `addLearningToCategory(config: SeedConfig, learning: Learning, type: Proposal["type"]): void` -- Pure: route learning to correct `learned.*` array (mutates in place)
- `getPendingProposals(seedPath?: string): Promise<PendingResult>` -- Read-only: list pending proposals sorted by extractedAt
- `acceptProposal(proposalId: string, seedPath?: string): Promise<ConfirmResult>` -- Accept single proposal, move to learned category, git commit
- `rejectProposal(proposalId: string, seedPath?: string): Promise<RejectResult>` -- Reject single proposal, mark as rejected, git commit
- `acceptAllProposals(seedPath?: string): Promise<BulkResult>` -- Accept all pending, single git commit
- `rejectAllProposals(seedPath?: string): Promise<BulkResult>` -- Reject all pending, single git commit
- `cleanRejected(seedPath?: string): Promise<BulkResult>` -- Remove rejected proposals from state, git commit

## Design Decisions

### Type Routing
- `"pattern"` proposals route to `config.learned.patterns`
- `"insight"` proposals route to `config.learned.insights`
- `"self_knowledge"` proposals route to `config.learned.selfKnowledge`

### Accepted Proposals Are Removed (Not Marked)
- Accepted proposals are deleted from `state.proposals` entirely
- No "accepted" status is used -- the Learning entry in `learned.*` is the record of acceptance
- This prevents unbounded growth of the proposals array

### Error Cases Return ok:false (Never Throw)
- All I/O functions wrap in try/catch, returning `{ ok: false, error }` on any failure
- Specific error messages for "not found" and "already rejected" cases
- Load failures propagated from `loadSeedWithGit()`

### Bulk Operations Skip Write When Empty
- `acceptAllProposals`, `rejectAllProposals`, and `cleanRejected` return `{ ok: true, count: 0 }` without writing when there's nothing to process
- This avoids unnecessary git commits

## No External Documentation Changes

F-007 is a library layer. CLI documentation will come with F-011.
