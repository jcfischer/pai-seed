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

// =============================================================================
// F-002: Loader
// =============================================================================

// Types
export type { LoadResult, LoadError, WriteResult, WriteError } from "./loader";

// Functions
export { loadSeed, writeSeed, writeJsonSchema, resolveSeedPath } from "./loader";
export { deepMerge } from "./merge";

// =============================================================================
// F-003: Git-backed persistence
// =============================================================================

// Types
export type { GitResult, GitInitResult, RepairResult, CommitCategory } from "./git";

// Functions
export {
  initGitRepo,
  commitSeedChange,
  writeSeedWithCommit,
  repairFromGit,
  loadSeedWithGit,
  isGitRepo,
  getLastCommitMessage,
  hasUncommittedChanges,
} from "./git";

// =============================================================================
// F-004: Setup wizard
// =============================================================================

// Types
export type { SetupAnswers, SetupResult } from "./setup";

// Functions
export {
  setupAnswersSchema,
  detectTimezone,
  buildSeedFromAnswers,
  isFirstRun,
  runSetup,
} from "./setup";
