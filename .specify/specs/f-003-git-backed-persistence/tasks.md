# Implementation Tasks: Git-backed Persistence (F-003)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | |
| T-1.2 | ☐ | |
| T-2.1 | ☐ | |
| T-2.2 | ☐ | |
| T-2.3 | ☐ | |
| T-3.1 | ☐ | |
| T-3.2 | ☐ | |
| T-3.3 | ☐ | |
| T-4.1 | ☐ | |
| T-4.2 | ☐ | |

---

## Group 1: Foundation

### T-1.1: Define types and git runner helper [T]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** none
- **Spec refs:** FR-1 (GitResult types), FR-2 (CommitCategory), FR-4 (RepairResult)
- **Description:**
  Create `src/git.ts` with all F-003 types and the internal `runGit()` helper function.

  **Types to define:**
  - `GitResult` — `{ ok: true } | { ok: false; error: string }`
  - `GitInitResult` — `{ ok: true; initialized: boolean } | { ok: false; error: string }`
  - `RepairResult` — `{ ok: true; config: SeedConfig; repaired: boolean; message: string } | { ok: false; error: string }`
  - `CommitCategory` — `"Init" | "Learn" | "Confirm" | "Reject" | "Update" | "Merge" | "Repair"`

  **Internal helper:**
  - `runGit(args: string[], cwd: string)` — Executes git CLI via `Bun.spawn`, captures stdout/stderr, returns result type. Never throws.

  **Tests (~4):**
  - `runGit` executes `git --version` successfully
  - `runGit` returns error for invalid git command
  - `runGit` captures stdout correctly
  - `runGit` returns error when cwd doesn't exist

### T-1.2: Scaffold test infrastructure [T]
- **File:** `tests/git.test.ts`
- **Dependencies:** none (parallel with T-1.1 for the scaffold portion)
- **Description:**
  Set up the test file structure with temp directory management, local git config, and describe blocks for all test groups.

  **Infrastructure:**
  - `beforeEach`: create temp directory via `mkdtemp`
  - `afterEach`: clean up with `rm({ recursive: true, force: true })`
  - Set local git config per test repo (`user.email`, `user.name`)
  - Helper function to write a valid seed.json fixture into temp dir
  - Placeholder describe blocks for each functional group

---

## Group 2: Core Git Operations

### T-2.1: Implement `initGitRepo` and `isGitRepo` [T]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** T-1.1
- **Spec refs:** FR-1 (Git Repository Initialization), FR-5 (isGitRepo)
- **Description:**
  Implement git repository initialization and detection.

  **`isGitRepo(paiDir?: string): Promise<boolean>`:**
  - Runs `git rev-parse --git-dir` in paiDir
  - Returns `true` if exit code 0, `false` otherwise

  **`initGitRepo(paiDir?: string): Promise<GitInitResult>`:**
  1. Check `isGitRepo()` — if already a repo, return `{ ok: true, initialized: false }`
  2. Verify git is available (`git --version`)
  3. Run `git init` in paiDir
  4. Write `.gitignore` via `Bun.write` (contents: `*.tmp`, `*.db-shm`, `*.db-wal`, `node_modules/`)
  5. `git add .gitignore`
  6. `git commit -m "Init: repository initialized\n\nAutomated by pai-seed"`
  7. Return `{ ok: true, initialized: true }`

  **Default paiDir:** derived from `resolveSeedPath()` parent directory.

  **Tests (~7):**
  - `isGitRepo` returns `false` for plain directory
  - `isGitRepo` returns `true` after `git init`
  - `initGitRepo` on fresh directory creates `.git/`
  - `initGitRepo` creates `.gitignore` with correct patterns
  - `initGitRepo` creates initial commit with correct message
  - `initGitRepo` on existing repo returns `{ initialized: false }`, no changes
  - `initGitRepo` idempotent: calling twice produces no additional commits

### T-2.2: Implement `commitSeedChange` [T]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** T-2.1
- **Spec refs:** FR-2 (Auto-Commit on Seed Changes)
- **Description:**
  Implement automatic commit after seed file changes.

  **`commitSeedChange(message: string, paiDir?: string): Promise<GitResult>`:**
  1. `git add seed.json seed.schema.json` (ignore if either missing)
  2. Check for staged changes: `git diff --cached --quiet`
  3. If no changes: return `{ ok: true }` (nothing to commit)
  4. `git commit -m "<message>\n\nAutomated by pai-seed"`
  5. Return `{ ok: true }` or `{ ok: false, error }` on failure

  **Commit message format:** `<message>\n\nAutomated by pai-seed`
  **No push.** Local-only.

  **Tests (~5):**
  - Commit after writing seed.json creates commit with correct message
  - Commit with no changes returns `{ ok: true }`, no new commit created
  - Commit message includes `\n\nAutomated by pai-seed` trailer
  - Multiple sequential commits create separate commits
  - Commit on non-repo returns `{ ok: false }`

### T-2.3: Implement git utilities [T] [P with T-2.2]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** T-2.1
- **Spec refs:** FR-5 (Git Status Utilities)
- **Description:**
  Implement status query utilities for downstream features.

  **`getLastCommitMessage(paiDir?: string): Promise<string | null>`:**
  - Runs `git log -1 --format=%B`
  - Returns trimmed message or `null` if no commits

  **`hasUncommittedChanges(paiDir?: string): Promise<boolean>`:**
  - Runs `git status --porcelain`
  - Returns `true` if output is non-empty

  **Tests (~4):**
  - `getLastCommitMessage` returns message after commit
  - `getLastCommitMessage` returns `null` on empty repo
  - `hasUncommittedChanges` returns `false` on clean repo
  - `hasUncommittedChanges` returns `true` after modifying a tracked file

---

## Group 3: Integration

### T-3.1: Implement `writeSeedWithCommit` [T]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** T-2.2
- **Spec refs:** FR-3 (Higher-Level Commit Wrappers)
- **Description:**
  Implement the primary write API that combines F-002's `writeSeed()` with automatic git commit.

  **`writeSeedWithCommit(config: SeedConfig, message: string, seedPath?: string): Promise<WriteResult>`:**
  1. Call `writeSeed(config, seedPath)` from F-002
  2. If write fails: return write error immediately (skip git)
  3. If write succeeds: call `commitSeedChange(message, paiDir)`
  4. If git fails: still return `{ ok: true }` (git is non-fatal)

  **Tests (~4):**
  - Write + commit succeeds: file on disk, commit in git log
  - Write fails (invalid config): returns validation error, no commit created
  - Write succeeds but git fails (non-repo dir): returns `{ ok: true }` (non-fatal)
  - Performance: write + commit completes in <500ms

### T-3.2: Implement `repairFromGit` [T]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** T-2.2
- **Spec refs:** FR-4 (Auto-Repair from Git History)
- **Description:**
  Implement self-healing recovery from git history when seed.json is corrupted.

  **`repairFromGit(seedPath?: string, paiDir?: string): Promise<RepairResult>`:**
  1. Copy corrupted file to `seed.json.corrupted` via `fs.copyFile`
  2. Run `git checkout -- seed.json` to restore last committed version
  3. Load and validate the restored file via `validateSeed()`
  4. If valid: commit `"Repair: recovered from corruption"`, return `{ ok: true, repaired: true }`
  5. If invalid or no git history: `createDefaultSeed()` + `writeSeed()`, commit, return with appropriate message
  6. Never throws — all errors wrapped

  **Tests (~5):**
  - Corrupt file with valid git history: restored from last commit
  - Corrupted file preserved as `seed.json.corrupted`
  - No git history: falls back to defaults
  - Restored file validates correctly (actual `SeedConfig` returned)
  - Repair commit created with `"Repair:"` category message

### T-3.3: Implement `loadSeedWithGit` [T]
- **File:** `src/git.ts`
- **Test:** `tests/git.test.ts`
- **Dependencies:** T-3.1, T-3.2
- **Spec refs:** FR-6 (Enhanced loadSeed with Git Integration)
- **Description:**
  Implement the top-level entry point that integrates git init, loading, auto-commit, and repair.

  **`loadSeedWithGit(seedPath?: string): Promise<LoadResult>`:**
  1. Derive `paiDir` from `seedPath` parent directory
  2. Call `initGitRepo(paiDir)` — ensure repo exists
  3. Call `loadSeed(seedPath)` from F-002
  4. On success with `created: true` → `commitSeedChange("Init: default seed created")`
  5. On success with `merged: true` → `commitSeedChange("Merge: filled missing fields from defaults")`
  6. On failure with `parse_error` or `validation_error` → `repairFromGit(seedPath, paiDir)`
  7. On failure with `read_error` or `permission_error` → return error as-is (not corruption)

  **Return type:** Same `LoadResult` as F-002 — transparent to callers.

  **Tests (~7):**
  - Fresh directory: git init + creates default + commits with `"Init:"` message
  - Existing valid seed: git init (idempotent) + loads, no new commit
  - Partial seed (missing fields): merges defaults + commits with `"Merge:"` message
  - Corrupt seed with git history: repairs from git, returns valid config
  - Corrupt seed without git history: repairs from defaults
  - Read/permission errors pass through unchanged (no repair attempt)
  - Full flow: verify git log shows expected commit history after load

---

## Group 4: Polish

### T-4.1: Add exports to index.ts
- **File:** `src/index.ts`
- **Dependencies:** T-3.3 (all functions implemented)
- **Spec refs:** All FRs (public API surface)
- **Description:**
  Add all F-003 type and function exports to the package's public API.

  **Type exports:**
  ```typescript
  export type { GitResult, GitInitResult, RepairResult, CommitCategory } from "./git";
  ```

  **Function exports:**
  ```typescript
  export {
    initGitRepo, commitSeedChange, writeSeedWithCommit,
    repairFromGit, loadSeedWithGit,
    isGitRepo, getLastCommitMessage, hasUncommittedChanges,
  } from "./git";
  ```

### T-4.2: Full test suite and regression check [T]
- **File:** `tests/git.test.ts` (review), all existing test files
- **Dependencies:** T-4.1
- **Description:**
  Final validation pass.

  1. Run `bun test` — all tests pass (F-001, F-002, F-003)
  2. Run `tsc --noEmit` — no type errors
  3. Verify F-001 tests still pass (no regressions from new exports)
  4. Verify F-002 tests still pass (loader.ts unchanged)
  5. Count total F-003 tests (target: ~36)
  6. Verify performance budget: writeSeedWithCommit <500ms

---

## Execution Order

```
T-1.1 ─────────────┐
                    ├──→ T-2.1 ──→ T-2.2 ──→ T-3.1 ──┐
T-1.2 (parallel) ──┘         │                         ├──→ T-3.3 ──→ T-4.1 ──→ T-4.2
                              └──→ T-2.3 (parallel)    │
                                                        │
                                   T-3.2 ──────────────┘
```

**Parallelizable pairs:**
- T-1.1 + T-1.2 (types and test scaffold are independent)
- T-2.2 + T-2.3 (both depend on T-2.1 only)
- T-3.1 + T-3.2 (both depend on T-2.2 only)

## FR ↔ Task Mapping

| Functional Requirement | Task(s) |
|----------------------|---------|
| FR-1: Git Repository Initialization | T-2.1 |
| FR-2: Auto-Commit on Seed Changes | T-2.2 |
| FR-3: Higher-Level Commit Wrappers | T-3.1 |
| FR-4: Auto-Repair from Git History | T-3.2 |
| FR-5: Git Status Utilities | T-2.1 (`isGitRepo`), T-2.3 (`getLastCommitMessage`, `hasUncommittedChanges`) |
| FR-6: Enhanced loadSeed with Git Integration | T-3.3 |
