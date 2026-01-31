import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isGitRepo,
  initGitRepo,
  commitSeedChange,
  getLastCommitMessage,
  hasUncommittedChanges,
  writeSeedWithCommit,
  repairFromGit,
  loadSeedWithGit,
} from "../src/git";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed } from "../src/loader";
import type { SeedConfig } from "../src/schema";

// =============================================================================
// Temp directory management
// =============================================================================

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-git-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// =============================================================================
// Git test helpers
// =============================================================================

/** Initialize a git repo with local-only config (never touches --global). */
async function initTestGitRepo(dir: string): Promise<void> {
  const init = Bun.spawn(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await init.exited;
  const email = Bun.spawn(["git", "config", "user.email", "test@pai-seed.local"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await email.exited;
  const name = Bun.spawn(["git", "config", "user.name", "pai-seed-test"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await name.exited;
}

/** Create a valid SeedConfig for testing. */
function validSeed(): SeedConfig {
  return createDefaultSeed();
}

/** Create a partial seed JSON string (missing state layer). */
function partialSeedJson(): string {
  return JSON.stringify(
    {
      version: "1.0.0",
      identity: {
        principalName: "Alice",
        aiName: "Nova",
        catchphrase: "Nova online.",
        voiceId: "custom-voice",
        preferences: {
          responseStyle: "concise",
          timezone: "Europe/Zurich",
          locale: "de-CH",
        },
      },
      learned: {
        patterns: [],
        insights: [],
        selfKnowledge: [],
      },
    },
    null,
    2,
  ) + "\n";
}

// =============================================================================
// runGit (internal, tested indirectly through public functions)
// =============================================================================

describe("runGit (indirect via public API)", () => {
  test("git version check succeeds (isGitRepo uses runGit internally)", async () => {
    // A plain directory is not a repo — runGit executes and returns cleanly
    const result = await isGitRepo(testDir);
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });

  test("invalid git command returns graceful failure (initGitRepo in bad dir)", async () => {
    // Try to init in a path that does not exist
    const badDir = join(testDir, "does-not-exist-at-all");
    const result = await initGitRepo(badDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  test("git captures stdout correctly (getLastCommitMessage)", async () => {
    await initTestGitRepo(testDir);
    await writeFile(join(testDir, "test.txt"), "hello");
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Test: captured message"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    const message = await getLastCommitMessage(testDir);
    expect(message).not.toBeNull();
    expect(message!).toContain("Test: captured message");
  });

  test("bad working directory returns error without throwing", async () => {
    const result = await isGitRepo("/nonexistent/path/that/surely/does/not/exist");
    // Should return false (not a repo) rather than throwing
    expect(result).toBe(false);
  });
});

// =============================================================================
// isGitRepo
// =============================================================================

describe("isGitRepo", () => {
  test("returns false for a plain directory", async () => {
    const result = await isGitRepo(testDir);
    expect(result).toBe(false);
  });

  test("returns true after git init", async () => {
    await initTestGitRepo(testDir);
    const result = await isGitRepo(testDir);
    expect(result).toBe(true);
  });
});

// =============================================================================
// initGitRepo
// =============================================================================

describe("initGitRepo", () => {
  test("creates .git directory in empty directory", async () => {
    const result = await initGitRepo(testDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.initialized).toBe(true);
    }

    // .git should exist — verify via test command
    // .git is a directory, check via Bun.spawn
    const check = Bun.spawn(["test", "-d", join(testDir, ".git")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await check.exited;
    expect(exitCode).toBe(0);
  });

  test("creates .gitignore with expected content", async () => {
    await initGitRepo(testDir);

    const gitignore = await readFile(join(testDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("*.tmp");
    expect(gitignore).toContain("*.db-shm");
    expect(gitignore).toContain("*.db-wal");
    expect(gitignore).toContain("node_modules/");
  });

  test("creates initial commit", async () => {
    await initGitRepo(testDir);

    // Should have at least one commit
    const log = Bun.spawn(["git", "log", "--oneline"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const stdout = await new Response(log.stdout).text();
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  test("idempotent — second call returns initialized: false", async () => {
    const first = await initGitRepo(testDir);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.initialized).toBe(true);

    const second = await initGitRepo(testDir);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.initialized).toBe(false);
  });

  test("existing repo is left untouched", async () => {
    // Pre-init with our own commit
    await initTestGitRepo(testDir);
    await writeFile(join(testDir, "existing.txt"), "pre-existing");
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Existing commit"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    // initGitRepo should detect it's already a repo
    const result = await initGitRepo(testDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.initialized).toBe(false);

    // Original commit should still be the latest (no extra commits added)
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Existing commit");
  });
});

// =============================================================================
// commitSeedChange
// =============================================================================

describe("commitSeedChange", () => {
  test("commits seed.json change with correct message", async () => {
    await initTestGitRepo(testDir);

    // Write a seed file
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);

    const result = await commitSeedChange("Learn: new pattern discovered", testDir);
    expect(result.ok).toBe(true);

    // Verify the commit message
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Learn: new pattern discovered");
    expect(msg).toContain("Automated by pai-seed");
  });

  test("no-change returns ok: true without creating commit", async () => {
    await initTestGitRepo(testDir);

    // Create initial seed and commit it
    const seedPath = join(testDir, "seed.json");
    await writeSeed(validSeed(), seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Initial seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    // Commit again without changes
    const result = await commitSeedChange("Learn: nothing changed", testDir);
    expect(result.ok).toBe(true);

    // Last commit should still be the initial one
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Initial seed");
  });

  test("commit message format includes automated trailer", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    await writeSeed(validSeed(), seedPath);

    await commitSeedChange("Update: changed preferences", testDir);

    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Update: changed preferences");
    expect(msg).toContain("Automated by pai-seed");
  });

  test("sequential commits produce separate history entries", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);
    await commitSeedChange("Init: first change", testDir);

    // Modify seed
    const modified = { ...config, version: "1.0.0" };
    modified.identity = { ...config.identity, aiName: "Nova" };
    await writeSeed(modified, seedPath);
    await commitSeedChange("Update: renamed AI", testDir);

    // Check commit count
    const log = Bun.spawn(["git", "log", "--oneline"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const stdout = await new Response(log.stdout).text();
    const commitLines = stdout.trim().split("\n").filter((l) => l.length > 0);
    expect(commitLines.length).toBeGreaterThanOrEqual(2);
  });

  test("no-repo returns error", async () => {
    // testDir is NOT a git repo
    const result = await commitSeedChange("Learn: should fail", testDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
    }
  });
});

// =============================================================================
// getLastCommitMessage
// =============================================================================

describe("getLastCommitMessage", () => {
  test("returns commit message after a commit", async () => {
    await initTestGitRepo(testDir);
    await writeFile(join(testDir, "file.txt"), "data");
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Test commit message"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    const msg = await getLastCommitMessage(testDir);
    expect(msg).not.toBeNull();
    expect(msg!).toContain("Test commit message");
  });

  test("returns null for non-repo directory", async () => {
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toBeNull();
  });
});

// =============================================================================
// hasUncommittedChanges
// =============================================================================

describe("hasUncommittedChanges", () => {
  test("returns false for clean repo", async () => {
    await initTestGitRepo(testDir);
    await writeFile(join(testDir, "file.txt"), "data");
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Clean state"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    const result = await hasUncommittedChanges(testDir);
    expect(result).toBe(false);
  });

  test("returns true for dirty repo", async () => {
    await initTestGitRepo(testDir);
    await writeFile(join(testDir, "file.txt"), "data");
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Initial"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    // Create an uncommitted change
    await writeFile(join(testDir, "dirty.txt"), "uncommitted");

    const result = await hasUncommittedChanges(testDir);
    expect(result).toBe(true);
  });
});

// =============================================================================
// writeSeedWithCommit
// =============================================================================

describe("writeSeedWithCommit", () => {
  test("writes seed file and creates git commit", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    const result = await writeSeedWithCommit(config, "Init: write with commit", seedPath);

    expect(result.ok).toBe(true);

    // File should exist
    const file = Bun.file(seedPath);
    expect(await file.exists()).toBe(true);

    // Git commit should exist
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Init: write with commit");
  });

  test("write failure skips git (returns write error)", async () => {
    await initTestGitRepo(testDir);

    // Invalid config that will fail writeSeed validation
    const invalid = { version: "1.0.0" } as unknown as SeedConfig;
    const seedPath = join(testDir, "seed.json");
    const result = await writeSeedWithCommit(invalid, "Should not commit", seedPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
    }
  });

  test("git failure is non-fatal (write still succeeds)", async () => {
    // Do NOT init git — git operations will fail
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    const result = await writeSeedWithCommit(config, "Should still write", seedPath);

    // Write should succeed even though git fails
    expect(result.ok).toBe(true);

    // File should exist on disk
    const file = Bun.file(seedPath);
    expect(await file.exists()).toBe(true);
  });

  test("performance: completes in under 500ms", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    const config = validSeed();

    const start = performance.now();
    await writeSeedWithCommit(config, "Perf: timing test", seedPath);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});

// =============================================================================
// repairFromGit
// =============================================================================

describe("repairFromGit", () => {
  test("restores valid seed from git history", async () => {
    await initTestGitRepo(testDir);

    // Write and commit a valid seed
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Good seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    // Corrupt the seed file
    await writeFile(seedPath, "{ totally broken json }}}");

    const result = await repairFromGit(seedPath, testDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
      expect(result.config.version).toBe("1.0.0");
    }
  });

  test("preserves corrupted file as .corrupted", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Good seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    // Corrupt the file
    const corruptContent = "CORRUPTED DATA";
    await writeFile(seedPath, corruptContent);

    await repairFromGit(seedPath, testDir);

    // .corrupted backup should exist with the corrupted content
    const corruptedPath = seedPath + ".corrupted";
    const backup = await readFile(corruptedPath, "utf-8");
    expect(backup).toBe(corruptContent);
  });

  test("no git history falls back to defaults", async () => {
    // No git repo at all — repair should create defaults
    const seedPath = join(testDir, "seed.json");
    await writeFile(seedPath, "broken");

    const result = await repairFromGit(seedPath, testDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.identity.principalName).toBe("User");
      expect(result.message).toBeDefined();
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  test("validates the restored seed", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Good seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    await writeFile(seedPath, "corrupt");

    const result = await repairFromGit(seedPath, testDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The restored config should be a valid SeedConfig
      expect(result.config.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(result.config.identity).toBeDefined();
      expect(result.config.learned).toBeDefined();
      expect(result.config.state).toBeDefined();
    }
  });

  test("creates repair commit in git history", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Good seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    await writeFile(seedPath, "corrupt");

    await repairFromGit(seedPath, testDir);

    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Repair");
  });
});

// =============================================================================
// loadSeedWithGit
// =============================================================================

describe("loadSeedWithGit", () => {
  test("fresh directory: creates default seed and commits", async () => {
    const seedPath = join(testDir, "seed.json");
    const result = await loadSeedWithGit(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(true);
      expect(result.config.version).toBe("1.0.0");
    }

    // Should have a git repo
    const isRepo = await isGitRepo(testDir);
    expect(isRepo).toBe(true);

    // Should have a commit
    const msg = await getLastCommitMessage(testDir);
    expect(msg).not.toBeNull();
    expect(msg!).toContain("Init");
  });

  test("valid existing seed loads cleanly without extra commits", async () => {
    await initTestGitRepo(testDir);

    // Pre-write a valid seed and commit it
    const seedPath = join(testDir, "seed.json");
    await writeSeed(validSeed(), seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Existing seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    const result = await loadSeedWithGit(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(false);
      expect(result.merged).toBe(false);
    }

    // Last commit should still be "Existing seed" — no extra commits
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Existing seed");
  });

  test("partial seed merges defaults and commits", async () => {
    await initTestGitRepo(testDir);

    const seedPath = join(testDir, "seed.json");
    await writeFile(seedPath, partialSeedJson());
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Partial seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    const result = await loadSeedWithGit(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged).toBe(true);
      expect(result.config.identity.principalName).toBe("Alice");
      expect(result.config.state).toBeDefined();
    }

    // Should have a merge commit
    const msg = await getLastCommitMessage(testDir);
    expect(msg).toContain("Merge");
  });

  test("corrupt seed triggers repair from git history", async () => {
    await initTestGitRepo(testDir);

    // Write and commit a valid seed
    const seedPath = join(testDir, "seed.json");
    await writeSeed(validSeed(), seedPath);
    const add = Bun.spawn(["git", "add", "."], { cwd: testDir, stdout: "pipe", stderr: "pipe" });
    await add.exited;
    const commit = Bun.spawn(["git", "commit", "-m", "Valid seed"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await commit.exited;

    // Corrupt the file
    await writeFile(seedPath, "{ broken json!!!");

    const result = await loadSeedWithGit(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.version).toBe("1.0.0");
    }
  });

  test("corrupt seed with no git history falls back to defaults", async () => {
    const seedPath = join(testDir, "seed.json");
    await writeFile(seedPath, "totally broken");

    const result = await loadSeedWithGit(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.identity.principalName).toBe("User");
      expect(result.config.identity.aiName).toBe("PAI");
    }
  });

  test("read_error and permission_error pass through without repair", async () => {
    // Create a directory where seed.json would be — loadSeed tries to read a directory as a file
    const dirAsFile = join(testDir, "a-directory");
    await mkdir(dirAsFile, { recursive: true });
    // Write a placeholder inside so the "directory" exists as a path
    await writeFile(join(dirAsFile, "child"), "x");

    // Pass the directory itself as the seed path — reading a directory as a file causes read_error
    const result = await loadSeedWithGit(dirAsFile);
    // Should be an error (not repaired since it's a read_error)
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["read_error", "permission_error", "parse_error"]).toContain(result.error.code);
    }
  });

  test("commit history reflects full lifecycle", async () => {
    const seedPath = join(testDir, "seed.json");

    // Fresh load — should create + init commit
    await loadSeedWithGit(seedPath);

    // Check there is a commit
    const log = Bun.spawn(["git", "log", "--oneline"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const stdout = await new Response(log.stdout).text();
    const commitLines = stdout.trim().split("\n").filter((l) => l.length > 0);
    expect(commitLines.length).toBeGreaterThanOrEqual(1);
  });
});
