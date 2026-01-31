import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import type { SeedConfig } from "./schema";
import { validateSeed, type ValidationError } from "./validate";
import { createDefaultSeed } from "./defaults";
import { generateJsonSchema } from "./json-schema";
import { deepMerge } from "./merge";

// =============================================================================
// F-002: Types
// =============================================================================

export type LoadError = {
  code: "parse_error" | "validation_error" | "read_error" | "permission_error";
  message: string;
  details?: ValidationError[];
};

export type LoadResult =
  | { ok: true; config: SeedConfig; created: boolean; merged: boolean; warnings?: string[] }
  | { ok: false; error: LoadError };

export type WriteError = {
  code: "validation_error" | "write_error" | "permission_error";
  message: string;
  details?: ValidationError[];
};

export type WriteResult =
  | { ok: true }
  | { ok: false; error: WriteError };

// =============================================================================
// F-002 T-1.1: Path Resolution
// =============================================================================

/**
 * Resolve the seed.json file path.
 * - No argument: defaults to ~/.pai/seed.json
 * - With argument: resolves to absolute path
 */
export function resolveSeedPath(seedPath?: string): string {
  if (seedPath) return resolve(seedPath);
  return join(homedir(), ".pai", "seed.json");
}

// =============================================================================
// F-002 T-3.1: writeSeed (atomic write)
// =============================================================================

/**
 * Write a SeedConfig to disk with atomic write (write .tmp, then rename).
 *
 * - Validates the config before writing. If invalid, returns validation_error
 *   and does NOT create any file.
 * - Creates parent directories if they don't exist.
 * - JSON is formatted with 2-space indent + trailing newline.
 */
export async function writeSeed(
  config: SeedConfig,
  seedPath?: string,
): Promise<WriteResult> {
  const path = resolveSeedPath(seedPath);

  // Validate before writing
  const validation = validateSeed(config);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: "Config failed schema validation",
        details: validation.errors,
      },
    };
  }

  try {
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });

    const content = JSON.stringify(config, null, 2) + "\n";
    const tmpPath = path + ".tmp";

    await Bun.write(tmpPath, content);
    await rename(tmpPath, path);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("EACCES") ? "permission_error" : "write_error";
    return {
      ok: false,
      error: { code, message: `Failed to write seed: ${message}` },
    };
  }
}

// =============================================================================
// F-002 T-3.2: writeJsonSchema
// =============================================================================

/**
 * Write the JSON Schema for SeedConfig to disk.
 *
 * - Uses generateJsonSchema() from F-001.
 * - Creates parent directories if needed.
 * - Atomic write: .tmp then rename.
 * - 2-space indent + trailing newline.
 */
export async function writeJsonSchema(schemaPath?: string): Promise<WriteResult> {
  const path = schemaPath
    ? resolve(schemaPath)
    : join(homedir(), ".pai", "seed.schema.json");

  try {
    const schema = generateJsonSchema();
    const content = JSON.stringify(schema, null, 2) + "\n";
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });

    const tmpPath = path + ".tmp";
    await Bun.write(tmpPath, content);
    await rename(tmpPath, path);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("EACCES") ? "permission_error" : "write_error";
    return {
      ok: false,
      error: { code, message: `Failed to write JSON schema: ${message}` },
    };
  }
}

// =============================================================================
// F-002 T-3.3: loadSeed (orchestration)
// =============================================================================

/**
 * Load a SeedConfig from disk.
 *
 * Flow:
 * 1. If file doesn't exist -> create default seed + schema, return { created: true }
 * 2. If file exists -> parse, validate, merge with defaults, write back if changed
 * 3. NEVER throws — all errors wrapped in LoadResult
 *
 * @param seedPath - Optional path override (defaults to ~/.pai/seed.json)
 */
export async function loadSeed(seedPath?: string): Promise<LoadResult> {
  const path = resolveSeedPath(seedPath);

  try {
    // Check if file exists
    const file = Bun.file(path);
    const exists = await file.exists();

    if (!exists) {
      // File missing: create default seed + schema
      return await createAndReturnDefault(path);
    }

    // File exists: read and parse
    let rawText: string;
    try {
      rawText = await file.text();
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "read_error",
          message: `Failed to read seed file: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    // Parse JSON
    let parsed: unknown;
    try {
      if (!rawText || rawText.trim() === "") {
        return {
          ok: false,
          error: {
            code: "parse_error",
            message: "Seed file is empty",
          },
        };
      }
      parsed = JSON.parse(rawText);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "parse_error",
          message: `Invalid JSON in seed file: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }

    // Non-object data cannot be merged — validate directly and report error
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      const validation = validateSeed(parsed);
      if (!validation.valid) {
        return {
          ok: false,
          error: {
            code: "validation_error",
            message: "Seed file failed schema validation",
            details: validation.errors,
          },
        };
      }
    }

    // Merge with defaults BEFORE validation (handles partial files)
    const defaults = createDefaultSeed() as unknown as Record<string, unknown>;
    const existingRecord = parsed as Record<string, unknown>;
    const merged = deepMerge(existingRecord, defaults);

    // Validate the merged result
    const validation = validateSeed(merged);
    if (!validation.valid) {
      return {
        ok: false,
        error: {
          code: "validation_error",
          message: "Seed file failed schema validation after merge with defaults",
          details: validation.errors,
        },
      };
    }

    const mergedConfig = validation.config;

    // Detect if merge changed anything by comparing serialized forms
    const originalJson = JSON.stringify(parsed, null, 2);
    const mergedJson = JSON.stringify(mergedConfig, null, 2);
    const wasChanged = originalJson !== mergedJson;

    if (wasChanged) {
      // Write back the merged config
      await writeSeed(mergedConfig, path);
    }

    return {
      ok: true,
      config: mergedConfig,
      created: false,
      merged: wasChanged,
      warnings: validation.warnings,
    };
  } catch (err) {
    // Catch-all: never throw
    return {
      ok: false,
      error: {
        code: "read_error",
        message: `Unexpected error loading seed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/**
 * Create a default seed, write it + its schema, and return the result.
 */
async function createAndReturnDefault(path: string): Promise<LoadResult> {
  const config = createDefaultSeed();

  const writeResult = await writeSeed(config, path);
  if (!writeResult.ok) {
    return {
      ok: false,
      error: {
        code: writeResult.error.code === "permission_error" ? "permission_error" : "read_error",
        message: writeResult.error.message,
      },
    };
  }

  // Write schema alongside seed
  const schemaPath = join(dirname(path), "seed.schema.json");
  await writeJsonSchema(schemaPath);

  return {
    ok: true,
    config,
    created: true,
    merged: false,
  };
}
