---
id: "F-018"
feature: "Proposals and learnings CLI"
status: "draft"
created: "2026-02-01"
depends_on: ["F-007", "F-011"]
---

# Specification: Proposals and Learnings CLI

## Overview

Add `proposals` and `learnings` subcommand groups to the `pai-seed` CLI, making all seed.json content browsable and manageable from the terminal. Currently `pai-seed show` only displays counts. Users cannot view individual proposals, accept/reject them, or browse confirmed learnings without reading raw JSON.

This is a thin CLI layer over F-007's confirmation functions and F-002's loader. All business logic already exists.

## User Scenarios

### Scenario 1: List pending proposals

**As a** user returning from several sessions
**I want to** see what proposals have been extracted
**So that** I can decide which to accept or reject

**Acceptance Criteria:**
- [ ] `pai-seed proposals list` shows all pending proposals in compact table format
- [ ] Each row: short ID (8 chars), type badge, first 60 chars of content
- [ ] `--verbose` flag shows full content, source, date, and method per proposal
- [ ] Empty state: prints "No pending proposals" and exits 0
- [ ] Exit code 0 on success, 1 on error

### Scenario 2: Accept a proposal

**As a** user who reviewed a proposal
**I want to** accept it by short ID prefix
**So that** it becomes a confirmed learning

**Acceptance Criteria:**
- [ ] `pai-seed proposals accept <id-prefix>` accepts matching proposal
- [ ] Short ID prefix matching (minimum 4 chars, like git)
- [ ] Prints confirmation: type, content preview, "accepted as [type]"
- [ ] If prefix matches multiple proposals: error with "Ambiguous ID, matches: ..."
- [ ] If no match: error with "No proposal matching '<prefix>'"
- [ ] Exit code 0 on success, 1 on error

### Scenario 3: Reject a proposal

**As a** user who reviewed a proposal
**I want to** reject it
**So that** it doesn't become a learning

**Acceptance Criteria:**
- [ ] `pai-seed proposals reject <id-prefix>` rejects matching proposal
- [ ] Same short ID prefix matching as accept
- [ ] Prints confirmation: "Rejected: <content preview>"
- [ ] Exit code 0 on success, 1 on error

### Scenario 4: Interactive review

**As a** user with multiple pending proposals
**I want to** step through them one by one
**So that** I can efficiently process the queue

**Acceptance Criteria:**
- [ ] `pai-seed proposals review` enters interactive mode
- [ ] Shows each proposal with full detail (type, content, source, date)
- [ ] Prompts: [a]ccept / [r]eject / [s]kip / [q]uit
- [ ] Prints running tally: "3 accepted, 1 rejected, 2 skipped"
- [ ] Single git commit at end for all changes
- [ ] If no pending proposals: prints "No proposals to review" and exits 0

### Scenario 5: List confirmed learnings

**As a** user who wants to see what PAI has learned
**I want to** browse confirmed learnings with filters
**So that** I can verify and manage PAI's knowledge

**Acceptance Criteria:**
- [ ] `pai-seed learnings list` shows all confirmed learnings
- [ ] `--type=pattern|insight|self_knowledge` filters by type
- [ ] Compact table: short ID, type badge, first 60 chars, age
- [ ] `--verbose` shows full content, source, extractedAt, confirmedAt, tags
- [ ] Empty state: "No learnings found" and exit 0

### Scenario 6: Show individual learning

**As a** user investigating a specific learning
**I want to** see its full details
**So that** I can understand its origin and context

**Acceptance Criteria:**
- [ ] `pai-seed learnings show <id-prefix>` displays full detail for one learning
- [ ] Shows: type, content (full), source, extractedAt, confirmedAt, tags
- [ ] Same short ID prefix matching as proposals

### Scenario 7: Search learnings

**As a** user looking for specific knowledge
**I want to** search across all learning content
**So that** I can find relevant items quickly

**Acceptance Criteria:**
- [ ] `pai-seed learnings search <query>` searches content case-insensitively
- [ ] Returns matching learnings in compact format
- [ ] Highlights matching portion in output
- [ ] If no matches: "No learnings matching '<query>'" and exit 0

### Scenario 8: Bulk proposal operations

**As a** user who trusts the extraction quality
**I want to** accept or reject all proposals at once
**So that** I can quickly clear the queue

**Acceptance Criteria:**
- [ ] `pai-seed proposals accept-all` accepts all pending proposals
- [ ] `pai-seed proposals reject-all` rejects all pending proposals
- [ ] Both print count: "Accepted 9 proposals" / "Rejected 9 proposals"
- [ ] `pai-seed proposals clean` removes rejected proposals from state
- [ ] Each is a single git commit

## Functional Requirements

### FR-1: `proposals` subcommand group

Entry point: `pai-seed proposals <action> [args] [flags]`

| Action | Args | Flags | Library function |
|--------|------|-------|-----------------|
| `list` | — | `--verbose` | `getPendingProposals()` |
| `accept` | `<id-prefix>` | — | `acceptProposal(resolvedId)` |
| `reject` | `<id-prefix>` | — | `rejectProposal(resolvedId)` |
| `review` | — | — | Interactive loop over `getPendingProposals()` |
| `accept-all` | — | — | `acceptAllProposals()` |
| `reject-all` | — | — | `rejectAllProposals()` |
| `clean` | — | — | `cleanRejected()` |

**Validation:** Unit test each action. Integration test for `review` interactive flow.

### FR-2: `learnings` subcommand group

Entry point: `pai-seed learnings <action> [args] [flags]`

| Action | Args | Flags | Library function |
|--------|------|-------|-----------------|
| `list` | — | `--type=<type>`, `--verbose` | `loadSeed()` → filter |
| `show` | `<id-prefix>` | — | `loadSeed()` → find by ID |
| `search` | `<query>` | `--type=<type>` | `loadSeed()` → filter content |

**Validation:** Unit test each action with various filter combinations.

### FR-3: Short ID prefix resolution

Implement `resolveIdPrefix(proposals: Array<{id: string}>, prefix: string)`:

1. Minimum prefix length: 4 characters
2. Filter items whose ID starts with prefix
3. If exactly 1 match: return the full ID
4. If 0 matches: return error "No item matching '<prefix>'"
5. If multiple matches: return error "Ambiguous prefix '<prefix>', matches: <id1>, <id2>, ..."

**Validation:** Unit test: unique match, no match, ambiguous, too-short prefix.

### FR-4: Output formatting

**Compact table format** (default):
```
ID       Type          Content
────────────────────────────────────────────────────────────────
gDo_K4_n  pattern      User prefers explicit TypeScript types over in...
VzpNopnP  insight      Bun is significantly faster than Node for this...
```

**Verbose format** (`--verbose`):
```
── gDo_K4_nHDvrFhoORY7WJ ──────────────────────────────────
Type:      pattern
Content:   User prefers explicit TypeScript types over inferred types
Source:    session-2026-02-01
Extracted: 2026-02-01 10:22
Method:    regex
```

**Type badges** in compact mode:
- `pattern` → `pattern` (blue if ANSI)
- `insight` → `insight` (green)
- `self_knowledge` → `self-know` (yellow, abbreviated to fit)

### FR-5: Interactive review loop

For `pai-seed proposals review`:

1. Load all pending proposals via `getPendingProposals()`
2. If empty, print message and exit 0
3. For each proposal, display full detail and prompt:
   ```
   [1/9] pattern — gDo_K4_n
   User prefers explicit TypeScript types over inferred types
   Source: session-2026-02-01 | Extracted: 2026-02-01 10:22

   [a]ccept  [r]eject  [s]kip  [q]uit >
   ```
4. Read single character from stdin (no Enter required if possible, else read line)
5. Track decisions in memory
6. On quit or end: apply all decisions in one load-modify-write cycle
7. Print summary: "5 accepted, 2 rejected, 2 skipped"
8. Single git commit: "Review: accepted 5, rejected 2 proposals"

### FR-6: Help text updates

Update `printHelp()` to include:
```
  proposals <action>        Manage pending proposals
  learnings <action>        Browse confirmed learnings
```

And show sub-help when running `pai-seed proposals` or `pai-seed learnings` without action.

## Non-Functional Requirements

- **No new dependencies**: Use Bun native stdio, existing ANSI helpers
- **Read-only safety**: `list`, `show`, `search` commands must not modify seed.json
- **Startup < 200ms**: Same constraint as existing CLI
- **Consistent patterns**: Follow existing cli.ts patterns (ansi helpers, exit codes, error to stderr)
- **Testability**: All formatting functions are pure and unit-testable. ID resolution is a pure function.

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| Proposal | Pending learning candidate | F-001 schema |
| Learning | Confirmed knowledge entry | F-001 schema |
| IdPrefixResult | Resolved ID or error | New in F-018 |

## Success Criteria

- [ ] `pai-seed proposals list` displays pending proposals in compact table
- [ ] `pai-seed proposals accept <prefix>` accepts by short ID prefix
- [ ] `pai-seed proposals reject <prefix>` rejects by short ID prefix
- [ ] `pai-seed proposals review` steps through proposals interactively
- [ ] `pai-seed proposals accept-all` and `reject-all` work in bulk
- [ ] `pai-seed learnings list` shows confirmed learnings with type filter
- [ ] `pai-seed learnings show <prefix>` displays full detail
- [ ] `pai-seed learnings search <query>` finds matching learnings
- [ ] Short ID prefix resolution works (unique, ambiguous, not found)
- [ ] `--verbose` flag toggles detail level on list commands
- [ ] All existing tests pass (no regressions)
- [ ] New commands have unit tests

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Proposals fit in memory | Thousands of un-reviewed proposals | Count check, warn if > 100 |
| 8-char prefix is unique | Collision in nanoid prefixes | resolveIdPrefix handles ambiguity |
| Terminal supports ANSI | Piped output, dumb terminal | Detect via process.stdout.isTTY |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-001 | `Proposal`, `Learning`, `SeedConfig` types | Type shapes |
| F-002 | `loadSeed()` | Read path for learnings |
| F-007 | `acceptProposal()`, `rejectProposal()`, etc. | All mutation operations |
| F-011 | CLI framework, `main()` dispatcher, `ansi` helpers | Entry point, formatting |

### Downstream Consumers

| System | What They Expect | Breaking Change Threshold |
|--------|-----------------|--------------------------|
| User terminal | Stable subcommand names | Renaming commands |

## Out of Scope

- Editing proposal content before accepting
- Tagging learnings from CLI (future enhancement)
- Export/import learnings
- Proposal priority or scoring
- Web UI for review
