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
// F-017: ACR semantic extraction
// =============================================================================

// Types
export type { AcrExtractionResult, AcrExtractionOptions } from "./extraction";

// Functions
export { callAcrExtraction } from "./extraction";

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
// F-009: Event log compaction
// =============================================================================

// Types
export type {
  PeriodSummary,
  CompactionResult,
  CompactionOptions,
  TimeDistribution,
  SessionStats,
  Anomaly,
} from "./compaction";

// Schemas
export {
  periodSummarySchema,
  timeDistributionSchema,
  sessionStatsSchema,
  anomalySchema,
} from "./compaction";

// Functions
export {
  compactEvents,
  generatePeriodSummary,
  formatCompactionMessage,
  initEventIndex,
  rebuildIndex,
  findEligiblePeriods,
  resolveArchiveDir,
} from "./compaction";

// =============================================================================
// F-010: Checkpoint system
// =============================================================================

// Types
export type {
  CheckpointState,
  CheckpointResult,
  CheckpointOptions,
  IscCriterionSnapshot,
} from "./checkpoint";

// Schemas
export { checkpointStateSchema, iscCriterionSnapshotSchema } from "./checkpoint";

// Functions
export {
  createCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  detectIncompleteCheckpoint,
  completeCheckpoint,
  cleanupCheckpoints,
  resolveCheckpointsDir,
} from "./checkpoint";

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

// =============================================================================
// F-014: Schema migration system
// =============================================================================

// Types
export type {
  MigrationResult,
  MigrationFn,
  MigrationOptions,
  NeedsMigrationResult,
} from "./migration";

// Functions
export {
  registerMigration,
  getMigrationPath,
  migrateSeed,
  needsMigration,
  clearMigrations,
} from "./migration";

// =============================================================================
// F-012: ACR integration
// =============================================================================

// Types
export type { AcrDocument, AcrExportOptions, AcrExportResult } from "./acr";

// Schemas
export { acrDocumentSchema } from "./acr";

// Functions
export { exportLearnings, exportEventSummaries, exportAllForACR } from "./acr";

// =============================================================================
// F-013: Relationship file system
// =============================================================================

// Types
export type {
  Relationship,
  KeyMoment,
  RelationshipResult,
  ListResult,
  RelationshipWriteResult,
  RelationshipOptions,
} from "./relationships";

// Schemas
export { relationshipSchema, keyMomentSchema } from "./relationships";

// Functions
export {
  resolveRelationshipsDir,
  slugifyName,
  loadRelationship,
  saveRelationship,
  addRelationship,
  removeRelationship,
  updateRelationship,
  listRelationships,
  addKeyMoment,
} from "./relationships";

// =============================================================================
// F-016: Redaction support
// =============================================================================

// Types
export type { RedactionData, RedactResult, RedactionOptions } from "./redaction";

// Schemas
export { redactionDataSchema } from "./redaction";

// Functions
export { getRedactedIds, isRedacted, redactEvent } from "./redaction";

// =============================================================================
// F-015: Learning decay and freshness
// =============================================================================

// Types
export type { StaleLearning, FreshnessStats, ReconfirmResult } from "./freshness";

// Functions
export {
  isStale,
  getStaleLearnings,
  getFreshnessStats,
  freshnessScore,
  reconfirmLearning,
  generateReviewPrompt,
} from "./freshness";
