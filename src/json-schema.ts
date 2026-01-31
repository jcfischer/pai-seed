import { zodToJsonSchema } from "zod-to-json-schema";
import { seedConfigSchema } from "./schema";

// =============================================================================
// JSON Schema Generation (T-4.1)
// =============================================================================

/**
 * Generate a JSON Schema (draft-07) from the Zod seedConfigSchema.
 *
 * Uses zod-to-json-schema to convert the Zod schema into a standard JSON Schema
 * object with $defs for shared types (Learning, Proposal).
 *
 * The returned object can be:
 * - Written to ~/.pai/seed.schema.json by F-002
 * - Used by external validation tools
 * - Shared with editors for autocompletion
 *
 * This function is pure — no I/O, no side effects.
 */
export function generateJsonSchema(): object {
  return zodToJsonSchema(seedConfigSchema, {
    name: "SeedConfig",
    $refStrategy: "root",
  });
}
