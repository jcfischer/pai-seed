import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed, loadSeed } from "../src/loader";
import { initGitRepo, writeSeedWithCommit } from "../src/git";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let seedPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-cli-test-"));
  // CLI uses homedir()/.pai/seed.json, and we set HOME=tempDir
  const paiDir = join(tempDir, ".pai");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(paiDir, { recursive: true });
  seedPath = join(paiDir, "seed.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * Run the CLI with given args and capture stdout/stderr.
 */
async function runCLI(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    ["bun", "run", "src/cli.ts", ...args],
    {
      cwd: "/Users/fischer/work/pai-seed",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PAI_SEED_PATH: seedPath, HOME: tempDir, ...env },
    },
  );
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { stdout, stderr, exitCode };
}

// =============================================================================
// T-11.1: CLI Dispatcher
// =============================================================================

describe("CLI dispatcher", () => {
  test("help command outputs usage text", async () => {
    const { stdout, exitCode } = await runCLI(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pai-seed");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("show");
    expect(stdout).toContain("learn");
  });

  test("unknown command exits with error", async () => {
    const { stderr, exitCode } = await runCLI(["nonexistent"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});

// =============================================================================
// T-11.2: show Command
// =============================================================================

describe("show command", () => {
  test("outputs identity summary", async () => {
    const seed = createDefaultSeed();
    seed.identity.principalName = "TestUser";
    seed.identity.aiName = "TestAI";
    await writeSeed(seed, seedPath);

    const { stdout, exitCode } = await runCLI(["show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("TestAI");
    expect(stdout).toContain("TestUser");
  });

  test("outputs learning counts", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push({
      id: "p1",
      content: "Test pattern",
      source: "test",
      extractedAt: new Date().toISOString(),
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      tags: [],
    });
    await writeSeed(seed, seedPath);

    const { stdout, exitCode } = await runCLI(["show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Patterns: 1");
    expect(stdout).toContain("Total: 1");
  });

  test("handles missing seed gracefully", async () => {
    // seedPath doesn't exist — loadSeed creates default
    const { stdout, exitCode } = await runCLI(["show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Identity");
  });
});

// =============================================================================
// T-11.3: status Command
// =============================================================================

describe("status command", () => {
  test("shows seed path and version", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const { stdout, exitCode } = await runCLI(["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Path:");
    expect(stdout).toContain("Version: 1.0.0");
  });

  test("shows validation result", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const { stdout, exitCode } = await runCLI(["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Valid:");
  });

  test("handles missing file", async () => {
    const { stdout, exitCode } = await runCLI(["status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Exists:");
  });
});

// =============================================================================
// T-11.4: diff Command
// =============================================================================

describe("diff command", () => {
  test("reports no changes when clean", async () => {
    const paiDir = join(tempDir, ".pai");
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);
    await initGitRepo(paiDir);
    const { commitSeedChange } = await import("../src/git");
    await commitSeedChange("Init: seed", paiDir);

    const { stdout, exitCode } = await runCLI(["diff"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBeTruthy();
  });

  test("handles non-git directory", async () => {
    const { stdout, exitCode } = await runCLI(["diff"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Not a git repository");
  });
});

// =============================================================================
// T-11.5: learn Command
// =============================================================================

describe("learn command", () => {
  test("adds pattern to seed", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const { stdout, exitCode } = await runCLI([
      "learn",
      "pattern",
      "User prefers concise responses",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Added pattern");

    // Verify in seed
    const loaded = await loadSeed(seedPath);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.learned.patterns.length).toBe(1);
    expect(loaded.config.learned.patterns[0].content).toBe(
      "User prefers concise responses",
    );
  });

  test("validates type argument", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const { stderr, exitCode } = await runCLI([
      "learn",
      "invalid_type",
      "some content",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid type");
  });

  test("requires content argument", async () => {
    const { stderr, exitCode } = await runCLI(["learn"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage");
  });
});

// =============================================================================
// T-11.6: forget Command
// =============================================================================

describe("forget command", () => {
  test("removes learning by ID", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push({
      id: "test-forget-id",
      content: "Something to forget",
      source: "test",
      extractedAt: new Date().toISOString(),
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      tags: [],
    });
    await writeSeed(seed, seedPath);

    const { stdout, exitCode } = await runCLI(["forget", "test-forget-id"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Removed");

    // Verify removed
    const loaded = await loadSeed(seedPath);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.learned.patterns.length).toBe(0);
  });

  test("returns error for unknown ID", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const { stderr, exitCode } = await runCLI(["forget", "nonexistent-id"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// =============================================================================
// T-11.7: repair Command
// =============================================================================

describe("repair command", () => {
  test("calls repairFromGit and reports result", async () => {
    // Without a git repo, repair falls back to defaults
    const { stdout, exitCode } = await runCLI(["repair"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBeTruthy();
  });
});

// =============================================================================
// T-11.8: Package Integration
// =============================================================================

describe("package integration", () => {
  test("CLI executable via bun run src/cli.ts", async () => {
    const { exitCode } = await runCLI(["help"]);
    expect(exitCode).toBe(0);
  });

  test("main function importable and callable", async () => {
    const { main } = await import("../src/cli");
    expect(typeof main).toBe("function");
  });
});
