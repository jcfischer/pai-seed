---
id: "F-018"
feature: "Proposals and learnings CLI"
phase: "plan"
created: "2026-02-01"
---

# Technical Plan: Proposals and Learnings CLI

## Architecture Decision

**Thin CLI layer.** All business logic exists in F-007 (`confirmation.ts`) and F-002 (`loader.ts`). F-018 adds:
1. A pure `resolveIdPrefix()` utility
2. Formatting functions for compact/verbose output
3. Two dispatcher functions (`cmdProposals`, `cmdLearnings`) wired into the existing `main()` switch
4. An interactive review loop using stdin

No new modules. All additions go into `src/cli.ts` (dispatcher + formatting) and a small `src/id-prefix.ts` (pure utility).

## Data Flow

```
User command
     │
     ▼
main() switch ──→ cmdProposals(args) ──→ resolveIdPrefix()
     │                   │                      │
     │                   ▼                      ▼
     │            F-007 functions         Match single ID
     │            (accept/reject/         or return error
     │             getPending/bulk)
     │
     └──────────→ cmdLearnings(args) ──→ loadSeed()
                         │                    │
                         ▼                    ▼
                   Filter/search         Return config
                   Format output
```

## File Changes

| File | Change | Scope |
|------|--------|-------|
| `src/id-prefix.ts` | **New** — `resolveIdPrefix()` pure function | ~30 lines |
| `src/cli.ts` | Add `cmdProposals()`, `cmdLearnings()`, formatters, update help | ~250 lines |
| `src/index.ts` | Export new public functions | 2 lines |
| `tests/id-prefix.test.ts` | **New** — prefix resolution tests | ~60 lines |
| `tests/cli-proposals.test.ts` | **New** — proposals subcommand tests | ~150 lines |
| `tests/cli-learnings.test.ts` | **New** — learnings subcommand tests | ~100 lines |

## Key Design Decisions

### 1. ID Prefix Resolution (pure function)

```typescript
type IdPrefixResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function resolveIdPrefix(items: Array<{id: string}>, prefix: string, minLength?: number): IdPrefixResult
```

- Minimum 4 chars (configurable)
- Returns exact match, ambiguous error, or not-found error
- Works for both proposals and learnings

### 2. Interactive Review (stdin reader)

Use Bun's `process.stdin` in raw mode for single-keypress input:
```typescript
process.stdin.setRawMode(true);
```
Fall back to line-based input if raw mode unavailable (piped stdin).

Collect decisions in memory, apply all at end in single load-modify-write cycle.

### 3. Output Formatting

Reuse existing `ansi` helpers from cli.ts. Add:
- `formatProposalCompact(p: Proposal): string` — one-line table row
- `formatProposalVerbose(p: Proposal): string` — multi-line detail block
- `formatLearningCompact(l: Learning, type: string): string`
- `formatLearningVerbose(l: Learning, type: string): string`
- `formatTableHeader(columns: string[]): string` — header + separator

### 4. No `--json` for v1

Keep it simple. JSON output can be added later if needed for scripting.

## Failure Mode Analysis

| Failure | Impact | Mitigation |
|---------|--------|------------|
| Ambiguous ID prefix | User confusion | Clear error listing all matches |
| Empty proposals | Wasted command | Clean "No pending proposals" message |
| Raw mode unavailable | Review command breaks | Detect and fall back to line input |
| Concurrent modification during review | Lost changes | Single load-modify-write at end |

## Constitutional Compliance

- **No new dependencies**: Uses only Bun built-ins
- **Testability**: Pure formatting functions, pure ID resolution
- **CLI-first**: All operations work from terminal
- **Non-destructive reads**: list/show/search don't modify seed.json
