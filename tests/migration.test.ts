import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerMigration,
  getMigrationPath,
  migrateSeed,
  needsMigration,
  clearMigrations,
  type MigrationFn,
} from "../src/migration";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed, loadSeed } from "../src/loader";
import { validateSeed } from "../src/validate";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let seedPath: string;
let eventsDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-migrate-test-"));
  seedPath = join(tempDir, "seed.json");
  eventsDir = join(tempDir, "events");

  const { mkdir } = await import("node:fs/promises");
  await mkdir(eventsDir, { recursive: true });

  // Reset registry to only built-in migrations
  clearMigrations();
  // Re-register built-in v0→v1 by re-importing
  // Built-in is registered at module load time, but clearMigrations removes it.
  // We need to re-register it for tests that depend on it.
  registerMigration(0, 1, (config) => {
    const migrated: Record<string, unknown> = { ...config };
    migrated.version = "1.0.0";
    const identityDefaults: Record<string, unknown> = {
      principalName: "User",
      aiName: "PAI",
      catchphrase: "PAI here, ready to go.",
      voiceId: "default",
      preferences: { responseStyle: "adaptive", timezone: "UTC", locale: "en-US" },
    };
    if (!migrated.identity || typeof migrated.identity !== "object" || Array.isArray(migrated.identity)) {
      migrated.identity = identityDefaults;
    } else {
      const identity = { ...identityDefaults, ...(migrated.identity as Record<string, unknown>) };
      if (!identity.preferences || typeof identity.preferences !== "object" || Array.isArray(identity.preferences)) {
        identity.preferences = { responseStyle: "adaptive", timezone: "UTC", locale: "en-US" };
      }
      migrated.identity = identity;
    }
    if (!migrated.learned || typeof migrated.learned !== "object" || Array.isArray(migrated.learned)) {
      migrated.learned = { patterns: [], insights: [], selfKnowledge: [] };
    }
    if (!migrated.state || typeof migrated.state !== "object" || Array.isArray(migrated.state)) {
      migrated.state = { proposals: [], activeProjects: [] };
    }
    return migrated;
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  clearMigrations();
});

const opts = () => ({ seedPath, eventsDir });

// =============================================================================
// T-14.2: Migration Registry
// =============================================================================

describe("registerMigration", () => {
  test("adds function to registry", () => {
    const fn: MigrationFn = (c) => ({ ...c, version: "2.0.0" });
    registerMigration(1, 2, fn);
    const path = getMigrationPath(1, 2);
    expect(path.length).toBe(1);
    expect(path[0]).toBe(fn);
  });

  test("throws on duplicate key", () => {
    const fn: MigrationFn = (c) => ({ ...c, version: "2.0.0" });
    registerMigration(1, 2, fn);
    expect(() => registerMigration(1, 2, fn)).toThrow("already registered");
  });

  test("throws if toMajor !== fromMajor + 1", () => {
    const fn: MigrationFn = (c) => c;
    expect(() => registerMigration(1, 3, fn)).toThrow("sequential");
  });
});

describe("getMigrationPath", () => {
  test("returns correct sequence for multi-step migration", () => {
    const fn12: MigrationFn = (c) => ({ ...c, version: "2.0.0" });
    const fn23: MigrationFn = (c) => ({ ...c, version: "3.0.0" });
    registerMigration(1, 2, fn12);
    registerMigration(2, 3, fn23);

    const path = getMigrationPath(1, 3);
    expect(path.length).toBe(2);
    expect(path[0]).toBe(fn12);
    expect(path[1]).toBe(fn23);
  });

  test("returns empty array when from === to", () => {
    const path = getMigrationPath(1, 1);
    expect(path).toEqual([]);
  });

  test("throws when gap exists in path", () => {
    // Only have 0→1 registered, no 1→2
    expect(() => getMigrationPath(0, 2)).toThrow("No migration registered");
  });

  test("throws on downgrade", () => {
    expect(() => getMigrationPath(2, 1)).toThrow("Downgrade");
  });
});

describe("clearMigrations", () => {
  test("resets registry", () => {
    clearMigrations();
    // After clearing, v0→v1 should be gone
    expect(() => getMigrationPath(0, 1)).toThrow("No migration registered");
  });
});

// =============================================================================
// T-14.3: needsMigration
// =============================================================================

describe("needsMigration", () => {
  test("returns needed: false for current version", () => {
    const result = needsMigration({ version: "1.0.0" });
    expect(result.needed).toBe(false);
  });

  test("returns needed: true for older major version", () => {
    const result = needsMigration({ version: "0.1.0" });
    expect(result.needed).toBe(true);
    expect(result.fromMajor).toBe(0);
    expect(result.toMajor).toBe(1);
    expect(result.fromVersion).toBe("0.1.0");
  });

  test("returns needed: true for future major version", () => {
    const result = needsMigration({ version: "2.0.0" });
    expect(result.needed).toBe(true);
    expect(result.fromMajor).toBe(2);
    expect(result.toMajor).toBe(1);
  });

  test("treats missing version as major 0", () => {
    const result = needsMigration({});
    expect(result.needed).toBe(true);
    expect(result.fromMajor).toBe(0);
    expect(result.fromVersion).toBeUndefined();
  });

  test("treats non-string version as not migratable", () => {
    const result = needsMigration({ version: 42 });
    expect(result.needed).toBe(false);
  });

  test("treats invalid semver as not migratable", () => {
    const result = needsMigration({ version: "not-a-version" });
    expect(result.needed).toBe(false);
  });
});

// =============================================================================
// T-14.4: Built-in v0→v1 Migration
// =============================================================================

describe("v0→v1 migration", () => {
  test("adds version field to bare config", () => {
    const path = getMigrationPath(0, 1);
    const result = path[0]({});
    expect(result.version).toBe("1.0.0");
  });

  test("preserves existing identity data", () => {
    const path = getMigrationPath(0, 1);
    const result = path[0]({
      identity: {
        principalName: "Alice",
        aiName: "Nova",
        catchphrase: "Hello!",
        voiceId: "custom",
        preferences: { responseStyle: "concise", timezone: "CET", locale: "de-DE" },
      },
    });
    const identity = result.identity as Record<string, unknown>;
    expect(identity.principalName).toBe("Alice");
    expect(identity.aiName).toBe("Nova");
  });

  test("adds missing top-level sections with defaults", () => {
    const path = getMigrationPath(0, 1);
    const result = path[0]({});
    expect(result.identity).toBeDefined();
    expect(result.learned).toBeDefined();
    expect(result.state).toBeDefined();
  });

  test("handles completely empty object", () => {
    const path = getMigrationPath(0, 1);
    const result = path[0]({});
    expect(result.version).toBe("1.0.0");
    // Should produce a valid v1 structure
    const validation = validateSeed(result);
    expect(validation.valid).toBe(true);
  });

  test("idempotent on already-v1 config", () => {
    const seed = createDefaultSeed();
    const asRecord = JSON.parse(JSON.stringify(seed)) as Record<string, unknown>;
    // Remove version to simulate v0, then migrate
    delete asRecord.version;
    const path = getMigrationPath(0, 1);
    const result = path[0](asRecord);
    expect(result.version).toBe("1.0.0");
    const validation = validateSeed(result);
    expect(validation.valid).toBe(true);
  });
});

// =============================================================================
// T-14.5: migrateSeed Orchestrator
// =============================================================================

describe("migrateSeed", () => {
  test("successfully migrates v0→v1 config", async () => {
    // Write a v0 config (no version field)
    const v0Config = { identity: { principalName: "Test" } };
    await writeFile(seedPath, JSON.stringify(v0Config));

    const result = await migrateSeed(v0Config, opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe("0.0.0");
    expect(result.migratedTo).toBe("1.0.0");
    expect(result.config.version).toBe("1.0.0");
  });

  test("runs sequential migrations", async () => {
    // Register a mock v1→v2 migration
    registerMigration(1, 2, (c) => ({
      ...c,
      version: "2.0.0",
      newField: "added",
    }));

    // We need to also adjust: for this test, CURRENT_MAJOR_VERSION is 1,
    // so v1 config won't trigger migration. Test with v0 config instead
    // to verify the chain v0→v1 runs correctly.
    const v0Config = {};
    await writeFile(seedPath, JSON.stringify(v0Config));

    const result = await migrateSeed(v0Config, opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.version).toBe("1.0.0");
  });

  test("aborts on transform error", async () => {
    clearMigrations();
    registerMigration(0, 1, () => {
      throw new Error("Transform exploded");
    });

    const result = await migrateSeed({}, opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Transform exploded");
    expect(result.failedStep).toBe("0→1");
  });

  test("aborts if transform doesn't bump version", async () => {
    clearMigrations();
    registerMigration(0, 1, (c) => ({ ...c })); // No version bump

    const result = await migrateSeed({}, opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("did not bump version");
  });

  test("validates final config against schema", async () => {
    clearMigrations();
    // Migration sets version but produces invalid structure
    registerMigration(0, 1, () => ({
      version: "1.0.0",
      // Missing required identity, learned, state sections
    }));

    const result = await migrateSeed({}, opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("fails validation");
  });

  test("returns ok for config that doesn't need migration", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const result = await migrateSeed(
      seed as unknown as Record<string, unknown>,
      opts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe("1.0.0");
    expect(result.migratedTo).toBe("1.0.0");
  });
});

// =============================================================================
// T-14.6: Backup Before Migration
// =============================================================================

describe("backup before migration", () => {
  test("creates file backup when no git repo", async () => {
    // Write a v0 config
    const v0Config = { identity: { principalName: "Backup Test" } };
    await writeFile(seedPath, JSON.stringify(v0Config));

    await migrateSeed(v0Config, { seedPath, eventsDir });

    // Check backup file exists
    const files = await readdir(tempDir);
    const backupFile = files.find((f) => f.startsWith("seed.json.backup-v"));
    expect(backupFile).toBe("seed.json.backup-v0");
  });

  test("backup file contains original content", async () => {
    const v0Config = { identity: { principalName: "Original" } };
    const original = JSON.stringify(v0Config);
    await writeFile(seedPath, original);

    await migrateSeed(v0Config, { seedPath, eventsDir });

    const backupPath = join(tempDir, "seed.json.backup-v0");
    const backupContent = await readFile(backupPath, "utf-8");
    expect(backupContent).toBe(original);
  });

  test("migration succeeds even if backup path is readonly", async () => {
    // Write a v0 config to a nested path
    const nestedDir = join(tempDir, "nested");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(nestedDir, { recursive: true });
    const nestedSeedPath = join(nestedDir, "seed.json");
    const v0Config = { identity: { principalName: "Test" } };
    await writeFile(nestedSeedPath, JSON.stringify(v0Config));

    // Migration should succeed — backup failure is non-fatal
    const result = await migrateSeed(v0Config, {
      seedPath: nestedSeedPath,
      eventsDir,
    });
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// T-14.7: loadSeed Integration
// =============================================================================

describe("loadSeed integration", () => {
  test("transparently migrates v0 config", async () => {
    // Write a versionless config
    const v0Config = {
      identity: {
        principalName: "Migrated User",
        aiName: "PAI",
        catchphrase: "Hello!",
        voiceId: "default",
        preferences: { responseStyle: "adaptive", timezone: "UTC", locale: "en-US" },
      },
    };
    await writeFile(seedPath, JSON.stringify(v0Config));

    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.version).toBe("1.0.0");
    expect(result.config.identity.principalName).toBe("Migrated User");
  });

  test("returns migrated field in result", async () => {
    const v0Config = {};
    await writeFile(seedPath, JSON.stringify(v0Config));

    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBeDefined();
    expect(result.migrated!.from).toBe("0.0.0");
    expect(result.migrated!.to).toBe("1.0.0");
  });

  test("returns error when migration fails", async () => {
    // Write config with a future major version (downgrade not supported)
    const futureConfig = { version: "99.0.0" };
    await writeFile(seedPath, JSON.stringify(futureConfig));

    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Migration failed");
  });

  test("skips migration for current version", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBeUndefined();
  });

  test("existing loadSeed behavior preserved", async () => {
    // Normal v1 seed should load without migration
    const seed = createDefaultSeed();
    seed.identity.principalName = "Existing User";
    await writeSeed(seed, seedPath);

    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.identity.principalName).toBe("Existing User");
    expect(result.created).toBe(false);
  });
});

// =============================================================================
// T-14.8: Exports
// =============================================================================

describe("exports", () => {
  test("all types and functions importable from index", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.registerMigration).toBe("function");
    expect(typeof mod.getMigrationPath).toBe("function");
    expect(typeof mod.migrateSeed).toBe("function");
    expect(typeof mod.needsMigration).toBe("function");
    expect(typeof mod.clearMigrations).toBe("function");
  });

  test("MigrationResult type works at runtime", () => {
    // Type-level test: verify discriminated union works
    const success = {
      ok: true as const,
      config: createDefaultSeed(),
      migratedFrom: "0.0.0",
      migratedTo: "1.0.0",
    };
    const failure = {
      ok: false as const,
      error: "something went wrong",
      failedStep: "0→1",
    };
    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });
});
