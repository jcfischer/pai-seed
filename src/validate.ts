import {
  seedConfigSchema,
  KNOWN_SEED_KEYS,
  CURRENT_MAJOR_VERSION,
  type SeedConfig,
} from "./schema";

// =============================================================================
// Types
// =============================================================================

export type ValidationError = {
  path: string;
  message: string;
  code: string;
};

export type ValidationResult =
  | { valid: true; config: SeedConfig; warnings?: string[] }
  | { valid: false; errors: ValidationError[] };

// =============================================================================
// Helpers
// =============================================================================

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Convert a Zod path array to JSONPath notation.
 * ["identity", "preferences", "timezone"] -> "$.identity.preferences.timezone"
 */
function toJsonPath(path: (string | number)[]): string {
  if (path.length === 0) return "$";
  return "$." + path.join(".");
}

/**
 * Detect unknown top-level keys not in the schema definition.
 */
function detectUnknownKeys(data: Record<string, unknown>): string[] {
  const knownKeys = new Set<string>(KNOWN_SEED_KEYS);
  return Object.keys(data).filter((key) => !knownKeys.has(key));
}

// =============================================================================
// Main Validation Function (T-3.1)
// =============================================================================

/**
 * Validate unknown data against the SeedConfig schema.
 *
 * Returns a discriminated union:
 * - { valid: true, config, warnings? } on success
 * - { valid: false, errors } on failure
 *
 * Validation steps:
 * 1. Check data is non-null object
 * 2. Version pre-check (missing, format, major mismatch)
 * 3. Zod safeParse for structural validation
 * 4. Map Zod issues to ValidationError[] with JSONPath
 * 5. Detect unknown top-level keys as warnings
 */
export function validateSeed(data: unknown): ValidationResult {
  // Step 1: Null/type guard
  if (data === null || data === undefined) {
    return {
      valid: false,
      errors: [
        {
          path: "$",
          message: "Seed data must be a non-null object",
          code: "invalid_type",
        },
      ],
    };
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: [
        {
          path: "$",
          message: `Expected object, received ${Array.isArray(data) ? "array" : typeof data}`,
          code: "invalid_type",
        },
      ],
    };
  }

  const record = data as Record<string, unknown>;

  // Step 2: Version pre-check
  if (!("version" in record) || record.version === undefined) {
    return {
      valid: false,
      errors: [
        {
          path: "$.version",
          message: "Missing required field: version",
          code: "missing_field",
        },
      ],
    };
  }

  if (typeof record.version !== "string") {
    return {
      valid: false,
      errors: [
        {
          path: "$.version",
          message: `Version must be a string, received ${typeof record.version}`,
          code: "invalid_type",
        },
      ],
    };
  }

  if (!SEMVER_REGEX.test(record.version)) {
    return {
      valid: false,
      errors: [
        {
          path: "$.version",
          message: `Invalid version format: "${record.version}". Expected semver (e.g., 1.0.0)`,
          code: "invalid_format",
        },
      ],
    };
  }

  const majorVersion = parseInt(record.version.split(".")[0], 10);
  if (majorVersion !== CURRENT_MAJOR_VERSION) {
    return {
      valid: false,
      errors: [
        {
          path: "$.version",
          message: `Schema version ${record.version} requires migration. Expected ${CURRENT_MAJOR_VERSION}.x.x`,
          code: "version_mismatch",
        },
      ],
    };
  }

  // Step 3: Zod structural validation
  const result = seedConfigSchema.safeParse(data);

  if (!result.success) {
    // Step 4: Map Zod issues to ValidationError[]
    const errors: ValidationError[] = result.error.issues.map((issue) => ({
      path: toJsonPath(issue.path),
      message: issue.message,
      code: issue.code,
    }));

    return { valid: false, errors };
  }

  // Step 5: Detect unknown top-level keys as warnings
  const unknownKeys = detectUnknownKeys(record);
  const warnings =
    unknownKeys.length > 0
      ? unknownKeys.map(
          (key) => `Unknown top-level key: "${key}" (may be from a newer schema version)`
        )
      : undefined;

  return { valid: true, config: result.data as SeedConfig, warnings };
}
