import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CURRENT_MAJOR_VERSION } from "./schema";
import { validateSeed } from "./validate";
import { writeSeed, resolveSeedPath } from "./loader";
import { isGitRepo, commitSeedChange } from "./git";
import { logEvent } from "./events";
import type { SeedConfig } from "./schema";

// =============================================================================
// T-14.1: Types
// =============================================================================

export type MigrationFn = (
  config: Record<string, unknown>,
) => Record<string, unknown>;

export type MigrationResult =
  | { ok: true; config: SeedConfig; migratedFrom: string; migratedTo: string }
  | { ok: false; error: string; failedStep?: string };

export type MigrationOptions = {
  seedPath?: string;
  paiDir?: string;
  eventsDir?: string;
};

export type NeedsMigrationResult = {
  needed: boolean;
  fromMajor?: number;
  toMajor?: number;
  fromVersion?: string;
};

// =============================================================================
// T-14.2: Migration Registry
// =============================================================================

const registry = new Map<string, MigrationFn>();

function registryKey(from: number, to: number): string {
  return `${from}→${to}`;
}

export function registerMigration(
  fromMajor: number,
  toMajor: number,
  fn: MigrationFn,
): void {
  if (toMajor !== fromMajor + 1) {
    throw new Error(
      `Migration must be sequential: expected toMajor=${fromMajor + 1}, got ${toMajor}`,
    );
  }

  const key = registryKey(fromMajor, toMajor);
  if (registry.has(key)) {
    throw new Error(`Migration already registered for ${key}`);
  }

  registry.set(key, fn);
}

export function getMigrationPath(
  fromMajor: number,
  toMajor: number,
): MigrationFn[] {
  if (fromMajor === toMajor) return [];
  if (fromMajor > toMajor) {
    throw new Error(
      `Downgrade migrations not supported: ${fromMajor} → ${toMajor}`,
    );
  }

  const path: MigrationFn[] = [];
  for (let v = fromMajor; v < toMajor; v++) {
    const key = registryKey(v, v + 1);
    const fn = registry.get(key);
    if (!fn) {
      throw new Error(
        `No migration registered for ${key}. Cannot migrate from v${fromMajor} to v${toMajor}`,
      );
    }
    path.push(fn);
  }

  return path;
}

export function clearMigrations(): void {
  registry.clear();
}

// =============================================================================
// T-14.3: needsMigration
// =============================================================================

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

function extractMajorVersion(
  config: Record<string, unknown>,
): { major: number; valid: boolean } {
  const version = config.version;
  // Missing version = v0 (migratable)
  if (version === undefined || version === null) return { major: 0, valid: true };
  // Non-string version = invalid (not migratable)
  if (typeof version !== "string") return { major: -1, valid: false };
  // Invalid semver format = not migratable (let validation handle it)
  if (!SEMVER_REGEX.test(version)) return { major: -1, valid: false };
  return { major: parseInt(version.split(".")[0], 10), valid: true };
}

export function needsMigration(
  rawConfig: Record<string, unknown>,
): NeedsMigrationResult {
  const extracted = extractMajorVersion(rawConfig);

  // Invalid version format — let validation handle it, not migration
  if (!extracted.valid) {
    return { needed: false };
  }

  const fromMajor = extracted.major;
  const toMajor = CURRENT_MAJOR_VERSION;

  if (fromMajor === toMajor) {
    return { needed: false };
  }

  return {
    needed: true,
    fromMajor,
    toMajor,
    fromVersion:
      typeof rawConfig.version === "string" ? rawConfig.version : undefined,
  };
}

// =============================================================================
// T-14.4: Built-in v0→v1 Migration
// =============================================================================

function migrateV0toV1(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const migrated: Record<string, unknown> = { ...config };

  // Set version
  migrated.version = "1.0.0";

  // Ensure identity section exists
  if (
    !migrated.identity ||
    typeof migrated.identity !== "object" ||
    Array.isArray(migrated.identity)
  ) {
    migrated.identity = {
      principalName: "User",
      aiName: "PAI",
      catchphrase: "PAI here, ready to go.",
      voiceId: "default",
      preferences: {
        responseStyle: "adaptive",
        timezone: "UTC",
        locale: "en-US",
      },
    };
  } else {
    // Fill in missing required fields with defaults
    const defaults: Record<string, unknown> = {
      principalName: "User",
      aiName: "PAI",
      catchphrase: "PAI here, ready to go.",
      voiceId: "default",
      preferences: {
        responseStyle: "adaptive",
        timezone: "UTC",
        locale: "en-US",
      },
    };
    const identity = { ...defaults, ...(migrated.identity as Record<string, unknown>) };
    if (
      !identity.preferences ||
      typeof identity.preferences !== "object" ||
      Array.isArray(identity.preferences)
    ) {
      identity.preferences = {
        responseStyle: "adaptive",
        timezone: "UTC",
        locale: "en-US",
      };
    }
    migrated.identity = identity;
  }

  // Ensure learned section exists
  if (
    !migrated.learned ||
    typeof migrated.learned !== "object" ||
    Array.isArray(migrated.learned)
  ) {
    migrated.learned = {
      patterns: [],
      insights: [],
      selfKnowledge: [],
    };
  }

  // Ensure state section exists
  if (
    !migrated.state ||
    typeof migrated.state !== "object" ||
    Array.isArray(migrated.state)
  ) {
    migrated.state = {
      proposals: [],
      activeProjects: [],
    };
  }

  return migrated;
}

// Register built-in migrations
registerMigration(0, 1, migrateV0toV1);

// =============================================================================
// T-14.6: Backup Before Migration
// =============================================================================

async function backupSeed(
  seedPath: string,
  paiDir: string | undefined,
  fromMajor: number,
  toMajor: number,
): Promise<{ ok: true; method: "git" | "file" } | { ok: false; error: string }> {
  const dir = paiDir ?? dirname(seedPath);

  try {
    // Try git backup first
    if (await isGitRepo(dir)) {
      const result = await commitSeedChange(
        `Migrate: backup before v${fromMajor}→v${toMajor}`,
        dir,
      );
      if (result.ok) {
        return { ok: true, method: "git" };
      }
    }
  } catch {
    // Git backup failed, fall through to file backup
  }

  // File-based backup
  try {
    const backupPath = join(dirname(seedPath), `seed.json.backup-v${fromMajor}`);
    await copyFile(seedPath, backupPath);
    return { ok: true, method: "file" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Backup failed: ${message}` };
  }
}

// =============================================================================
// T-14.5: migrateSeed Orchestrator
// =============================================================================

export async function migrateSeed(
  rawConfig: Record<string, unknown>,
  options?: MigrationOptions,
): Promise<MigrationResult> {
  try {
    const detection = needsMigration(rawConfig);
    if (!detection.needed) {
      // Validate current config and return
      const validation = validateSeed(rawConfig);
      if (!validation.valid) {
        return { ok: false, error: "Config is current version but fails validation" };
      }
      return {
        ok: true,
        config: validation.config,
        migratedFrom: rawConfig.version as string,
        migratedTo: rawConfig.version as string,
      };
    }

    const fromMajor = detection.fromMajor!;
    const toMajor = detection.toMajor!;
    const fromVersion = detection.fromVersion ?? `${fromMajor}.0.0`;

    // Get migration path
    let path: MigrationFn[];
    try {
      path = getMigrationPath(fromMajor, toMajor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    // Backup before migration
    const seedPath = resolveSeedPath(options?.seedPath);
    await backupSeed(seedPath, options?.paiDir, fromMajor, toMajor);

    // Run migration steps
    let current = rawConfig;
    let currentMajor = fromMajor;

    for (const fn of path) {
      const stepLabel = registryKey(currentMajor, currentMajor + 1);
      try {
        current = fn(current);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Migration step ${stepLabel} failed: ${message}`,
          failedStep: stepLabel,
        };
      }

      // Verify version was bumped
      const extracted = extractMajorVersion(current);
      const newMajor = extracted.major;
      if (!extracted.valid || newMajor !== currentMajor + 1) {
        return {
          ok: false,
          error: `Migration step ${stepLabel} did not bump version to ${currentMajor + 1}.x.x (got ${current.version})`,
          failedStep: stepLabel,
        };
      }
      currentMajor = newMajor;
    }

    // Validate final result
    const validation = validateSeed(current);
    if (!validation.valid) {
      const errorMessages = validation.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");
      return {
        ok: false,
        error: `Migrated config fails validation: ${errorMessages}`,
      };
    }

    // Write migrated config
    const writeResult = await writeSeed(validation.config, options?.seedPath);
    if (!writeResult.ok) {
      return {
        ok: false,
        error: `Failed to write migrated config: ${writeResult.error.message}`,
      };
    }

    // Log migration event (non-fatal)
    try {
      await logEvent(
        "custom",
        {
          action: "migration_completed",
          fromVersion,
          toVersion: `${toMajor}.0.0`,
          steps: path.length,
        },
        undefined,
        options?.eventsDir,
      );
    } catch {
      // Non-fatal
    }

    return {
      ok: true,
      config: validation.config,
      migratedFrom: fromVersion,
      migratedTo: `${toMajor}.0.0`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Migration failed: ${message}` };
  }
}
