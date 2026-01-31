import { dirname, join } from "node:path";
import { copyFile } from "node:fs/promises";
import type { SeedConfig } from "./schema";
import { validateSeed } from "./validate";
import { createDefaultSeed } from "./defaults";
import { loadSeed, writeSeed, resolveSeedPath } from "./loader";
import type { LoadResult, WriteResult } from "./loader";

// =============================================================================
// F-003: Types
// =============================================================================

export type GitResult = { ok: true } | { ok: false; error: string };
export type GitInitResult =
  | { ok: true; initialized: boolean }
  | { ok: false; error: string };
export type RepairResult =
  | { ok: true; config: SeedConfig; repaired: boolean; message: string }
  | { ok: false; error: string };
export type CommitCategory =
  | "Init"
  | "Learn"
  | "Confirm"
  | "Reject"
  | "Update"
  | "Merge"
  | "Repair";

// =============================================================================
// F-003: Internal helper — ALL git commands route through this
// =============================================================================

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
      return {
        ok: false,
        error: stderr.trim() || `git exited with code ${exitCode}`,
      };
    }
    return { ok: true, stdout: stdout.trim() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-003 1: isGitRepo
// =============================================================================

/**
 * Check whether paiDir is inside a git repository.
 * Returns true if `git rev-parse --git-dir` exits 0, false otherwise.
 */
export async function isGitRepo(paiDir?: string): Promise<boolean> {
  const dir = paiDir ?? dirname(resolveSeedPath());
  const result = await runGit(["rev-parse", "--git-dir"], dir);
  return result.ok;
}

// =============================================================================
// F-003 2: initGitRepo
// =============================================================================

/**
 * Initialize a git repository in paiDir if one does not already exist.
 *
 * - If already a repo: returns { ok: true, initialized: false }
 * - Creates .gitignore, stages it, and creates an initial commit
 * - Returns { ok: true, initialized: true } on success
 */
export async function initGitRepo(paiDir?: string): Promise<GitInitResult> {
  const dir = paiDir ?? dirname(resolveSeedPath());

  // Check if already a repo
  if (await isGitRepo(dir)) {
    return { ok: true, initialized: false };
  }

  // Check git is available
  const versionCheck = await runGit(["--version"], dir);
  if (!versionCheck.ok) {
    return { ok: false, error: `git not available: ${versionCheck.error}` };
  }

  // git init
  const initResult = await runGit(["init"], dir);
  if (!initResult.ok) {
    return { ok: false, error: `git init failed: ${initResult.error}` };
  }

  // Configure local git user for automated commits
  await runGit(["config", "user.email", "pai-seed@local"], dir);
  await runGit(["config", "user.name", "pai-seed"], dir);

  // Write .gitignore
  const gitignorePath = join(dir, ".gitignore");
  const gitignoreContent = "*.tmp\n*.db-shm\n*.db-wal\nnode_modules/\n";
  await Bun.write(gitignorePath, gitignoreContent);

  // Stage .gitignore
  const addResult = await runGit(["add", ".gitignore"], dir);
  if (!addResult.ok) {
    return { ok: false, error: `git add .gitignore failed: ${addResult.error}` };
  }

  // Initial commit
  const commitMsg = "Init: repository initialized\n\nAutomated by pai-seed";
  const commitResult = await runGit(["commit", "-m", commitMsg], dir);
  if (!commitResult.ok) {
    return { ok: false, error: `initial commit failed: ${commitResult.error}` };
  }

  return { ok: true, initialized: true };
}

// =============================================================================
// F-003 3: commitSeedChange
// =============================================================================

/**
 * Stage seed.json and seed.schema.json, then commit with the given message.
 *
 * - Ignores errors from `git add` if files don't exist
 * - If no staged changes: returns { ok: true } without committing
 * - Appends "Automated by pai-seed" trailer to message
 */
export async function commitSeedChange(
  message: string,
  paiDir?: string,
): Promise<GitResult> {
  const dir = paiDir ?? dirname(resolveSeedPath());

  // Stage seed files individually (ignore errors if files don't exist)
  await runGit(["add", "seed.json"], dir);
  await runGit(["add", "seed.schema.json"], dir);

  // Check if there are staged changes
  const diffResult = await runGit(["diff", "--cached", "--quiet"], dir);
  if (diffResult.ok) {
    // Exit 0 means no changes — nothing to commit
    return { ok: true };
  }
  // Exit non-zero from diff --cached --quiet means there ARE changes — proceed

  // But first distinguish: was it actually "has changes" or a real error?
  // git diff --cached --quiet exits 1 when there are changes, other codes on error
  // Since runGit wraps non-zero as ok: false, we check if it's a legitimate "has changes"
  // by attempting the commit

  const commitMsg = `${message}\n\nAutomated by pai-seed`;
  const commitResult = await runGit(["commit", "-m", commitMsg], dir);
  if (!commitResult.ok) {
    return { ok: false, error: commitResult.error };
  }

  return { ok: true };
}

// =============================================================================
// F-003 4: getLastCommitMessage
// =============================================================================

/**
 * Get the full message of the most recent commit.
 * Returns null if there are no commits or if the directory is not a repo.
 */
export async function getLastCommitMessage(
  paiDir?: string,
): Promise<string | null> {
  const dir = paiDir ?? dirname(resolveSeedPath());
  const result = await runGit(["log", "-1", "--format=%B"], dir);
  if (!result.ok) return null;
  return result.stdout || null;
}

// =============================================================================
// F-003 5: hasUncommittedChanges
// =============================================================================

/**
 * Check if there are uncommitted changes (staged or unstaged) in the repo.
 * Returns true if `git status --porcelain` produces any output.
 */
export async function hasUncommittedChanges(
  paiDir?: string,
): Promise<boolean> {
  const dir = paiDir ?? dirname(resolveSeedPath());
  const result = await runGit(["status", "--porcelain"], dir);
  if (!result.ok) return false;
  return result.stdout.length > 0;
}

// =============================================================================
// F-003 6: writeSeedWithCommit
// =============================================================================

/**
 * Write a SeedConfig to disk and commit the change to git.
 *
 * - If write fails: returns the write error (skip git)
 * - If write succeeds but git fails: returns { ok: true } (git is non-fatal)
 * - Returns WriteResult from F-002's writeSeed
 */
export async function writeSeedWithCommit(
  config: SeedConfig,
  message: string,
  seedPath?: string,
): Promise<WriteResult> {
  const path = resolveSeedPath(seedPath);
  const paiDir = dirname(path);

  // Write the seed file
  const writeResult = await writeSeed(config, path);
  if (!writeResult.ok) {
    return writeResult;
  }

  // Attempt git commit (non-fatal)
  await commitSeedChange(message, paiDir);

  return { ok: true };
}

// =============================================================================
// F-003 7: repairFromGit
// =============================================================================

/**
 * Attempt to repair a corrupted seed.json from git history.
 *
 * Steps:
 * 1. Copy corrupted file to seed.json.corrupted
 * 2. git checkout -- seed.json
 * 3. Read and validate restored file
 * 4. If valid: commit repair, return { repaired: true }
 * 5. If invalid or no history: createDefaultSeed + writeSeed, return with message
 *
 * Never throws.
 */
export async function repairFromGit(
  seedPath?: string,
  paiDir?: string,
): Promise<RepairResult> {
  const path = seedPath ?? resolveSeedPath();
  const dir = paiDir ?? dirname(path);

  try {
    // Step 1: Copy corrupted file to .corrupted backup
    const corruptedPath = path + ".corrupted";
    try {
      await copyFile(path, corruptedPath);
    } catch {
      // File might not exist or be unreadable — continue
    }

    // Step 2: Try to restore from git history
    const checkoutResult = await runGit(["checkout", "--", "seed.json"], dir);

    if (checkoutResult.ok) {
      // Step 3: Read and validate restored file
      try {
        const file = Bun.file(path);
        const content = await file.text();
        const parsed = JSON.parse(content);
        const validation = validateSeed(parsed);

        if (validation.valid) {
          // Step 4: Re-write the seed (ensures schema is up to date)
          // and commit the repair. Use --allow-empty to record the event
          // even when the checkout already matches HEAD.
          await writeSeed(validation.config, path);
          await runGit(["add", "seed.json"], dir);
          await runGit(["add", "seed.schema.json"], dir);
          const commitMsg = "Repair: recovered from corruption\n\nAutomated by pai-seed";
          const commitResult = await runGit(["commit", "--allow-empty", "-m", commitMsg], dir);
          // Non-fatal if commit fails
          void commitResult;

          return {
            ok: true,
            config: validation.config,
            repaired: true,
            message: "Recovered seed from git history",
          };
        }
      } catch {
        // Restored file is not valid JSON or failed validation — fall through
      }
    }

    // Step 5: No valid git history — fall back to defaults
    const defaultConfig = createDefaultSeed();
    await writeSeed(defaultConfig, path);
    await commitSeedChange("Repair: reset to defaults (no valid history)", dir);

    return {
      ok: true,
      config: defaultConfig,
      repaired: false,
      message: "No valid git history found; reset to defaults",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-003 8: loadSeedWithGit
// =============================================================================

/**
 * Load seed.json with git integration.
 *
 * Flow:
 * 1. Ensure git repo exists (initGitRepo)
 * 2. loadSeed from F-002
 * 3. On created: commit "Init: default seed created"
 * 4. On merged: commit "Merge: filled missing fields from defaults"
 * 5. On parse_error/validation_error: repairFromGit
 * 6. On read_error/permission_error: return error as-is
 *
 * Returns LoadResult (same type as F-002).
 */
export async function loadSeedWithGit(
  seedPath?: string,
): Promise<LoadResult> {
  const path = seedPath ?? resolveSeedPath();
  const paiDir = dirname(path);

  // Step 1: Ensure git repo
  await initGitRepo(paiDir);

  // Step 2: Load seed via F-002
  const loadResult = await loadSeed(path);

  if (loadResult.ok) {
    if (loadResult.created) {
      // Step 3: New seed created — commit
      await commitSeedChange("Init: default seed created", paiDir);
    } else if (loadResult.merged) {
      // Step 4: Merged with defaults — commit
      await commitSeedChange("Merge: filled missing fields from defaults", paiDir);
    }
    return loadResult;
  }

  // Step 5/6: Handle errors
  const errorCode = loadResult.error.code;

  if (errorCode === "parse_error" || errorCode === "validation_error") {
    // Attempt repair from git
    const repairResult = await repairFromGit(path, paiDir);
    if (repairResult.ok) {
      return {
        ok: true,
        config: repairResult.config,
        created: !repairResult.repaired,
        merged: false,
      };
    }
    // Repair failed — return original error
    return loadResult;
  }

  // read_error / permission_error — pass through
  return loadResult;
}
