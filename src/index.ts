// =============================================================================
// pai-seed Public API (T-4.2)
// =============================================================================

// Types
export type {
  SeedConfig,
  IdentityLayer,
  LearnedLayer,
  StateLayer,
  Learning,
  Proposal,
  Preferences,
} from "./schema";
export type { ValidationResult, ValidationError } from "./validate";

// Functions
export { validateSeed } from "./validate";
export { createDefaultSeed } from "./defaults";
export { generateJsonSchema } from "./json-schema";

// Schemas (for downstream features that need direct Zod access)
export {
  seedConfigSchema,
  learningSchema,
  proposalSchema,
  preferencesSchema,
  identityLayerSchema,
  learnedLayerSchema,
  stateLayerSchema,
  KNOWN_SEED_KEYS,
  CURRENT_MAJOR_VERSION,
} from "./schema";
