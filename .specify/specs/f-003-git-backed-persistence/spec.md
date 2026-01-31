---
id: "F-003"
feature: "Git-backed persistence"
status: "draft"
created: "2026-01-31"
depends_on: ["F-002"]
---

# Specification: Git-backed Persistence

## Overview

Make `~/.pai/` a git repository that automatically tracks all changes to seed.json. Every write operation (learning added, proposal confirmed, identity changed) produces a descriptive git commit. On file corruption, auto-repair by checking out the last known good version from git history. This gives PAI a full audit trail of how the AI's identity evolves over time.

## User Scenarios

### Scenario 1: Normal operation — automatic commit on changes

**As a** PAI system that just modified seed.json
**I want** the change automatically committed to git with a descriptive message
**So that** every evolution of the AI's identity is tracked

**Acceptance Criteria:**
- [ ] After `writeSeed()` succeeds, a git commit is created automatically
- [ ] Commit message describes what changed (e.g., "Learn: prefers concise responses")
- [ ] No user interaction required — fully automatic
- [ ] Git operations don't block the caller — fire-and-forget is acceptable

### Scenario 2: First run — initialize git repo

**As a** PAI system starting in a fresh `~/.pai/` directory
**I want** the directory initialized as a git repo automatically
**So that** version history starts from day one

**Acceptance Criteria:**
- [ ] `git init` called when `~/.pai/.git` doesn't exist
- [ ] Initial commit includes default seed.json and seed.schema.json
- [ ] `.gitignore` created for temp files (`*.tmp`, `*.db-shm`, `*.db-wal`)
- [ ] No error if directory is already a git repo (idempotent)

### Scenario 3: Corruption recovery — auto-repair from history

**As a** PAI system that detects a corrupted or invalid seed.json
**I want** automatic recovery from the last good version in git
**So that** the system self-heals without manual intervention

**Acceptance Criteria:**
- [ ] On validation failure, attempt `git checkout -- seed.json` to restore last committed version
- [ ] If restored version validates, return it with a warning about the recovery
- [ ] If git history is empty or also invalid, fall back to creating from defaults
- [ ] Original corrupted file preserved as `seed.json.corrupted` for debugging
- [ ] Recovery event logged (message returned to caller)

### Scenario 4: Viewing AI evolution over time

**As a** PAI user curious about how my AI has evolved
**I want** to see the git history of seed.json
**So that** I can understand the AI's learning trajectory

**Acceptance Criteria:**
- [ ] Standard `git log ~/.pai/seed.json` works (meaningful commit messages)
- [ ] `git diff` between versions shows meaningful changes
- [ ] Commit messages follow a consistent format

## Functional Requirements

### FR-1: Git Repository Initialization

Provide `initGitRepo(paiDir?: string): Promise<GitResult>` that:
- Checks if `paiDir/.git` exists
- If not, runs `git init` in `paiDir`
- Creates `.gitignore` (ignore `*.tmp`, `*.db-shm`, `*.db-wal`, `node_modules/`)
- Stages and commits `.gitignore` as initial commit
- Returns `{ ok: true, initialized: boolean }` or `{ ok: false, error }`
- Idempotent: if already a git repo, returns `{ ok: true, initialized: false }`
- Default `paiDir`: `~/.pai/`

**Validation:** Unit test: init on fresh dir, init on existing repo, gitignore content.

### FR-2: Auto-Commit on Seed Changes

Provide `commitSeedChange(message: string, paiDir?: string): Promise<GitResult>` that:
- Stages `seed.json` and `seed.schema.json` (if they exist)
- Creates a commit with the provided message
- Returns `{ ok: true }` or `{ ok: false, error }` (git error, no repo, etc.)
- Fails silently if there are no changes to commit (returns `{ ok: true }`)
- Does NOT push to any remote (local-only)

Commit message format:
```
<category>: <description>

Automated by pai-seed
```

Categories:
- `Init` — Default seed creation
- `Learn` — New learning added to learned section
- `Confirm` — Proposal confirmed and moved to learned
- `Reject` — Proposal rejected
- `Update` — Identity or preferences changed
- `Merge` — Missing fields filled from defaults
- `Repair` — Recovered from corruption

**Validation:** Unit test: commit after write, no-change commit, message format.

### FR-3: Higher-Level Commit Wrappers

Provide `writeSeedWithCommit(config, message, opts?): Promise<WriteResult>` that:
- Calls `writeSeed()` from F-002
- If write succeeds, calls `commitSeedChange(message)`
- Returns the write result (git commit failure is non-fatal — logged as warning)
- This is the primary write API for downstream features

**Validation:** Unit test: write + commit, write failure skips commit, commit failure still returns write success.

### FR-4: Auto-Repair from Git History

Provide `repairFromGit(seedPath?, paiDir?): Promise<RepairResult>` that:

```typescript
type RepairResult =
  | { ok: true; config: SeedConfig; repaired: boolean; message: string }
  | { ok: false; error: string }
```

Recovery flow:
1. Copy current (corrupted) file to `seed.json.corrupted`
2. Run `git checkout -- seed.json` to restore last committed version
3. Load and validate the restored file
4. If valid: return `{ repaired: true, message: "Recovered from git history" }`
5. If invalid or no git history: create from defaults, return with appropriate message
6. Commit the repair: `"Repair: recovered from corruption"`

**Validation:** Unit test: repair corrupt file, repair when no git history, repair preserves corrupted file.

### FR-5: Git Status Utilities

Provide utility functions for downstream features:
- `isGitRepo(paiDir?: string): Promise<boolean>` — check if directory is a git repo
- `getLastCommitMessage(paiDir?: string): Promise<string | null>` — last commit message
- `hasUncommittedChanges(paiDir?: string): Promise<boolean>` — check for dirty state

**Validation:** Unit test for each utility.

### FR-6: Enhanced loadSeed with Git Integration

Provide `loadSeedWithGit(seedPath?): Promise<LoadResult>` that:
- Calls `initGitRepo()` to ensure git repo exists
- Calls `loadSeed()` from F-002
- If loadSeed created a new file (`created: true`), auto-commit: `"Init: default seed created"`
- If loadSeed merged defaults (`merged: true`), auto-commit: `"Merge: filled missing fields from defaults"`
- If loadSeed fails with parse/validation error, attempt `repairFromGit()`
- Returns the standard `LoadResult` (same type as F-002)

**Validation:** Unit test: full flow with git init + load + commit.

## Non-Functional Requirements

- **Performance:** Git operations add <500ms to any write operation
- **Reliability:** Git failures are non-fatal — seed operations succeed even if git is unavailable
- **Isolation:** Never push to remotes. Local-only git operations.
- **No git config changes:** Don't set user.name/user.email. Use `--author` flag or rely on system defaults.
- **Testability:** All functions accept directory overrides. Tests use temp directories with `git init`.
- **Idempotency:** Multiple commits with identical content produce no additional commits (git detects no diff).

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| GitResult | Success/failure for git operations | New in F-003 |
| RepairResult | Result of auto-repair attempt | New in F-003 |
| SeedConfig | Typed seed data | F-001 |
| LoadResult | Load outcome from F-002 | F-002 |
| WriteResult | Write outcome from F-002 | F-002 |

## Success Criteria

- [ ] `initGitRepo()` creates git repo with .gitignore on first run
- [ ] `commitSeedChange()` creates commits with descriptive messages
- [ ] `writeSeedWithCommit()` atomically writes seed + commits
- [ ] `repairFromGit()` recovers corrupted seed from git history
- [ ] Git failures are non-fatal (never block seed operations)
- [ ] `loadSeedWithGit()` integrates git init + load + auto-commit
- [ ] All tests use temp directories (never touches ~/.pai/)
- [ ] Existing F-001/F-002 tests pass (no regressions)
- [ ] `bun test` passes all tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| `git` CLI is available on PATH | Docker container without git | Check at init, return clear error |
| Single writer at a time | Concurrent Claude sessions | F-003 doesn't solve locking — deferred |
| Local-only git (no remotes) | User wants cloud backup | Future feature: remote push opt-in |
| System git config exists (user.name/email) | Fresh machine, CI | Use `--author` fallback or skip config |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-002 | `loadSeed()`, `writeSeed()`, `resolveSeedPath()` | Function signatures |
| F-001 | `SeedConfig`, `validateSeed()`, `createDefaultSeed()` | Types, validation behavior |
| git CLI | `git init`, `git add`, `git commit`, `git checkout`, `git status` | Command interface |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|----|
| F-004 Setup wizard | `writeSeedWithCommit()` | Commit identity setup |
| F-007 Confirmation | `writeSeedWithCommit()` | Commit confirmed learnings |
| F-011 CLI | `repairFromGit()`, git utilities | `pai-seed repair`, `pai-seed diff` |
| F-013 Relationships | `commitSeedChange()` | Commit relationship file changes |

## Out of Scope

- Remote push/pull (no GitHub sync in v1)
- Branch management (single branch: main)
- Merge conflict resolution for concurrent writes
- Git hooks (pre-commit, post-commit)
- Git LFS for large files
- Interactive rebase or history rewriting
