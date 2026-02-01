---
id: "F-007"
feature: "Proposal confirmation flow"
status: "draft"
created: "2026-02-01"
depends_on: ["F-005", "F-006", "F-003"]
---

# Specification: Proposal Confirmation Flow

## Overview

Provide functions that present pending proposals to the user and process their accept/reject decisions. Accepted proposals move to the `learned` section of seed.json. Rejected proposals are marked as rejected. Changes are committed via git.

This is a library layer — it provides confirmation logic functions. The actual UI presentation (via Claude Code's AskUserQuestion) is handled by the calling hook/CLI. F-007 provides the data operations: listing pending proposals, accepting individual proposals (moving them to the correct learned category), rejecting proposals, and bulk operations.

## User Scenarios

### Scenario 1: Accepting a proposal

**As a** user reviewing pending proposals
**I want** to accept a learning candidate
**So that** it becomes part of my AI's permanent knowledge

**Acceptance Criteria:**
- [ ] `acceptProposal(proposalId, seedPath?)` moves the proposal to the learned section
- [ ] Proposal type determines target category: pattern → learned.patterns, insight → learned.insights, self_knowledge → learned.selfKnowledge
- [ ] The new Learning entry has `confirmed: true` and `confirmedAt` set
- [ ] The proposal is removed from state.proposals
- [ ] Git commit with message: "Confirm: accepted proposal"
- [ ] Returns the created Learning entry

### Scenario 2: Rejecting a proposal

**As a** user reviewing pending proposals
**I want** to reject a learning candidate
**So that** it doesn't pollute my AI's knowledge

**Acceptance Criteria:**
- [ ] `rejectProposal(proposalId, seedPath?)` marks the proposal as rejected
- [ ] The proposal stays in state.proposals with `status: "rejected"`
- [ ] Git commit with message: "Reject: rejected proposal"
- [ ] Rejected proposals are excluded from future session context (F-005 already filters to pending only)

### Scenario 3: Listing pending proposals

**As a** system presenting proposals for review
**I want** to get all pending proposals
**So that** I can present them to the user

**Acceptance Criteria:**
- [ ] `getPendingProposals(seedPath?)` returns only pending proposals
- [ ] Returns empty array if no pending proposals
- [ ] Each proposal has id, type, content, source, extractedAt

### Scenario 4: Bulk operations

**As a** user who wants to quickly process all proposals
**I want** to accept or reject all at once
**So that** I don't have to process them one by one

**Acceptance Criteria:**
- [ ] `acceptAllProposals(seedPath?)` accepts all pending proposals
- [ ] `rejectAllProposals(seedPath?)` rejects all pending proposals
- [ ] Returns count of processed proposals
- [ ] Single git commit for the batch operation

### Scenario 5: Cleaning up old rejected proposals

**As a** system maintaining clean state
**I want** rejected proposals cleaned from state.proposals
**So that** the array doesn't grow unbounded

**Acceptance Criteria:**
- [ ] `cleanRejected(seedPath?)` removes all rejected proposals from state.proposals
- [ ] Git commit with "Cleanup: removed N rejected proposals"
- [ ] Returns count of removed proposals

## Functional Requirements

### FR-1: Get Pending Proposals

Provide `getPendingProposals(seedPath?: string): Promise<PendingResult>` that:

```typescript
type PendingResult =
  | { ok: true; proposals: Proposal[]; count: number }
  | { ok: false; error: string };
```

1. Load seed via `loadSeedWithGit(seedPath)`
2. Filter `state.proposals` to `status === "pending"`
3. Return proposals sorted by extractedAt (oldest first)

**Validation:** Unit test: with proposals, empty, mixed statuses.

### FR-2: Accept Proposal

Provide `acceptProposal(proposalId: string, seedPath?: string): Promise<ConfirmResult>` that:

```typescript
type ConfirmResult =
  | { ok: true; learning: Learning }
  | { ok: false; error: string };
```

1. Load seed via `loadSeedWithGit(seedPath)`
2. Find proposal by ID in `state.proposals`
3. If not found or not pending: return error
4. Create `Learning` entry from proposal:
   - `id`: keep same ID
   - `content`: keep same content
   - `source`: keep same source
   - `extractedAt`: keep same extractedAt
   - `confirmedAt`: current ISO datetime
   - `confirmed`: true
   - `tags`: empty array
5. Add Learning to correct category based on `proposal.type`:
   - `"pattern"` → `learned.patterns`
   - `"insight"` → `learned.insights`
   - `"self_knowledge"` → `learned.selfKnowledge`
6. Remove proposal from `state.proposals`
7. Write via `writeSeedWithCommit(config, "Confirm: accepted '{content}'")`
8. Return the created Learning

**Validation:** Unit test: accept each type, not found, already accepted/rejected.

### FR-3: Reject Proposal

Provide `rejectProposal(proposalId: string, seedPath?: string): Promise<RejectResult>` that:

```typescript
type RejectResult =
  | { ok: true }
  | { ok: false; error: string };
```

1. Load seed via `loadSeedWithGit(seedPath)`
2. Find proposal by ID in `state.proposals`
3. If not found or not pending: return error
4. Set `proposal.status = "rejected"`
5. Write via `writeSeedWithCommit(config, "Reject: rejected '{content}'")`

**Validation:** Unit test: reject, not found, already rejected.

### FR-4: Accept All Proposals

Provide `acceptAllProposals(seedPath?: string): Promise<BulkResult>` that:

```typescript
type BulkResult =
  | { ok: true; count: number }
  | { ok: false; error: string };
```

1. Load seed via `loadSeedWithGit(seedPath)`
2. Filter to pending proposals
3. For each: create Learning, add to correct category, remove from proposals
4. Single `writeSeedWithCommit(config, "Confirm: accepted N proposals")`
5. Return count

**Validation:** Unit test: accept all, empty, mixed statuses.

### FR-5: Reject All Proposals

Provide `rejectAllProposals(seedPath?: string): Promise<BulkResult>` that:

1. Load seed via `loadSeedWithGit(seedPath)`
2. Filter to pending proposals
3. Set `status = "rejected"` on each
4. Single `writeSeedWithCommit(config, "Reject: rejected N proposals")`
5. Return count

**Validation:** Unit test: reject all, empty.

### FR-6: Clean Rejected

Provide `cleanRejected(seedPath?: string): Promise<BulkResult>` that:

1. Load seed via `loadSeedWithGit(seedPath)`
2. Filter `state.proposals` to remove rejected
3. If none removed: return `{ ok: true, count: 0 }` (no write)
4. Write via `writeSeedWithCommit(config, "Cleanup: removed N rejected proposals")`
5. Return count

**Validation:** Unit test: clean, nothing to clean, mixed statuses preserved.

## Non-Functional Requirements

- **Atomic operations:** Each accept/reject operates on a single load-modify-write cycle
- **Idempotent:** Accepting an already-accepted proposal returns error (doesn't double-add)
- **No side effects on read:** `getPendingProposals()` is read-only
- **Testability:** All functions accept path overrides. Tests use temp directories.
- **No new dependencies**

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| Proposal | Pending learning candidate | F-001 |
| Learning | Confirmed knowledge entry | F-001 |
| SeedConfig | Root config | F-001 |
| ConfirmResult | Result of accepting a proposal | New in F-007 |
| RejectResult | Result of rejecting a proposal | New in F-007 |
| BulkResult | Result of bulk operations | New in F-007 |
| PendingResult | Result of listing pending | New in F-007 |

## Success Criteria

- [ ] `getPendingProposals()` returns only pending proposals
- [ ] `acceptProposal()` moves proposal to correct learned category
- [ ] `rejectProposal()` marks proposal as rejected
- [ ] `acceptAllProposals()` processes all pending in one commit
- [ ] `rejectAllProposals()` rejects all pending in one commit
- [ ] `cleanRejected()` removes rejected proposals from state
- [ ] Learning entries have `confirmed: true` and `confirmedAt` set
- [ ] Type routing correct: pattern/insight/self_knowledge → right category
- [ ] Tests use temp directories
- [ ] Existing tests pass (no regressions)
- [ ] `bun test` passes all tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Proposals have unique IDs | ID collision | nanoid collision probability negligible |
| Single-user access | Concurrent proposal review | Lock file (future enhancement) |
| Proposals array fits in memory | Very large proposal count | F-009 compaction handles growth |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-001 | `Proposal`, `Learning`, `SeedConfig` types | Type shapes |
| F-003 | `loadSeedWithGit()`, `writeSeedWithCommit()` | Load/write behavior |
| F-005 | `formatProposals()` already filters to pending | Presentation layer |
| F-006 | Writes proposals to state.proposals | Proposal source |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|------|
| F-011 CLI | All confirmation functions | `pai-seed confirm` command |
| PAI hooks | `getPendingProposals()`, `acceptProposal()` | Session start confirmation |

## Out of Scope

- UI presentation (AskUserQuestion handled by caller)
- Partial accept (accept some, reject others in one call — use individual functions)
- Proposal editing (accept as-is or reject)
- Learning decay/freshness (F-015)
