# F-018: Proposals & Learnings CLI — Documentation

## New CLI Commands

### `pai-seed proposals`

| Subcommand | Description |
|------------|-------------|
| `proposals list` | List pending proposals (compact table) |
| `proposals list --verbose` | Full details per proposal |
| `proposals accept <id>` | Accept proposal by ID or short prefix (4+ chars) |
| `proposals reject <id>` | Reject proposal by ID or short prefix |
| `proposals review` | Interactive review: [a]ccept [r]eject [s]kip [q]uit |
| `proposals accept-all` | Accept all pending proposals |
| `proposals reject-all` | Reject all pending proposals |
| `proposals clean` | Remove rejected proposals from state |

### `pai-seed learnings`

| Subcommand | Description |
|------------|-------------|
| `learnings list` | List all confirmed learnings |
| `learnings list --type=pattern` | Filter by type (pattern/insight/self_knowledge) |
| `learnings list --verbose` | Full details per learning |
| `learnings show <id>` | Show single learning by ID or prefix |
| `learnings search <query>` | Search learnings by content substring |
| `learnings search <query> --type=insight` | Search with type filter |

## Short ID Prefix Resolution

All ID arguments accept short prefixes (minimum 4 characters), similar to git's short SHA:

```bash
pai-seed proposals accept gDo_K4     # Resolves to full ID
pai-seed learnings show VzpN         # Resolves to full ID
```

If a prefix is ambiguous, the error lists matching IDs to help disambiguate.

## New Library Export

```typescript
import { resolveIdPrefix } from "pai-seed";
import type { IdPrefixResult } from "pai-seed";
```

## Files Changed

| File | Change |
|------|--------|
| `src/id-prefix.ts` | New: short ID prefix resolution utility |
| `src/cli.ts` | Added proposals and learnings command dispatchers |
| `src/index.ts` | Added F-018 exports |
| `tests/id-prefix.test.ts` | New: 8 tests for prefix resolution |
| `tests/cli-proposals.test.ts` | New: integration tests for proposals/learnings |
