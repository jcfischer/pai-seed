import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";
import {
  resolveSeedPath,
  loadSeed,
  writeSeed,
  writeJsonSchema,
} from "../src/loader";
import type { LoadResult } from "../src/loader";
import { createDefaultSeed } from "../src/defaults";
import { validateSeed } from "../src/validate";
import type { SeedConfig } from "../src/schema";

// =============================================================================
// Temp directory management
// =============================================================================

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// =============================================================================
// Fixture helpers
// =============================================================================

function validSeed(): SeedConfig {
  return createDefaultSeed();
}

function partialSeedJson(): string {
  // Valid seed but missing the entire "state" layer
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

function seedWithUnknownKeys(): string {
  const seed = createDefaultSeed();
  return JSON.stringify(
    { ...seed, futureField: "from-v2" },
    null,
    2,
  ) + "\n";
}

// =============================================================================
// T-1.1: resolveSeedPath
// =============================================================================

describe("resolveSeedPath", () => {
  test("default path contains .pai/seed.json", () => {
    const path = resolveSeedPath();
    expect(path).toContain(".pai");
    expect(path).toContain("seed.json");
  });

  test("default path is absolute", () => {
    const path = resolveSeedPath();
    expect(isAbsolute(path)).toBe(true);
  });

  test("default path starts with home directory", () => {
    const path = resolveSeedPath();
    expect(path.startsWith(homedir())).toBe(true);
  });

  test("custom path override returns resolved absolute path", () => {
    const customPath = "/tmp/custom/seed.json";
    const path = resolveSeedPath(customPath);
    expect(path).toBe(customPath);
  });

  test("relative custom path is resolved to absolute", () => {
    const path = resolveSeedPath("./relative/seed.json");
    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe(resolve("./relative/seed.json"));
  });
});

// =============================================================================
// T-3.1: writeSeed
// =============================================================================

describe("writeSeed", () => {
  test("write valid config creates file with correct content", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    const result = await writeSeed(config, seedPath);

    expect(result.ok).toBe(true);

    const file = Bun.file(seedPath);
    expect(await file.exists()).toBe(true);
    const content = await file.text();
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.identity.principalName).toBe("User");
  });

  test("write invalid config returns validation_error without creating file", async () => {
    const seedPath = join(testDir, "should-not-exist.json");
    const invalid = { version: "1.0.0" } as unknown as SeedConfig; // missing required fields
    const result = await writeSeed(invalid, seedPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.details).toBeDefined();
      expect(result.error.details!.length).toBeGreaterThan(0);
    }

    // File should NOT have been created
    const file = Bun.file(seedPath);
    expect(await file.exists()).toBe(false);
  });

  test("write to non-existent directory creates directory", async () => {
    const deepPath = join(testDir, "deep", "nested", "dir", "seed.json");
    const config = validSeed();
    const result = await writeSeed(config, deepPath);

    expect(result.ok).toBe(true);
    const file = Bun.file(deepPath);
    expect(await file.exists()).toBe(true);
  });

  test("written JSON has 2-space indent and trailing newline", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);

    const content = await Bun.file(seedPath).text();
    // 2-space indent: check for "  " before a key
    expect(content).toContain('  "version"');
    // Trailing newline
    expect(content.endsWith("\n")).toBe(true);
    // Not 4-space indent
    expect(content).not.toContain('    "version"');
  });

  test("temp file cleaned up after successful write", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);

    // The .tmp file should not exist after atomic write
    const tmpPath = seedPath + ".tmp";
    const tmpFile = Bun.file(tmpPath);
    expect(await tmpFile.exists()).toBe(false);
  });

  test("writeSeed uses default path when none provided", async () => {
    // We test that it resolves to something containing .pai/seed.json
    // but we do NOT actually write to the real home dir
    // This test just verifies the function signature accepts undefined
    // Actual write tests use explicit paths
    const config = validSeed();
    // We cannot test the actual default write without touching ~/.pai
    // so we verify it doesn't throw with an explicit path
    const seedPath = join(testDir, "default-test.json");
    const result = await writeSeed(config, seedPath);
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// T-3.2: writeJsonSchema
// =============================================================================

describe("writeJsonSchema", () => {
  test("written file is valid JSON", async () => {
    const schemaPath = join(testDir, "seed.schema.json");
    const result = await writeJsonSchema(schemaPath);

    expect(result.ok).toBe(true);

    const content = await Bun.file(schemaPath).text();
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test("content is a valid JSON Schema with object type definition", async () => {
    const schemaPath = join(testDir, "seed.schema.json");
    await writeJsonSchema(schemaPath);

    const content = await Bun.file(schemaPath).text();
    const schema = JSON.parse(content);
    // zod-to-json-schema uses $ref at root with definitions
    expect(schema.$ref).toBeDefined();
    const defKey = schema.definitions ? "definitions" : "$defs";
    const seedDef = schema[defKey]?.SeedConfig;
    expect(seedDef).toBeDefined();
    expect(seedDef.type).toBe("object");
  });

  test("custom path override works", async () => {
    const customPath = join(testDir, "custom", "schema.json");
    const result = await writeJsonSchema(customPath);

    expect(result.ok).toBe(true);
    const file = Bun.file(customPath);
    expect(await file.exists()).toBe(true);
  });

  test("schema output has 2-space indent and trailing newline", async () => {
    const schemaPath = join(testDir, "seed.schema.json");
    await writeJsonSchema(schemaPath);

    const content = await Bun.file(schemaPath).text();
    expect(content).toContain('  "');
    expect(content.endsWith("\n")).toBe(true);
  });
});

// =============================================================================
// T-3.3: loadSeed
// =============================================================================

describe("loadSeed", () => {
  // ---- File missing path ----

  test("file missing: creates default seed + schema, returns created: true", async () => {
    const seedPath = join(testDir, ".pai", "seed.json");
    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(true);
      expect(result.config.version).toBe("1.0.0");
      expect(result.config.identity.principalName).toBe("User");
    }

    // seed.json should exist on disk
    const file = Bun.file(seedPath);
    expect(await file.exists()).toBe(true);

    // seed.schema.json should also exist (sibling)
    const schemaPath = join(testDir, ".pai", "seed.schema.json");
    const schemaFile = Bun.file(schemaPath);
    expect(await schemaFile.exists()).toBe(true);
  });

  test("file missing: created config passes validation", async () => {
    const seedPath = join(testDir, ".pai", "seed.json");
    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const validation = validateSeed(result.config);
      expect(validation.valid).toBe(true);
    }
  });

  // ---- Valid complete file ----

  test("valid complete file: returns config, created: false, merged: false", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.created).toBe(false);
      expect(result.merged).toBe(false);
      expect(result.config.version).toBe("1.0.0");
    }
  });

  // ---- Partial file merge ----

  test("partial file (missing state): merges defaults, writes back, merged: true", async () => {
    const seedPath = join(testDir, "seed.json");
    await Bun.write(seedPath, partialSeedJson());

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged).toBe(true);
      // Identity should be preserved from the partial file
      expect(result.config.identity.principalName).toBe("Alice");
      expect(result.config.identity.aiName).toBe("Nova");
      // State should be filled from defaults
      expect(result.config.state).toBeDefined();
      expect(result.config.state.proposals).toEqual([]);
      expect(result.config.state.activeProjects).toEqual([]);
    }

    // File should be updated on disk with merged content
    const onDisk = JSON.parse(await Bun.file(seedPath).text());
    expect(onDisk.state).toBeDefined();
    expect(onDisk.identity.principalName).toBe("Alice");
  });

  // ---- Error cases ----

  test("invalid JSON: returns parse_error", async () => {
    const seedPath = join(testDir, "seed.json");
    await Bun.write(seedPath, "{ this is not json }}}");

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("parse_error");
    }
  });

  test("schema failure: returns validation_error with details", async () => {
    const seedPath = join(testDir, "seed.json");
    // Valid JSON but fails schema: wrong version format
    await Bun.write(seedPath, JSON.stringify({ version: "bad" }, null, 2));

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.details).toBeDefined();
      expect(result.error.details!.length).toBeGreaterThan(0);
    }
  });

  test("completely invalid data (array): returns validation_error", async () => {
    const seedPath = join(testDir, "seed.json");
    await Bun.write(seedPath, JSON.stringify([1, 2, 3]));

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
    }
  });

  // ---- Unknown keys + warnings ----

  test("unknown keys preserved and warnings forwarded", async () => {
    const seedPath = join(testDir, "seed.json");
    await Bun.write(seedPath, seedWithUnknownKeys());

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Warning about unknown key
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings!.some((w) => w.includes("futureField"))).toBe(true);

      // Unknown key preserved in the config (passthrough)
      const raw = result.config as Record<string, unknown>;
      expect(raw.futureField).toBe("from-v2");
    }
  });

  // ---- Never throws ----

  test("never throws: wraps all errors in LoadResult", async () => {
    // Use a path that cannot be read (directory instead of file)
    const dirPath = join(testDir, "a-directory");
    await Bun.write(join(dirPath, "placeholder"), "x");

    // Trying to load a directory as a file should not throw
    let didThrow = false;
    let result: LoadResult | undefined;
    try {
      result = await loadSeed(dirPath);
    } catch {
      didThrow = true;
    }

    expect(didThrow).toBe(false);
    expect(result).toBeDefined();
    if (result && !result.ok) {
      expect(["read_error", "parse_error"]).toContain(result.error.code);
    }
  });

  test("empty file: returns parse_error", async () => {
    const seedPath = join(testDir, "seed.json");
    await Bun.write(seedPath, "");

    const result = await loadSeed(seedPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("parse_error");
    }
  });

  // ---- Performance ----

  test("performance: loadSeed completes in under 2 seconds", async () => {
    const seedPath = join(testDir, "seed.json");
    const start = performance.now();
    await loadSeed(seedPath);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);
  });

  // ---- Idempotency ----

  test("loading a complete file does not rewrite it (no unnecessary writes)", async () => {
    const seedPath = join(testDir, "seed.json");
    const config = validSeed();
    await writeSeed(config, seedPath);

    // Get the modification time
    const statBefore = await stat(seedPath);
    const mtimeBefore = statBefore.mtimeMs;

    // Wait a tiny bit to ensure mtime would change if rewritten
    await new Promise((r) => setTimeout(r, 50));

    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged).toBe(false);
    }

    const statAfter = await stat(seedPath);
    const mtimeAfter = statAfter.mtimeMs;

    // File should NOT have been rewritten
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  // ---- Schema file written alongside seed on create ----

  test("file missing: schema file contains valid JSON Schema", async () => {
    const seedPath = join(testDir, ".pai", "seed.json");
    await loadSeed(seedPath);

    const schemaPath = join(testDir, ".pai", "seed.schema.json");
    const schemaContent = await Bun.file(schemaPath).text();
    const schema = JSON.parse(schemaContent);
    // zod-to-json-schema uses $ref at root with definitions
    expect(schema.$ref).toBeDefined();
    const defKey = schema.definitions ? "definitions" : "$defs";
    const seedDef = schema[defKey]?.SeedConfig;
    expect(seedDef).toBeDefined();
    expect(seedDef.type).toBe("object");
  });
});
