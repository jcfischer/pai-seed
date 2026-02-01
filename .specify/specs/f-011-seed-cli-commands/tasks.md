---
feature: "Seed CLI commands"
feature_id: "F-011"
created: "2026-02-01"
---

# Implementation Tasks: Seed CLI Commands

## Task Groups

### Group 1: Entry Point

#### T-11.1: CLI Dispatcher
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Create CLI entry point:
- Shebang: `#!/usr/bin/env bun`
- Parse `process.argv.slice(2)` for command + args
- Switch/case dispatcher to command handlers
- `help` command and default (no args) prints usage
- Unknown command prints error + usage to stderr, exits 1
- ANSI color helper functions (bold, green, red, yellow, dim)

Tests:
- [ ] help command outputs usage text
- [ ] Unknown command exits with error

### Group 2: Read-Only Commands

#### T-11.2: show Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Display seed summary:
- Load seed via `loadSeed()`
- Format identity using `formatIdentitySummary()`
- Show learning counts (patterns, insights, selfKnowledge)
- Show pending proposal count
- Show checkpoint ref if set
- Format with section headers and ANSI colors

Tests:
- [ ] show outputs identity summary
- [ ] show outputs learning counts
- [ ] show handles missing seed gracefully

#### T-11.3: status Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Quick health check:
- Show seed path, file existence, version
- Show validation result (valid/invalid)
- Show git repo status (is repo, uncommitted changes)
- Minimal, compact output

Tests:
- [ ] status shows seed path and version
- [ ] status shows validation result
- [ ] status handles missing file

#### T-11.4: diff Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Show changes:
- Run `git diff HEAD -- seed.json` via Bun.spawn
- If no git repo: print "Not a git repository"
- If no changes: print "No changes since last commit"
- Otherwise: pipe git diff output to stdout

Tests:
- [ ] diff reports no changes when clean
- [ ] diff handles non-git directory

### Group 3: Mutation Commands

#### T-11.5: learn Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Add a learning:
- Parse: `pai-seed learn <type> <content...>`
- Validate type is "pattern" | "insight" | "self_knowledge"
- Load seed, create Learning entry, add to correct category
- Write with git commit via `writeSeedWithCommit()`
- Print confirmation

Tests:
- [ ] learn adds pattern to seed
- [ ] learn validates type argument
- [ ] learn requires content argument

#### T-11.6: forget Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Remove a learning:
- Parse: `pai-seed forget <id>`
- Load seed, search all learned categories for matching ID
- Remove if found, write with git commit
- Print confirmation or "not found" error

Tests:
- [ ] forget removes learning by ID
- [ ] forget returns error for unknown ID

### Group 4: Repair + Integration

#### T-11.7: repair Command
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Auto-repair:
- Call `repairFromGit()`
- Print result: repaired from git, reset to defaults, or error
- Exit 0 on success, 1 on failure

Tests:
- [ ] repair calls repairFromGit and reports result

#### T-11.8: Package Integration
**File**: `package.json`, `src/cli.ts`
**Test**: `tests/cli.test.ts`

Final integration:
- Add `"bin": { "pai-seed": "src/cli.ts" }` to package.json
- Ensure `chmod +x src/cli.ts`
- Verify `bun run src/cli.ts help` works
- Verify `bun run src/cli.ts show` works with real seed

Tests:
- [ ] CLI executable via bun run src/cli.ts
- [ ] All commands importable and callable

## Task Summary

| Task | Description | Tests |
|------|-------------|-------|
| T-11.1 | CLI dispatcher | 2 |
| T-11.2 | show command | 3 |
| T-11.3 | status command | 3 |
| T-11.4 | diff command | 2 |
| T-11.5 | learn command | 3 |
| T-11.6 | forget command | 2 |
| T-11.7 | repair command | 1 |
| T-11.8 | Package integration | 2 |
| **Total** | | **18** |

## Execution Order

1. T-11.1 (dispatcher) — everything depends on this
2. T-11.2, T-11.3, T-11.4 (read-only commands, parallel)
3. T-11.5, T-11.6 (mutation commands, parallel)
4. T-11.7, T-11.8 (repair + integration, final)
