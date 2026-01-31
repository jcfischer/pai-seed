# Technical Plan: Git-backed Persistence

## Architecture Overview

```
                      loadSeedWithGit(path?)
                              │
                    ┌─────────▼──────────┐
                    │   initGitRepo()    │ ◄── Ensures ~/.pai/.git exists
                    │   (idempotent)     │     Creates .gitignore + initial commit
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   loadSeed()       │ ◄── F-002 (unchanged)
                    │   (from F-002)     │
                    └─────────┬──────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
      { created: true } { merged: true }  { ok: false }
             │                │                │
    commitSeedChange()  commitSeedChange() repairFromGit()
    "Init: default       "Merge: filled       │
     seed created"       missing fields"      │
                                     ┌────────┴────────┐
                                     │                 │
                                Repair OK         No git history
                                     │                 │
                              commitSeedChange()  createDefaultSeed()
                              "Repair: recovered  writeSeed()
                               from corruption"   commitSeedChange()


                      writeSeedWithCommit(config, message)
                              │
                    ┌─────────▼──────────┐
                    │   writeSeed()      │ ◄── F-002 (unchanged)
                    │   (from F-002)     │
                    └─────────┬──────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
          { ok: true }              { ok: false }
                 │                         │
       commitSeedChange()           return error
       (non-fatal — log             (skip git)
        warning on failure)


                           Git Layer (all non-fatal)
                    ┌──────────────────────────┐
                    │  Bun.spawn("git", [...]) │
                    │                          │
                    │  init / add / commit /   │
                    │  checkout / status / log │
                    └──────────────────────────┘
                           │           │
                      { ok: true }  { ok: false, error }
                                    (never throws,
                                     never blocks caller)
```

**Design principle:** F-003 is a git layer that wraps F-002's existing I/O functions. Git operations are strictly non-fatal — `writeSeed()` and `loadSeed()` from F-002 remain unchanged. F-003 adds commit tracking and repair capabilities on top. If git is unavailable or fails, seed operations still succeed.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard. `Bun.spawn()` for git CLI execution |
| Git execution | `Bun.spawn` shelling to `git` CLI | Zero dependencies. Git is universally available. No libgit2/isomorphic-git bloat |
| Path resolution | `node:path` + `node:os` | Reuse F-002 pattern: `resolveSeedPath()` |
| File operations | `node:fs/promises` | `copyFile()` for corrupted file backup, `access()` for existence checks |
| Seed operations | F-002 exports | `loadSeed()`, `writeSeed()`, `resolveSeedPath()` — unchanged |
| Validation | F-001 exports | `validateSeed()`, `createDefaultSeed()` — unchanged |
| Testing | `bun:test` | Project pattern. Real git repos in temp directories |

**No new dependencies.** Git CLI execution uses `Bun.spawn` (built-in). All other operations use F-001/F-002 exports and Node standard library.

## Data Model

### New Types (F-003)

```typescript
// --- Git Operation Result ---

type GitResult =
  | { ok: true }
  | { ok: false; error: string };

// --- Git Init Result (extends GitResult with metadata) ---

type GitInitResult =
  | { ok: true; initialized: boolean }  // initialized=false means already a repo
  | { ok: false; error: string };

// --- Repair Result ---

type RepairResult =
  | { ok: true; config: SeedConfig; repaired: boolean; message: string }
  | { ok: false; error: string };

// --- Commit Categories (for structured messages) ---

type CommitCategory =
  | "Init"      // Default seed creation
  | "Learn"     // New learning added
  | "Confirm"   // Proposal confirmed
  | "Reject"    // Proposal rejected
  | "Update"    // Identity or preferences changed
  | "Merge"     // Missing fields filled from defaults
  | "Repair";   // Recovered from corruption
```

### Reused from F-001 / F-002

| Type | Source | Usage in F-003 |
|------|--------|----------------|
| `SeedConfig` | `src/schema.ts` | RepairResult.config, writeSeedWithCommit input |
| `LoadResult` | `src/loader.ts` | loadSeedWithGit return type |
| `WriteResult` | `src/loader.ts` | writeSeedWithCommit return type |
| `ValidationResult` | `src/validate.ts` | Internal: validate restored file in repairFromGit |

## API Contracts

### `initGitRepo(paiDir?: string): Promise<GitInitResult>`

| Aspect | Detail |
|--------|--------|
| Default path | `~/.pai/` (derived from `resolveSeedPath()` parent dir) |
| Already a repo | Returns `{ ok: true, initialized: false }` — idempotent |
| Fresh directory | Runs `git init`, creates `.gitignore`, commits `.gitignore` |
| `.gitignore` contents | `*.tmp`, `*.db-shm`, `*.db-wal`, `node_modules/` |
| Initial commit message | `Init: repository initialized\n\nAutomated by pai-seed` |
| Git unavailable | Returns `{ ok: false, error: "git not found on PATH" }` |
| Never throws | All errors wrapped in result type |

### `commitSeedChange(message: string, paiDir?: string): Promise<GitResult>`

| Aspect | Detail |
|--------|--------|
| Stages | `seed.json` and `seed.schema.json` (via `git add`) |
| No changes | Returns `{ ok: true }` — git detects no diff, skips commit |
| Commit format | `<message>\n\nAutomated by pai-seed` |
| No repo | Returns `{ ok: false, error }` |
| No push | Local-only. Never touches remotes |
| Author | Uses system git config. No `--author` override unless `user.name` is missing |

### `writeSeedWithCommit(config: SeedConfig, message: string, seedPath?: string): Promise<WriteResult>`

| Aspect | Detail |
|--------|--------|
| Delegates to | `writeSeed()` from F-002, then `commitSeedChange()` |
| Write fails | Returns F-002 WriteResult error. Git commit skipped |
| Write succeeds, git fails | Returns `{ ok: true }`. Git failure logged as warning |
| Primary API | This replaces raw `writeSeed()` for all downstream features |

### `repairFromGit(seedPath?: string, paiDir?: string): Promise<RepairResult>`

| Aspect | Detail |
|--------|--------|
| Step 1 | Copy corrupted file to `seed.json.corrupted` |
| Step 2 | `git checkout -- seed.json` to restore last committed version |
| Step 3 | Load and validate restored file via `validateSeed()` |
| Restore valid | Return `{ ok: true, repaired: true, message: "Recovered from git history" }` |
| Restore invalid / no history | Create from `createDefaultSeed()`, write, return with message |
| Always commits | `"Repair: recovered from corruption"` |
| Never throws | All errors wrapped |

### `loadSeedWithGit(seedPath?: string): Promise<LoadResult>`

| Aspect | Detail |
|--------|--------|
| Step 1 | `initGitRepo()` — ensure git repo exists |
| Step 2 | `loadSeed()` from F-002 |
| On `{ created: true }` | `commitSeedChange("Init: default seed created")` |
| On `{ merged: true }` | `commitSeedChange("Merge: filled missing fields from defaults")` |
| On `{ ok: false }` with parse/validation error | `repairFromGit()` — attempt auto-recovery |
| On `{ ok: false }` with read/permission error | Return error as-is (not a corruption issue) |
| Return type | Same `LoadResult` as F-002 — transparent to callers |

### Utility Functions

#### `isGitRepo(paiDir?: string): Promise<boolean>`

Runs `git rev-parse --git-dir` in `paiDir`. Returns `true` if exit code 0.

#### `getLastCommitMessage(paiDir?: string): Promise<string | null>`

Runs `git log -1 --format=%B`. Returns trimmed message or `null` if no commits.

#### `hasUncommittedChanges(paiDir?: string): Promise<boolean>`

Runs `git status --porcelain`. Returns `true` if output is non-empty.

## Git CLI Execution Strategy

All git commands run via a single internal helper:

```typescript
async function runGit(
  args: string[],
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      return { ok: false, error: stderr.trim() || `git exited with code ${exitCode}` };
    }

    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Key properties:**
- Single execution path — all git commands route through `runGit`
- Captures both stdout and stderr
- Never throws — all failures wrapped in result
- `cwd` parameter for test isolation (run in temp dirs)
- No shell: `Bun.spawn` executes git directly (no injection risk)

### Git Availability Check

On first call to `initGitRepo()`, verify git is available:

```typescript
const check = await runGit(["--version"], paiDir);
if (!check.ok) {
  return { ok: false, error: "git not found on PATH" };
}
```

This runs once per session. Subsequent failures use standard error reporting.

## Implementation Phases

### Phase 1: Types and Git Runner

**Files:** `src/git.ts` (types + `runGit` helper)

- Define `GitResult`, `GitInitResult`, `RepairResult`, `CommitCategory` types
- Implement `runGit()` internal helper
- Export types from `src/index.ts`

**Verify:** Types compile. `runGit` tested with basic `git --version`.

### Phase 2: Git Initialization

**Files:** `src/git.ts` (add `initGitRepo`, `isGitRepo`), `tests/git.test.ts` (start)

- Implement `isGitRepo()` — `git rev-parse --git-dir`
- Implement `initGitRepo()`:
  1. Check `isGitRepo()` — return early if already initialized
  2. `runGit(["init"])` in paiDir
  3. Write `.gitignore` content via `Bun.write`
  4. `runGit(["add", ".gitignore"])`
  5. `runGit(["commit", "-m", "Init: repository initialized\n\nAutomated by pai-seed"])`
- Test cases:
  - Init on fresh directory → creates `.git/`, `.gitignore`, initial commit
  - Init on existing repo → returns `{ initialized: false }`, no changes
  - `.gitignore` contains expected patterns
  - Initial commit message correct
  - Idempotent: calling twice has no side effects

**Verify:** Git repo created with correct structure. Idempotent behavior confirmed.

### Phase 3: Commit Operations

**Files:** `src/git.ts` (add `commitSeedChange`), `tests/git.test.ts` (expand)

- Implement `commitSeedChange(message, paiDir)`:
  1. `runGit(["add", "seed.json", "seed.schema.json"])` — add both (ignore if either missing)
  2. Check for staged changes: `runGit(["diff", "--cached", "--quiet"])`
  3. If no changes: return `{ ok: true }` (nothing to commit)
  4. `runGit(["commit", "-m", "<message>\n\nAutomated by pai-seed"])`
- Test cases:
  - Commit after file change → commit created with correct message
  - Commit with no changes → returns `{ ok: true }`, no new commit
  - Message format matches spec (`<category>: <description>\n\nAutomated by pai-seed`)
  - Multiple sequential commits → each creates separate commit
  - No repo → returns `{ ok: false }`

**Verify:** Commits created correctly. No-change case handled gracefully.

### Phase 4: Write-with-Commit Wrapper

**Files:** `src/git.ts` (add `writeSeedWithCommit`), `tests/git.test.ts` (expand)

- Implement `writeSeedWithCommit(config, message, seedPath)`:
  1. Call `writeSeed(config, seedPath)` from F-002
  2. If write fails: return write error (skip git)
  3. If write succeeds: call `commitSeedChange(message, paiDir)`
  4. If git fails: return `{ ok: true }` anyway (git is non-fatal)
- Test cases:
  - Write + commit succeeds → file on disk, commit in log
  - Write fails (invalid config) → returns validation error, no commit
  - Write succeeds, git fails → returns `{ ok: true }` (non-fatal git)
  - Verify `writeSeed` from F-002 is called (file actually written)

**Verify:** Composition of F-002 write + git commit works. Git failure is non-fatal.

### Phase 5: Auto-Repair from Git

**Files:** `src/git.ts` (add `repairFromGit`), `tests/git.test.ts` (expand)

- Implement `repairFromGit(seedPath, paiDir)`:
  1. Copy corrupted file: `fs.copyFile(seedPath, seedPath + ".corrupted")`
  2. `runGit(["checkout", "--", "seed.json"])` — restore from git
  3. Read + validate restored file
  4. If valid: commit `"Repair: recovered from corruption"`, return repaired config
  5. If invalid or no history: `createDefaultSeed()` + `writeSeed()` + commit, return with message
- Test cases:
  - Corrupt file with valid git history → restored from last commit
  - Corrupt file preserved as `.corrupted`
  - No git history → falls back to defaults
  - Restored file validates correctly
  - Repair commit created
  - Recovery message describes what happened

**Verify:** Self-healing works for both cases (git history exists, doesn't exist).

### Phase 6: Load-with-Git Integration

**Files:** `src/git.ts` (add `loadSeedWithGit`), `tests/git.test.ts` (expand)

- Implement `loadSeedWithGit(seedPath)`:
  1. Derive `paiDir` from `seedPath` parent directory
  2. `initGitRepo(paiDir)` — ensure repo exists
  3. `loadSeed(seedPath)` — F-002 does all the work
  4. On success with `created: true` → `commitSeedChange("Init: default seed created")`
  5. On success with `merged: true` → `commitSeedChange("Merge: filled missing fields from defaults")`
  6. On failure with `parse_error` or `validation_error` → `repairFromGit(seedPath, paiDir)`
  7. On failure with `read_error` or `permission_error` → return error as-is
- Test cases:
  - Fresh directory: git init + load creates default + commits
  - Existing valid seed: git init (idempotent) + load, no commit
  - Partial seed: merge + commit with "Merge:" message
  - Corrupt seed: repair from git history
  - Corrupt seed, no history: repair from defaults
  - Read/permission errors pass through (no repair attempt)

**Verify:** Full integration flow works. `loadSeedWithGit` is the single entry point.

### Phase 7: Utilities and Exports

**Files:** `src/git.ts` (add utilities), `src/index.ts` (add exports), `tests/git.test.ts` (expand)

- Implement remaining utilities:
  - `getLastCommitMessage(paiDir)` — `git log -1 --format=%B`
  - `hasUncommittedChanges(paiDir)` — `git status --porcelain`
- Add to `src/index.ts`:
  ```typescript
  // F-003: Git-backed persistence
  export type { GitResult, GitInitResult, RepairResult, CommitCategory } from "./git";
  export {
    initGitRepo, commitSeedChange, writeSeedWithCommit,
    repairFromGit, loadSeedWithGit,
    isGitRepo, getLastCommitMessage, hasUncommittedChanges,
  } from "./git";
  ```
- Run full test suite: `bun test`
- Run typecheck: `tsc --noEmit`
- Verify no regressions in F-001/F-002 tests

**Verify:** All tests pass. Types compile. Public API complete.

## File Structure

```
src/
├── schema.ts          # F-001 (unchanged)
├── validate.ts        # F-001 (unchanged)
├── defaults.ts        # F-001 (unchanged)
├── json-schema.ts     # F-001 (unchanged)
├── merge.ts           # F-002 (unchanged)
├── loader.ts          # F-002 (unchanged)
├── git.ts             # NEW: all F-003 functions
└── index.ts           # MODIFIED: add F-003 exports

tests/
├── schema.test.ts     # F-001 (unchanged)
├── validate.test.ts   # F-001 (unchanged)
├── defaults.test.ts   # F-001 (unchanged)
├── json-schema.test.ts # F-001 (unchanged)
├── merge.test.ts      # F-002 (unchanged)
├── loader.test.ts     # F-002 (unchanged)
├── git.test.ts        # NEW: all F-003 tests
└── fixtures/          # (unchanged)
```

### Why One File

All F-003 logic goes in `src/git.ts` because:
- Every function depends on `runGit()` (the internal helper)
- The functions form a cohesive unit: init → commit → repair → load
- No need to split: the file will be ~200-250 lines (comparable to `loader.ts` at ~293 lines)
- Keeps the import graph simple: `git.ts` imports from `loader.ts`, never the reverse

## Test Strategy

### Git Repo Isolation

Every test creates a temporary directory with `git init`:

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-git-test-"));
  // Some tests need a pre-initialized repo:
  // await runGit(["init"], testDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

Tests that need a pre-populated repo (repair tests) will:
1. `git init` in temp dir
2. Write a valid seed.json
3. `git add` + `git commit`
4. Corrupt the file
5. Run `repairFromGit()`
6. Verify restoration

### Git Config for Tests

Tests may fail on machines without `user.name`/`user.email` configured. Handle this by setting local config in `beforeEach` for tests that commit:

```typescript
await runGit(["config", "user.email", "test@pai-seed.local"], testDir);
await runGit(["config", "user.name", "pai-seed-test"], testDir);
```

This is local to the test repo (not `--global`), so it never affects the system.

### Test Matrix

| Category | Test Count (est.) | Phase |
|----------|------------------|-------|
| `runGit` helper (basic execution) | ~4 | 1 |
| `initGitRepo` (fresh, existing, idempotent) | ~5 | 2 |
| `isGitRepo` (yes, no) | ~2 | 2 |
| `commitSeedChange` (commit, no-change, no-repo) | ~5 | 3 |
| `writeSeedWithCommit` (success, write-fail, git-fail) | ~4 | 4 |
| `repairFromGit` (restore, no-history, corrupted-backup) | ~5 | 5 |
| `loadSeedWithGit` (fresh, valid, partial, corrupt, errors) | ~7 | 6 |
| Utilities (`getLastCommitMessage`, `hasUncommittedChanges`) | ~4 | 7 |
| **Total** | **~36** | |

### Performance Budget

Spec requires git operations add <500ms per write. Git init is a one-time cost. Individual `git add` + `git commit` on a small repo should complete in <100ms. Tests will include a timing assertion:

```typescript
const start = performance.now();
await writeSeedWithCommit(config, "Update: test", seedPath);
expect(performance.now() - start).toBeLessThan(500);
```

## Error Handling Strategy

### Non-Fatal Git Operations

The core principle: **git never blocks seed operations.**

```
writeSeedWithCommit(config, message)
  │
  ├─ writeSeed(config) ← This MUST succeed for ok: true
  │    │
  │    ├── { ok: true }  → proceed to git
  │    └── { ok: false } → return error immediately (skip git)
  │
  └─ commitSeedChange(message) ← This is OPTIONAL
       │
       ├── { ok: true }  → great, commit recorded
       └── { ok: false } → log warning, still return { ok: true }
```

### Git Error Classification

```
Git errors (from Bun.spawn)
  │
  ├── ENOENT (git not found)    → { ok: false, error: "git not found on PATH" }
  ├── Exit code != 0            → { ok: false, error: stderr message }
  └── Spawn exception           → { ok: false, error: exception message }

All wrapped in GitResult — callers pattern-match on ok/error.
```

### Repair Flow Error Handling

```
repairFromGit()
  │
  ├── Copy to .corrupted fails  → Fall through to defaults
  ├── git checkout fails        → Fall through to defaults
  ├── Restored file invalid     → Fall through to defaults
  └── Default creation fails    → Return { ok: false, error }
```

The repair function has a clear escalation: git restore → defaults → error. Only the final fallback (can't even create defaults) returns an error.

## .gitignore Template

```
# Temporary files from atomic writes
*.tmp

# SQLite WAL files (if seed ever uses SQLite)
*.db-shm
*.db-wal

# Dependencies (shouldn't be in ~/.pai but defensive)
node_modules/
```

## Commit Message Examples

Following the spec's category format:

```
Init: default seed created

Automated by pai-seed
```

```
Learn: prefers concise responses

Automated by pai-seed
```

```
Confirm: moved 2 proposals to learned.patterns

Automated by pai-seed
```

```
Merge: filled missing fields from defaults

Automated by pai-seed
```

```
Repair: recovered from corruption

Automated by pai-seed
```

Standard `git log --oneline ~/.pai/seed.json` output:

```
a1b2c3d Repair: recovered from corruption
e4f5g6h Learn: prefers concise responses
i7j8k9l Confirm: moved 2 proposals to learned.patterns
m0n1o2p Init: default seed created
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `git` not on PATH (Docker, minimal OS) | Medium | Low | Check at `initGitRepo()`, return clear error. All non-git operations still work. |
| No `user.name`/`user.email` in git config | Medium | Medium | Git will still commit with a default. If it refuses, catch the error and return `{ ok: false }`. In tests: set local config per repo. |
| `Bun.spawn` behavior differs from `child_process` | Low | Low | `Bun.spawn` is well-tested for subprocess execution. Uses `stdout: "pipe"` / `stderr: "pipe"` which is stable. |
| Concurrent writes (two sessions) | Medium | Medium | Out of scope per spec. `commitSeedChange` operates on single files. Worst case: git merge conflict on next commit — caught by `runGit` error handling. |
| Temp dir cleanup failure in tests | Low | Very Low | `afterEach` with `{ force: true }`. Git lock files cleaned by rm recursive. |
| `git checkout -- seed.json` restores wrong version | Low | Very Low | We validate after restore. If the restored version is invalid, we fall through to defaults. |
| Large git history (years of commits) | Low | Very Low | Only `git log -1` is used for last-message. No full history traversal in code. Repo is tiny (single JSON file). |
| Atomic write `.tmp` file gets committed | Low | Low | `.gitignore` excludes `*.tmp`. And `commitSeedChange` only stages `seed.json` and `seed.schema.json` explicitly. |

## Dependencies

### Upstream (F-003 consumes)

| Dependency | Import | Used By |
|------------|--------|---------|
| `loadSeed` | `src/loader.ts` | `loadSeedWithGit` — delegates all file loading |
| `writeSeed` | `src/loader.ts` | `writeSeedWithCommit` — delegates file writing |
| `resolveSeedPath` | `src/loader.ts` | Derive `paiDir` from seed path |
| `validateSeed` | `src/validate.ts` | `repairFromGit` — validate restored file |
| `createDefaultSeed` | `src/defaults.ts` | `repairFromGit` — fallback when no git history |
| `SeedConfig` | `src/schema.ts` | All function signatures |
| `LoadResult`, `WriteResult` | `src/loader.ts` | Return types for wrapper functions |

### Downstream (F-003 provides)

| Consumer | What They Import | Why |
|----------|-----------------|-----|
| F-004 Setup wizard | `writeSeedWithCommit()` | Commit identity setup: `"Update: identity configured"` |
| F-007 Confirmation | `writeSeedWithCommit()` | Commit confirmed learnings: `"Confirm: ..."` |
| F-011 CLI | `repairFromGit()`, `getLastCommitMessage()`, `hasUncommittedChanges()` | `pai-seed repair`, `pai-seed diff`, status display |
| F-013 Relationships | `commitSeedChange()` | Commit relationship file changes |

### Package Dependencies

**None new.** Git CLI execution uses `Bun.spawn` (built-in). File copying uses `node:fs/promises` (already available).
