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
      // F-022: Progressive disclosure metadata
      learningsShown?: number;
      learningsTotal?: number;
      tokenEstimate?: number;
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
// F-022: formatRelevantLearnings — Semantic retrieval
// =============================================================================

/**
 * Format relevant learnings using F-025 semantic retrieval.
 * Falls back to recency when embeddings unavailable (score=0).
 * Returns empty string when no learnings exist.
 */
export async function formatRelevantLearnings(
  config: SeedConfig,
  context: { project?: string; cwd?: string },
): Promise<string> {
  const totalLearnings =
    config.learned.patterns.length +
    config.learned.insights.length +
    config.learned.selfKnowledge.length;

  if (totalLearnings === 0) {
    return "";
  }

  try {
    // Dynamic import to avoid embedding dependency at startup
    const { retrieveRelevantLearnings } = await import("./embeddings");

    const ranked = await retrieveRelevantLearnings(config, context, {
      maxResults: 5,
      minSimilarity: 0.2,
    });

    if (ranked.length === 0) {
      return ""; // No relevant learnings found
    }

    const isSemantic = ranked[0].method === "semantic";
    const header = isSemantic
      ? `Relevant learnings (${ranked.length}/${totalLearnings}):`
      : `Recent learnings (${ranked.length}/${totalLearnings}):`;

    const lines: string[] = [header];

    for (const { learning, type, score } of ranked) {
      if (isSemantic) {
        lines.push(`  [${score.toFixed(2)}] ${type}: ${learning.content}`);
      } else {
        lines.push(`  - ${type}: ${learning.content}`);
      }
    }

    return lines.join("\n");
  } catch {
    // Embedding module unavailable — silent fallback to empty
    return "";
  }
}

// =============================================================================
// F-022: formatCompactProposals — Compact index format
// =============================================================================

/**
 * Format proposals as compact index.
 * ID prefix (5 chars), type, truncated content (40 chars), confidence.
 * Replaces old formatProposals for F-022.
 */
export function formatCompactProposals(proposals: Proposal[]): string {
  const pending = proposals.filter((p) => p.status === "pending");

  if (pending.length === 0) {
    return "";
  }

  // Sort by recency (most recent first)
  const sorted = [...pending].sort(
    (a, b) =>
      new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime(),
  );

  const lines: string[] = [`Pending proposals (${pending.length}):`];

  for (const p of sorted) {
    const idPrefix = p.id.slice(0, 5);
    const truncated =
      p.content.length > 40
        ? p.content.slice(0, 40) + " ..."
        : p.content;
    const confidence = p.confidence?.toFixed(2) ?? "N/A";
    lines.push(`  ${idPrefix} ${p.type.padEnd(14)} "${truncated}" (${confidence})`);
  }

  lines.push("");
  lines.push("Review: `pai-seed proposals review`");

  return lines.join("\n");
}

// =============================================================================
// F-005 3: formatProposals
// =============================================================================

/**
 * Format pending proposals into a numbered list.
 * Returns "" when there are no pending proposals.
 * Shows top 5 by recency with footer for remaining.
 * Pure function, no I/O.
 */
const MAX_SURFACED_PROPOSALS = 5;

export function formatProposals(proposals: Proposal[]): string {
  const pending = proposals.filter((p) => p.status === "pending");

  if (pending.length === 0) {
    return "";
  }

  // Sort by recency (most recent first)
  const sorted = [...pending].sort(
    (a, b) =>
      new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime(),
  );

  const shown = sorted.slice(0, MAX_SURFACED_PROPOSALS);
  const remaining = pending.length - shown.length;

  const lines: string[] = [`Pending proposals (${pending.length}):`];

  for (let i = 0; i < shown.length; i++) {
    const p = shown[i];
    lines.push(`  ${i + 1}. [${p.type}] "${p.content}" (from ${p.source})`);
  }

  if (remaining > 0) {
    lines.push(
      `\n  ... and ${remaining} more pending. Run \`pai-seed proposals review\` to manage.`,
    );
  }

  lines.push(
    `\nSuggestion: Ask your AI to help review proposals, or run \`pai-seed proposals review\`.`,
  );

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

    // F-022: Learnings with semantic retrieval
    const totalLearnings =
      config.learned.patterns.length +
      config.learned.insights.length +
      config.learned.selfKnowledge.length;
    let learningsShown = 0;

    const learningSummary = await formatRelevantLearnings(config, {
      project: config.state.activeProjects[0],
      cwd: process.cwd(),
    });
    if (learningSummary) {
      sections.push(learningSummary);
      // Count shown learnings from output
      const matches = learningSummary.match(/(?:Relevant|Recent) learnings \((\d+)\/\d+\):/);
      if (matches) {
        learningsShown = parseInt(matches[1], 10);
      }
    }

    // F-022: Proposals with compact format
    const proposalSummary = formatCompactProposals(config.state.proposals);
    if (proposalSummary) {
      sections.push(proposalSummary);
    }

    // State
    sections.push(formatSessionState(config.state));

    const contextStr = sections.join("\n\n");

    return {
      ok: true,
      context: contextStr,
      needsSetup: false,
      config,
      proposalCount: pendingProposals.length,
      // F-022: Metadata
      learningsShown,
      learningsTotal: totalLearnings,
      tokenEstimate: Math.ceil(contextStr.length / 4),
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
