# Documentation Updates: F-005 Session Start Hook

**Feature:** F-005
**Date:** 2026-02-01

## What Was Created

### New Source Files

| File | Purpose |
|------|---------|
| `src/session.ts` | `formatIdentitySummary()`, `formatLearningSummary()`, `formatProposals()`, `formatSessionState()`, `generateSessionContext()`, `sessionStartHook()` |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/session.test.ts` | 26 | Pure formatters, context generation with full/complement modes, hook entry point |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added F-005 type and function exports |

## Public API Additions

Exported from `src/index.ts` (appended to F-001/F-002/F-003/F-004 exports):

### Types
- `SessionContext` -- Discriminated union: `{ ok: true; context; needsSetup; config; proposalCount }` or `{ ok: false; error }`
- `SessionContextOptions` -- `{ mode?: ContextMode }`
- `ContextMode` -- `"full" | "complement"`

### Functions
- `formatIdentitySummary(identity: IdentityLayer): string` -- Pure: identity text
- `formatLearningSummary(learned: LearnedLayer): string` -- Pure: learning counts and recent items (truncated at 5)
- `formatProposals(proposals: Proposal[]): string` -- Pure: numbered pending proposals
- `formatSessionState(state: StateLayer): string` -- Pure: session state text
- `generateSessionContext(seedPath?, options?): Promise<SessionContext>` -- Orchestrator with full/complement mode
- `sessionStartHook(seedPath?, options?): Promise<string>` -- Thin entry point for hook scripts

## Design Decision: Configurable Mode

- **`"full"` mode**: Outputs identity + learnings + proposals + state. For standalone use without PAI.
- **`"complement"` mode**: Outputs learnings + proposals + state only. Skips identity (already handled by PAI's LoadContext.hook.ts).
- **Auto-detection**: If `process.env.PAI_DIR` is set, defaults to complement. Otherwise defaults to full.

## No External Documentation Changes

F-005 is a library layer for session context formatting. No README or user-facing documentation needed yet. CLI documentation will come with F-011.
