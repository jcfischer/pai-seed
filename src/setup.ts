import { z } from "zod";
import type { SeedConfig } from "./schema";
import { validateSeed } from "./validate";
import { createDefaultSeed } from "./defaults";
import { loadSeed } from "./loader";
import { writeSeedWithCommit } from "./git";

// =============================================================================
// F-004: Types & Schema
// =============================================================================

/**
 * Schema for setup wizard answers.
 * Only principalName is required; everything else has sensible defaults.
 */
export const setupAnswersSchema = z.object({
  principalName: z.string().min(1),
  aiName: z.string().min(1).optional(),
  catchphrase: z.string().min(1).optional(),
  voiceId: z.string().optional(),
  responseStyle: z.enum(["concise", "detailed", "adaptive"]).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

export type SetupAnswers = z.infer<typeof setupAnswersSchema>;

export type SetupResult =
  | { ok: true; config: SeedConfig; created: boolean }
  | { ok: false; error: string };

// =============================================================================
// F-004 1: detectTimezone
// =============================================================================

/**
 * Detect the system timezone using Intl API.
 * Falls back to "UTC" if detection fails.
 */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "UTC";
  } catch {
    return "UTC";
  }
}

// =============================================================================
// F-004 2: buildSeedFromAnswers
// =============================================================================

/**
 * Pure function: build a valid SeedConfig from setup wizard answers.
 *
 * - Parses answers through setupAnswersSchema (throws on invalid)
 * - Starts from createDefaultSeed() base
 * - Overrides identity fields from answers
 * - Derives catchphrase when not provided: "${aiName} here, ready to go."
 * - Validates final config, throws if invalid
 */
export function buildSeedFromAnswers(answers: SetupAnswers): SeedConfig {
  // Validate answers
  const parsed = setupAnswersSchema.parse(answers);

  // Start from defaults
  const seed = createDefaultSeed();

  // Override identity fields
  seed.identity.principalName = parsed.principalName;

  const aiName = parsed.aiName ?? seed.identity.aiName;
  seed.identity.aiName = aiName;

  seed.identity.catchphrase =
    parsed.catchphrase ?? `${aiName} here, ready to go.`;

  if (parsed.voiceId !== undefined) {
    seed.identity.voiceId = parsed.voiceId;
  }

  // Override preferences
  seed.identity.preferences.responseStyle =
    parsed.responseStyle ?? "adaptive";
  seed.identity.preferences.timezone =
    parsed.timezone ?? detectTimezone();
  seed.identity.preferences.locale =
    parsed.locale ?? "en-US";

  // Validate final config
  const validation = validateSeed(seed);
  if (!validation.valid) {
    throw new Error(
      `Built seed failed validation: ${JSON.stringify(validation.errors)}`,
    );
  }

  return seed;
}

// =============================================================================
// F-004 3: isFirstRun
// =============================================================================

/**
 * Check if this is a first-run scenario.
 *
 * Returns true if:
 * - No seed file exists
 * - Seed exists but principalName is still the default "User"
 * - Seed file is corrupted or unreadable
 *
 * Never throws.
 */
export async function isFirstRun(seedPath?: string): Promise<boolean> {
  try {
    const result = await loadSeed(seedPath);

    if (!result.ok) {
      return true;
    }

    if (result.config.identity.principalName === "User") {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

// =============================================================================
// F-004 4: runSetup
// =============================================================================

/**
 * Run the first-run setup wizard.
 *
 * - If not first run: load existing config and return { created: false }
 * - If first run: build config from answers, write with git commit, return { created: true }
 *
 * Never throws; all errors wrapped in SetupResult.
 */
export async function runSetup(
  answers: SetupAnswers,
  seedPath?: string,
): Promise<SetupResult> {
  try {
    const firstRun = await isFirstRun(seedPath);

    if (!firstRun) {
      // Already configured: load and return existing
      const loadResult = await loadSeed(seedPath);
      if (loadResult.ok) {
        return { ok: true, config: loadResult.config, created: false };
      }
      return { ok: false, error: loadResult.error.message };
    }

    // First run: build config from answers
    const config = buildSeedFromAnswers(answers);

    // Write with git commit
    const writeResult = await writeSeedWithCommit(
      config,
      "Init: first-run setup completed",
      seedPath,
    );

    if (!writeResult.ok) {
      return { ok: false, error: writeResult.error.message };
    }

    return { ok: true, config, created: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
