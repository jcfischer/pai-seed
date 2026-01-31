import { z } from "zod";

// =============================================================================
// Shared Types (T-2.1)
// =============================================================================

/**
 * Learning — a single learned item (pattern, insight, or self-knowledge).
 * Used in the Learned layer arrays.
 */
export const learningSchema = z.object({
  id: z.string(),
  content: z.string().min(1),
  source: z.string().min(1),
  extractedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().optional(),
  confirmed: z.boolean(),
  tags: z.array(z.string()),
});

/**
 * Proposal — a pending learning candidate extracted from a session.
 * Stored in the State layer until accepted or rejected.
 */
export const proposalSchema = z.object({
  id: z.string(),
  type: z.enum(["pattern", "insight", "self_knowledge"]),
  content: z.string().min(1),
  source: z.string().min(1),
  extractedAt: z.string().datetime(),
  status: z.enum(["pending", "accepted", "rejected"]),
});

// =============================================================================
// Identity Layer (T-2.2)
// =============================================================================

/**
 * Preferences — user/AI preferences for response behavior.
 */
export const preferencesSchema = z.object({
  responseStyle: z.enum(["concise", "detailed", "adaptive"]),
  timezone: z.string(),
  locale: z.string(),
});

/**
 * Identity Layer — who the AI is and how it presents itself.
 */
export const identityLayerSchema = z.object({
  principalName: z.string().min(1),
  aiName: z.string().min(1),
  catchphrase: z.string().min(1),
  voiceId: z.string(),
  preferences: preferencesSchema,
});

// =============================================================================
// Learned Layer (T-2.3)
// =============================================================================

/**
 * Learned Layer — accumulated knowledge organized by category.
 */
export const learnedLayerSchema = z.object({
  patterns: z.array(learningSchema),
  insights: z.array(learningSchema),
  selfKnowledge: z.array(learningSchema),
});

// =============================================================================
// State Layer (T-2.4)
// =============================================================================

/**
 * State Layer — session-to-session operational state.
 */
export const stateLayerSchema = z.object({
  lastSessionId: z.string().optional(),
  lastSessionAt: z.string().datetime().optional(),
  proposals: z.array(proposalSchema),
  activeProjects: z.array(z.string()),
  checkpointRef: z.string().optional(),
});

// =============================================================================
// Root SeedConfig (T-2.5)
// =============================================================================

/**
 * Semver regex for version field validation.
 * Matches: 1.0.0, 0.1.0, 10.20.30, etc.
 */
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * SeedConfig — the root schema for seed.json.
 * Uses .passthrough() for forward compatibility (unknown keys become warnings, not errors).
 */
export const seedConfigSchema = z
  .object({
    version: z.string().regex(SEMVER_REGEX, "Version must be a valid semver string (e.g., 1.0.0)"),
    identity: identityLayerSchema,
    learned: learnedLayerSchema,
    state: stateLayerSchema,
  })
  .passthrough();

// =============================================================================
// Exported TypeScript Types
// =============================================================================

export type Learning = z.infer<typeof learningSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type IdentityLayer = z.infer<typeof identityLayerSchema>;
export type LearnedLayer = z.infer<typeof learnedLayerSchema>;
export type StateLayer = z.infer<typeof stateLayerSchema>;
export type SeedConfig = z.infer<typeof seedConfigSchema>;

/**
 * Known top-level keys in the seed config schema.
 * Used by validateSeed() to detect unknown keys for warnings.
 */
export const KNOWN_SEED_KEYS = ["version", "identity", "learned", "state"] as const;

/**
 * Current expected major version for validation.
 */
export const CURRENT_MAJOR_VERSION = 1;
