import type {
  SeedConfig,
  IdentityLayer,
  LearnedLayer,
  StateLayer,
  Proposal,
} from "./schema";
import { isFirstRun } from "./setup";
import { loadSeedWithGit } from "./git";

// =============================================================================
// F-005: Types
// =============================================================================

export type ContextMode = "full" | "complement";

export type SessionContextOptions = {
  mode?: ContextMode;
};

export type SessionContext =
  | {
      ok: true;
      context: string;
      needsSetup: boolean;
      config: SeedConfig | null;
      proposalCount: number;
    }
  | { ok: false; error: string };

// =============================================================================
// F-005 1: formatIdentitySummary
// =============================================================================

/**
 * Format the identity layer into a human-readable summary string.
 * Pure function, no I/O.
 */
export function formatIdentitySummary(identity: IdentityLayer): string {
  const lines: string[] = [
    `Identity: ${identity.aiName} (working with ${identity.principalName})`,
    `Catchphrase: "${identity.catchphrase}"`,
    `Style: ${identity.preferences.responseStyle} | Timezone: ${identity.preferences.timezone} | Locale: ${identity.preferences.locale}`,
  ];
  return lines.join("\n");
}

// =============================================================================
// F-005 2: formatLearningSummary
// =============================================================================

/**
 * Format the learned layer into a summary string.
 * Returns "" when all categories are empty.
 * Pure function, no I/O.
 */
export function formatLearningSummary(learned: LearnedLayer): string {
  const pCount = learned.patterns.length;
  const iCount = learned.insights.length;
  const sCount = learned.selfKnowledge.length;

  if (pCount === 0 && iCount === 0 && sCount === 0) {
    return "";
  }

  const lines: string[] = [];

  // Summary line with counts
  const parts: string[] = [];
  parts.push(`${pCount} pattern${pCount !== 1 ? "s" : ""}`);
  parts.push(`${iCount} insight${iCount !== 1 ? "s" : ""}`);
  parts.push(`${sCount} self-knowledge`);
  lines.push(`Learnings: ${parts.join(", ")}`);

  // Confirmed items per non-empty category
  const categories: Array<{ name: string; items: typeof learned.patterns }> = [
    { name: "Patterns", items: learned.patterns },
    { name: "Insights", items: learned.insights },
    { name: "Self-knowledge", items: learned.selfKnowledge },
  ];

  for (const cat of categories) {
    const confirmed = cat.items.filter((item) => item.confirmed);
    if (confirmed.length === 0) continue;

    const shown = confirmed.slice(0, 5);
    const remaining = confirmed.length - shown.length;

    for (const item of shown) {
      lines.push(`  - ${item.content}`);
    }

    if (remaining > 0) {
      lines.push(`  ... and ${remaining} more`);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// F-005 3: formatProposals
// =============================================================================

/**
 * Format pending proposals into a numbered list.
 * Returns "" when there are no pending proposals.
 * Pure function, no I/O.
 */
export function formatProposals(proposals: Proposal[]): string {
  const pending = proposals.filter((p) => p.status === "pending");

  if (pending.length === 0) {
    return "";
  }

  const lines: string[] = [`Pending proposals (${pending.length}):`];

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    lines.push(`  ${i + 1}. [${p.type}] "${p.content}" (from ${p.source})`);
  }

  return lines.join("\n");
}

// =============================================================================
// F-005 4: formatSessionState
// =============================================================================

/**
 * Format the state layer into a session state summary.
 * Pure function, no I/O.
 */
export function formatSessionState(state: StateLayer): string {
  const lines: string[] = [];

  // Last session
  const lastSession = state.lastSessionAt ?? "never";
  lines.push(`Last session: ${lastSession}`);

  // Active projects
  const projects =
    state.activeProjects.length > 0
      ? state.activeProjects.join(", ")
      : "none";
  lines.push(`Active projects: ${projects}`);

  // Checkpoint (only if defined)
  if (state.checkpointRef) {
    lines.push(`Checkpoint: ${state.checkpointRef}`);
  }

  return lines.join("\n");
}

// =============================================================================
// F-005 5: generateSessionContext
// =============================================================================

/**
 * Generate the full session context string from a seed file.
 *
 * Mode:
 * - "full": identity + learnings + proposals + state
 * - "complement": learnings + proposals + state (skip identity)
 * - Auto-detect: PAI_DIR set => "complement", otherwise "full"
 *
 * Never throws.
 */
export async function generateSessionContext(
  seedPath?: string,
  options?: SessionContextOptions,
): Promise<SessionContext> {
  try {
    const mode: ContextMode =
      options?.mode ?? (process.env.PAI_DIR ? "complement" : "full");

    // Check first run
    const firstRun = await isFirstRun(seedPath);
    if (firstRun) {
      return {
        ok: true,
        context: "PAI seed needs setup. Run the setup wizard to configure your identity.",
        needsSetup: true,
        config: null,
        proposalCount: 0,
      };
    }

    // Load seed with git integration
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config = loadResult.config;
    const pendingProposals = config.state.proposals.filter(
      (p) => p.status === "pending",
    );

    // Build context sections
    const sections: string[] = [];

    // Version line always first
    sections.push(`Seed: v${config.version}`);

    // Identity (full mode only)
    if (mode === "full") {
      sections.push(formatIdentitySummary(config.identity));
    }

    // Learnings
    const learningSummary = formatLearningSummary(config.learned);
    if (learningSummary) {
      sections.push(learningSummary);
    }

    // Proposals
    const proposalSummary = formatProposals(config.state.proposals);
    if (proposalSummary) {
      sections.push(proposalSummary);
    }

    // State
    sections.push(formatSessionState(config.state));

    return {
      ok: true,
      context: sections.join("\n\n"),
      needsSetup: false,
      config,
      proposalCount: pendingProposals.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-005 6: sessionStartHook
// =============================================================================

/**
 * Thin wrapper around generateSessionContext.
 * Always returns a string, never throws.
 */
export async function sessionStartHook(
  seedPath?: string,
  options?: SessionContextOptions,
): Promise<string> {
  try {
    const result = await generateSessionContext(seedPath, options);
    if (result.ok) {
      return result.context;
    }
    return `PAI session context error: ${result.error}`;
  } catch (err) {
    return `PAI session context error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
