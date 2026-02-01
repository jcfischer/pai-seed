---
feature: "Seed CLI commands"
feature_id: "F-011"
created: "2026-02-01"
---

# Technical Plan: Seed CLI Commands

## Architecture Overview

Single CLI entry point (`src/cli.ts`) that parses `process.argv` and dispatches to command handlers. Each handler is a thin function calling existing library APIs. No new dependencies — Bun native only.

## Design Decisions

### D-1: No Framework (Bun Native Args)
**Choice**: Parse `process.argv` directly with a simple switch/case dispatcher.
**Rationale**: Only 6 subcommands. Commander.js would be the only runtime dependency added for minimal benefit. Bun direct execution keeps startup fast.

### D-2: CLI as Thin Layer
**Choice**: All business logic stays in existing modules. CLI only handles arg parsing, output formatting, and exit codes.
**Rationale**: CLI commands are testable by testing the underlying library functions. CLI tests focus on arg parsing and output format.

### D-3: ANSI Output via Template Strings
**Choice**: Use template strings with ANSI escape codes for colors. No chalk/kleur.
**Rationale**: Zero dependencies. Bun terminals support ANSI. Simple bold/green/red/yellow covers all needs.

### D-4: Shebang for Bun
**Choice**: `#!/usr/bin/env bun` at top of `src/cli.ts`.
**Rationale**: Bun executes TypeScript directly. `bun link` or package.json `bin` makes it available as `pai-seed`.

## API Contract

### CLI Interface
```
pai-seed <command> [args...]

Commands:
  show                    Show seed configuration summary
  learn <type> <content>  Add a confirmed learning
  forget <id>             Remove a learning by ID
  diff                    Show git diff for seed.json
  repair                  Auto-repair from git history
  status                  Quick health check
  help                    Show usage
```

## Implementation Phases

### Phase 1: Entry Point + Dispatcher (T-11.1)
CLI entry point, arg parsing, help text, command routing.

### Phase 2: Read-Only Commands (T-11.2, T-11.3, T-11.4)
`show`, `status`, `diff` — no mutations, safe to implement first.

### Phase 3: Mutation Commands (T-11.5, T-11.6)
`learn`, `forget` — modify seed.json, require git commits.

### Phase 4: Repair + Integration (T-11.7, T-11.8)
`repair` command, package.json bin field, integration tests.

## File Changes

| File | Change |
|------|--------|
| `src/cli.ts` | NEW — CLI entry point (~200 lines) |
| `package.json` | MODIFY — add `bin` field |
| `src/index.ts` | No change (CLI imports from internal modules) |
| `tests/cli.test.ts` | NEW — CLI tests |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Arg parsing edge cases | Simple positional args, no flags to parse wrong |
| ANSI codes in non-TTY | Check `process.stdout.isTTY` before coloring |
| Git commands fail in non-repo | repairFromGit already handles gracefully |
