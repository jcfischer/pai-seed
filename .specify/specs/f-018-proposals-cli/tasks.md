---
id: "F-018"
feature: "Proposals and learnings CLI"
phase: "tasks"
created: "2026-02-01"
---

# Tasks: Proposals and Learnings CLI

## T-1: ID prefix resolution utility

**File:** `src/id-prefix.ts` (new), `tests/id-prefix.test.ts` (new)

- [ ] `resolveIdPrefix(items, prefix, minLength=4)` pure function
- [ ] Returns `{ok: true, id}` on unique match
- [ ] Returns error on: no match, ambiguous, prefix too short
- [ ] Export from `src/index.ts`
- [ ] Tests: unique, ambiguous, not found, too short, exact full ID match

**depends:** none

## T-2: Output formatting functions

**File:** `src/cli.ts` (additions)

- [ ] `formatProposalCompact(p)` — short ID, type badge, truncated content
- [ ] `formatProposalVerbose(p)` — full detail block
- [ ] `formatLearningCompact(l, type)` — short ID, type badge, content, age
- [ ] `formatLearningVerbose(l, type)` — full detail block
- [ ] `formatTableHeader(columns)` — header row + separator
- [ ] Type badge coloring: pattern=blue, insight=green, self_knowledge=yellow

**depends:** none

## T-3: `proposals` subcommand dispatcher

**File:** `src/cli.ts` (additions)

- [ ] `cmdProposals(args)` function dispatching to list/accept/reject/review/accept-all/reject-all/clean
- [ ] `proposals list [--verbose]` — calls getPendingProposals, formats output
- [ ] `proposals accept <prefix>` — resolves ID, calls acceptProposal
- [ ] `proposals reject <prefix>` — resolves ID, calls rejectProposal
- [ ] `proposals accept-all` — calls acceptAllProposals
- [ ] `proposals reject-all` — calls rejectAllProposals
- [ ] `proposals clean` — calls cleanRejected
- [ ] Sub-help when no action given
- [ ] Wire into main() switch

**depends:** T-1, T-2

## T-4: `learnings` subcommand dispatcher

**File:** `src/cli.ts` (additions)

- [ ] `cmdLearnings(args)` function dispatching to list/show/search
- [ ] `learnings list [--type=X] [--verbose]` — loads seed, filters, formats
- [ ] `learnings show <prefix>` — resolves ID across all learning arrays, shows detail
- [ ] `learnings search <query>` — case-insensitive content search, highlights match
- [ ] Sub-help when no action given
- [ ] Wire into main() switch

**depends:** T-1, T-2

## T-5: Interactive review mode

**File:** `src/cli.ts` (additions)

- [ ] `proposals review` — interactive loop through pending proposals
- [ ] Raw mode stdin for single-keypress (a/r/s/q)
- [ ] Fallback to line-based input if raw mode unavailable
- [ ] Collect decisions, apply in single batch at end
- [ ] Print summary tally
- [ ] Single git commit

**depends:** T-2, T-3

## T-6: Help text and integration tests

**File:** `src/cli.ts` (update), `tests/cli-proposals.test.ts` (new), `tests/cli-learnings.test.ts` (new)

- [ ] Update printHelp() with proposals/learnings subcommands
- [ ] Tests for proposals list/accept/reject with temp seed files
- [ ] Tests for learnings list/show/search with temp seed files
- [ ] Test edge cases: empty state, not found, ambiguous

**depends:** T-3, T-4, T-5
