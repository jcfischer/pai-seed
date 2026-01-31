import type { SeedConfig } from "./schema";
import { validateSeed } from "./validate";

// =============================================================================
// Default Seed Generator (T-3.2)
// =============================================================================

/**
 * Create a valid SeedConfig with sensible default values.
 *
 * Returns a fresh instance each call (no shared references).
 * Self-validates against the schema — throws if the default is somehow invalid
 * (which would indicate a programming error in this module).
 */
export function createDefaultSeed(): SeedConfig {
  const seed: SeedConfig = {
    version: "1.0.0",
    identity: {
      principalName: "User",
      aiName: "PAI",
      catchphrase: "PAI here, ready to go.",
      voiceId: "default",
      preferences: {
        responseStyle: "adaptive",
        timezone: "UTC",
        locale: "en-US",
      },
    },
    learned: {
      patterns: [],
      insights: [],
      selfKnowledge: [],
    },
    state: {
      proposals: [],
      activeProjects: [],
    },
  };

  // Self-validation: ensure the default seed passes its own schema
  const result = validateSeed(seed);
  if (!result.valid) {
    throw new Error(
      `Default seed failed validation (programming error): ${JSON.stringify(result.errors)}`
    );
  }

  return seed;
}
