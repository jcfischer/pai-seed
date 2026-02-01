# F-020: Deliberate Capture + Review UX — Technical Plan

## Architecture Overview

```
CURRENT:
  learn <type> <content>  →  Learning directly added, git commit
  formatProposals()       →  Numbered list, no review suggestion

NEW:
  capture <type> <content>  →  Alias for learn, commit: "captured <type> via CLI"
  learn <type> <content>    →  Unchanged (backward compatible)
  formatProposals()         →  Numbered list + review suggestion footer
  printHelp()               →  Documents both channels (deliberate + automatic)
```

## Technology Stack

No new dependencies. Changes to existing files only.

## Data Model

No schema changes. `capture` creates the same Learning objects as `learn`.

## API Contracts

| Function | Change |
|----------|--------|
| `main()` | Add `"capture"` case routing to `cmdLearn()` |
| `cmdLearn()` | Accept optional `source` parameter to distinguish "captured" vs "added" |
| `formatProposals()` | Append review suggestion after proposal list |
| `printHelp()` | Add capture command, document two-channel model |

## Implementation

### Phase 1: `capture` command alias

**File:** `src/cli.ts`

Add `"capture"` to the main switch dispatcher, routing to `cmdLearn()` with a different commit message source.

Modify `cmdLearn()` to accept an optional commit verb parameter:
- Default (from `learn`): "Learn: added <type> via CLI"
- From `capture`: "Learn: captured <type> via CLI"

### Phase 2: Review suggestion in formatProposals

**File:** `src/session.ts`

After the existing footer for capped proposals (from F-019), always append:
```
Suggestion: Ask your AI to help review proposals, or run `pai-seed proposals review`.
```

### Phase 3: Help text update

**File:** `src/cli.ts`, `printHelp()`

Add `capture` to the commands list and add a section explaining the two-channel model.

## File Structure

No new files. All changes in existing files:

```
src/
├── cli.ts       # +capture alias, help text update
└── session.ts   # +review suggestion in formatProposals

tests/
├── cli.test.ts  # +capture command tests (if exists)
└── session.test.ts  # +review suggestion tests
```

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `capture` conflicts with future command | Low | "capture" is semantically clear and unlikely to collide |
| Review suggestion adds noise | Low | Only shows when proposals exist, one line |
| Existing learn tests break | Low | capture is additive, learn unchanged |
