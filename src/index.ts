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

// =============================================================================
// F-005: Session start hook
// =============================================================================

// Types
export type { SessionContext, SessionContextOptions, ContextMode } from "./session";

// Functions
export {
  formatIdentitySummary,
  formatLearningSummary,
  formatProposals,
  formatSessionState,
  generateSessionContext,
  sessionStartHook,
} from "./session";

// =============================================================================
// F-006: Post-session extraction
// =============================================================================

// Types
export type { LearningSignal, SignalType, WriteProposalsResult, ExtractionResult } from "./extraction";

// Functions
export {
  detectLearningSignals,
  extractProposals,
  writeProposals,
  extractionHook,
} from "./extraction";

// =============================================================================
// F-008: Event log foundation
// =============================================================================

// Types
export type { EventType, SystemEvent, AppendResult, ReadEventsOptions } from "./events";

// Schemas
export { eventTypeSchema, systemEventSchema } from "./events";

// Functions
export { resolveEventsDir, appendEvent, readEvents, countEvents, logEvent } from "./events";

// =============================================================================
// F-007: Proposal confirmation flow
// =============================================================================

// Types
export type { PendingResult, ConfirmResult, RejectResult, BulkResult } from "./confirmation";

// Functions
export {
  proposalToLearning,
  getPendingProposals,
  acceptProposal,
  rejectProposal,
  acceptAllProposals,
  rejectAllProposals,
  cleanRejected,
} from "./confirmation";
