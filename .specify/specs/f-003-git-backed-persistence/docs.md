# Documentation Updates: F-003 Git-backed Persistence

**Feature:** F-003
**Date:** 2026-01-31

## What Was Created

### New Source Files

| File | Purpose |
|------|---------|
| `src/git.ts` | All F-003 functions: `runGit()` internal helper, `isGitRepo()`, `initGitRepo()`, `commitSeedChange()`, `getLastCommitMessage()`, `hasUncommittedChanges()`, `writeSeedWithCommit()`, `repairFromGit()`, `loadSeedWithGit()` |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/git.test.ts` | 36 | runGit, isGitRepo, initGitRepo, commitSeedChange, utilities, writeSeedWithCommit, repairFromGit, loadSeedWithGit |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added F-003 type and function exports |

## Public API Additions

Exported from `src/index.ts` (appended to F-001 and F-002 exports):

### Types
- `GitResult` -- `{ ok: true } | { ok: false; error: string }`
- `GitInitResult` -- `{ ok: true; initialized: boolean } | { ok: false; error: string }`
- `RepairResult` -- `{ ok: true; config: SeedConfig; repaired: boolean; message: string } | { ok: false; error: string }`
- `CommitCategory` -- `"Init" | "Learn" | "Confirm" | "Reject" | "Update" | "Merge" | "Repair"`

### Functions
- `isGitRepo(paiDir?: string): Promise<boolean>` -- Check if directory is a git repo
- `initGitRepo(paiDir?: string): Promise<GitInitResult>` -- Initialize git repo with .gitignore and initial commit; idempotent
- `commitSeedChange(message: string, paiDir?: string): Promise<GitResult>` -- Stage seed files and commit
- `getLastCommitMessage(paiDir?: string): Promise<string | null>` -- Last commit message or null
- `hasUncommittedChanges(paiDir?: string): Promise<boolean>` -- Check dirty state
- `writeSeedWithCommit(config: SeedConfig, message: string, seedPath?: string): Promise<WriteResult>` -- Atomic write + git commit (non-fatal git)
- `repairFromGit(seedPath?: string, paiDir?: string): Promise<RepairResult>` -- Recover corrupted seed from git history or defaults
- `loadSeedWithGit(seedPath?: string): Promise<LoadResult>` -- Full orchestration: init repo, load seed, auto-commit, auto-repair

## No External Documentation Changes

F-003 is an internal git persistence layer. No README or user-facing documentation needed yet. CLI documentation will come with F-011.
