// =============================================================================
// F-002: Deep Merge (T-2.1, T-2.2)
// =============================================================================

/**
 * Type guard: checks if a value is a plain object (not null, not array).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `defaults` into `existing`.
 *
 * Rules:
 * 1. Keys in existing always win for primitives, arrays, and null.
 * 2. Keys only in defaults are added to the result.
 * 3. When both sides have a plain object for the same key, recurse.
 * 4. Arrays are NOT merged — existing array wins (even if empty).
 * 5. Unknown keys in existing are preserved.
 * 6. Neither input is mutated — returns a fresh object.
 */
export function deepMerge(
  existing: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };

  for (const key of Object.keys(defaults)) {
    if (!(key in existing)) {
      // Key only in defaults: add it
      result[key] = defaults[key];
    } else if (isPlainObject(existing[key]) && isPlainObject(defaults[key])) {
      // Both sides are plain objects: recurse
      result[key] = deepMerge(
        existing[key] as Record<string, unknown>,
        defaults[key] as Record<string, unknown>,
      );
    }
    // Otherwise: existing value already in result via spread (rules 1, 4, 5)
  }

  return result;
}
