import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupAnswersSchema,
  detectTimezone,
  buildSeedFromAnswers,
  isFirstRun,
  runSetup,
} from "../src/setup";
import type { SetupAnswers } from "../src/setup";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed } from "../src/loader";
import { getLastCommitMessage } from "../src/git";

// =============================================================================
// Temp directory management
// =============================================================================

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-setup-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// =============================================================================
// Git test helper
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

// =============================================================================
// setupAnswersSchema
// =============================================================================

describe("setupAnswersSchema", () => {
  test("accepts valid full answers", () => {
    const input = {
      principalName: "Daniel",
      aiName: "Nova",
      catchphrase: "Nova online.",
      voiceId: "custom-voice-123",
      responseStyle: "concise" as const,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    };

    const result = setupAnswersSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.principalName).toBe("Daniel");
      expect(result.data.aiName).toBe("Nova");
      expect(result.data.catchphrase).toBe("Nova online.");
      expect(result.data.voiceId).toBe("custom-voice-123");
      expect(result.data.responseStyle).toBe("concise");
      expect(result.data.timezone).toBe("Europe/Zurich");
      expect(result.data.locale).toBe("de-CH");
    }
  });

  test("accepts minimal answers (principalName only)", () => {
    const input = { principalName: "Alice" };

    const result = setupAnswersSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.principalName).toBe("Alice");
      expect(result.data.aiName).toBeUndefined();
      expect(result.data.catchphrase).toBeUndefined();
      expect(result.data.voiceId).toBeUndefined();
      expect(result.data.responseStyle).toBeUndefined();
      expect(result.data.timezone).toBeUndefined();
      expect(result.data.locale).toBeUndefined();
    }
  });

  test("rejects empty/missing principalName", () => {
    const empty = { principalName: "" };
    const missing = {};

    expect(setupAnswersSchema.safeParse(empty).success).toBe(false);
    expect(setupAnswersSchema.safeParse(missing).success).toBe(false);
  });
});

// =============================================================================
// detectTimezone
// =============================================================================

describe("detectTimezone", () => {
  test("returns valid IANA timezone string", () => {
    const tz = detectTimezone();

    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
    // IANA timezones contain a "/" (e.g., "America/New_York", "Europe/Zurich")
    // UTC is also valid as a fallback
    expect(tz === "UTC" || tz.includes("/")).toBe(true);
  });

  test("never throws (always returns a string)", () => {
    let result: string | undefined;
    let didThrow = false;

    try {
      result = detectTimezone();
    } catch {
      didThrow = true;
    }

    expect(didThrow).toBe(false);
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// buildSeedFromAnswers
// =============================================================================

describe("buildSeedFromAnswers", () => {
  test("all fields provided: valid SeedConfig with all overrides applied", () => {
    const answers: SetupAnswers = {
      principalName: "Daniel",
      aiName: "Nova",
      catchphrase: "Nova reporting for duty.",
      voiceId: "voice-abc",
      responseStyle: "concise",
      timezone: "Europe/Zurich",
      locale: "de-CH",
    };

    const config = buildSeedFromAnswers(answers);

    // Identity overrides
    expect(config.identity.principalName).toBe("Daniel");
    expect(config.identity.aiName).toBe("Nova");
    expect(config.identity.catchphrase).toBe("Nova reporting for duty.");
    expect(config.identity.voiceId).toBe("voice-abc");

    // Preferences overrides
    expect(config.identity.preferences.responseStyle).toBe("concise");
    expect(config.identity.preferences.timezone).toBe("Europe/Zurich");
    expect(config.identity.preferences.locale).toBe("de-CH");

    // Structural integrity
    expect(config.version).toBe("1.0.0");
    expect(config.learned).toBeDefined();
    expect(config.state).toBeDefined();
  });

  test("minimal input (principalName only): valid SeedConfig with defaults", () => {
    const answers: SetupAnswers = {
      principalName: "Bob",
    };

    const config = buildSeedFromAnswers(answers);

    expect(config.identity.principalName).toBe("Bob");
    // Defaults should be applied
    expect(config.identity.aiName).toBe("PAI");
    expect(config.identity.catchphrase).toBe("PAI here, ready to go.");
    expect(config.identity.voiceId).toBe("default");
    expect(config.identity.preferences.responseStyle).toBe("adaptive");
    expect(config.identity.preferences.locale).toBe("en-US");
    // Timezone comes from detectTimezone() which returns a real value
    expect(config.identity.preferences.timezone.length).toBeGreaterThan(0);
  });

  test("catchphrase derived from aiName when not provided", () => {
    const answers: SetupAnswers = {
      principalName: "Alice",
      aiName: "CustomAI",
    };

    const config = buildSeedFromAnswers(answers);

    expect(config.identity.aiName).toBe("CustomAI");
    expect(config.identity.catchphrase).toBe("CustomAI here, ready to go.");
  });

  test("custom catchphrase preserved when provided", () => {
    const answers: SetupAnswers = {
      principalName: "Alice",
      aiName: "CustomAI",
      catchphrase: "Let's do this!",
    };

    const config = buildSeedFromAnswers(answers);

    expect(config.identity.catchphrase).toBe("Let's do this!");
  });

  test("invalid input (empty principalName) throws", () => {
    const answers = { principalName: "" } as SetupAnswers;

    expect(() => buildSeedFromAnswers(answers)).toThrow();
  });
});

// =============================================================================
// isFirstRun
// =============================================================================

describe("isFirstRun", () => {
  test("no seed file: returns true", async () => {
    const seedPath = join(testDir, "nonexistent", "seed.json");
    const result = await isFirstRun(seedPath);
    expect(result).toBe(true);
  });

  test("default seed (principalName 'User'): returns true", async () => {
    const seedPath = join(testDir, "seed.json");
    const defaultSeed = createDefaultSeed();
    await writeSeed(defaultSeed, seedPath);

    const result = await isFirstRun(seedPath);
    expect(result).toBe(true);
  });

  test("customized seed (principalName 'Daniel'): returns false", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = createDefaultSeed();
    config.identity.principalName = "Daniel";
    config.identity.aiName = "Nova";
    config.identity.catchphrase = "Nova online.";
    await writeSeed(config, seedPath);

    const result = await isFirstRun(seedPath);
    expect(result).toBe(false);
  });

  test("corrupted file: returns true (safe default)", async () => {
    const seedPath = join(testDir, "seed.json");
    await Bun.write(seedPath, "{ totally broken json }}}");

    const result = await isFirstRun(seedPath);
    expect(result).toBe(true);
  });

  test("performance: completes in under 100ms", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = createDefaultSeed();
    await writeSeed(config, seedPath);

    const start = performance.now();
    await isFirstRun(seedPath);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

// =============================================================================
// runSetup
// =============================================================================

describe("runSetup", () => {
  test("first run: creates config, returns ok with created: true", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const answers: SetupAnswers = {
      principalName: "Daniel",
      aiName: "Nova",
      catchphrase: "Nova online.",
    };

    const result = await runSetup(answers, seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(true);
      expect(result.config.identity.principalName).toBe("Daniel");
      expect(result.config.identity.aiName).toBe("Nova");
      expect(result.config.identity.catchphrase).toBe("Nova online.");
    }

    // File should exist on disk
    const file = Bun.file(seedPath);
    expect(await file.exists()).toBe(true);
  });

  test("already configured: returns existing config with created: false", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    // Pre-write a customized seed
    const existing = createDefaultSeed();
    existing.identity.principalName = "Daniel";
    existing.identity.aiName = "Nova";
    existing.identity.catchphrase = "Nova online.";
    await writeSeed(existing, seedPath);

    const answers: SetupAnswers = {
      principalName: "ShouldBeIgnored",
      aiName: "ShouldBeIgnored",
    };

    const result = await runSetup(answers, seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(false);
      // Should return the EXISTING config, not the new answers
      expect(result.config.identity.principalName).toBe("Daniel");
      expect(result.config.identity.aiName).toBe("Nova");
    }
  });

  test("write succeeds: git commit message includes setup marker", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const answers: SetupAnswers = {
      principalName: "Daniel",
      aiName: "Atlas",
    };

    await runSetup(answers, seedPath);

    const msg = await getLastCommitMessage(testDir);
    expect(msg).not.toBeNull();
    expect(msg!).toContain("Init: first-run setup completed");
  });

  test("idempotency: calling twice, second returns created: false", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const answers: SetupAnswers = {
      principalName: "Daniel",
      aiName: "Nova",
    };

    const first = await runSetup(answers, seedPath);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.created).toBe(true);
    }

    const second = await runSetup(answers, seedPath);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.created).toBe(false);
      // Should preserve the config from the first run
      expect(second.config.identity.principalName).toBe("Daniel");
    }
  });
});
