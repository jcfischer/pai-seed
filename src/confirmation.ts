import type { Proposal, Learning, SeedConfig } from "./schema";
import { loadSeedWithGit, writeSeedWithCommit } from "./git";

// =============================================================================
// F-007: Types
// =============================================================================

export type PendingResult =
  | { ok: true; proposals: Proposal[]; count: number }
  | { ok: false; error: string };

export type ConfirmResult =
  | { ok: true; learning: Learning }
  | { ok: false; error: string };

export type RejectResult =
  | { ok: true }
  | { ok: false; error: string };

export type BulkResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

// =============================================================================
// F-007 1: proposalToLearning — Pure helper
// =============================================================================

/**
 * Convert a Proposal to a Learning entry.
 *
 * Preserves: id, content, source, extractedAt
 * Sets: confirmed = true, confirmedAt = now (ISO), tags = []
 */
export function proposalToLearning(proposal: Proposal): Learning {
  return {
    id: proposal.id,
    content: proposal.content,
    source: proposal.source,
    extractedAt: proposal.extractedAt,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    tags: [],
  };
}

// =============================================================================
// F-007 2: addLearningToCategory — Pure helper
// =============================================================================

/**
 * Push a Learning entry into the correct category array on the config.
 * Mutates config in place.
 *
 * Routes:
 * - "pattern"        -> config.learned.patterns
 * - "insight"        -> config.learned.insights
 * - "self_knowledge" -> config.learned.selfKnowledge
 */
export function addLearningToCategory(
  config: SeedConfig,
  learning: Learning,
  type: Proposal["type"],
): void {
  switch (type) {
    case "pattern":
      config.learned.patterns.push(learning);
      break;
    case "insight":
      config.learned.insights.push(learning);
      break;
    case "self_knowledge":
      config.learned.selfKnowledge.push(learning);
      break;
  }
}

// =============================================================================
// F-007 3: getPendingProposals — I/O function
// =============================================================================

/**
 * Load seed and return all pending proposals, sorted by extractedAt ascending.
 *
 * Never throws — returns { ok: false, error } on failure.
 */
export async function getPendingProposals(
  seedPath?: string,
): Promise<PendingResult> {
  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const pending = loadResult.config.state.proposals
      .filter((p) => p.status === "pending")
      .sort((a, b) => a.extractedAt.localeCompare(b.extractedAt));

    return { ok: true, proposals: pending, count: pending.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-007 4: acceptProposal — I/O function
// =============================================================================

/**
 * Accept a single proposal by ID: convert to Learning, route to category, remove from proposals.
 *
 * Errors:
 * - Not found: "Proposal 'xxx' not found"
 * - Not pending: "Proposal 'xxx' is already rejected"
 *
 * Commit message: "Confirm: accepted '${content.slice(0, 50)}'"
 */
export async function acceptProposal(
  proposalId: string,
  seedPath?: string,
): Promise<ConfirmResult> {
  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config = loadResult.config;
    const proposal = config.state.proposals.find((p) => p.id === proposalId);

    if (!proposal) {
      return { ok: false, error: `Proposal '${proposalId}' not found` };
    }

    if (proposal.status !== "pending") {
      return { ok: false, error: `Proposal '${proposalId}' is already ${proposal.status}` };
    }

    // Convert to learning and route to category
    const learning = proposalToLearning(proposal);
    addLearningToCategory(config, learning, proposal.type);

    // Remove from proposals
    config.state.proposals = config.state.proposals.filter(
      (p) => p.id !== proposalId,
    );

    // Commit
    const commitMsg = `Confirm: accepted '${proposal.content.slice(0, 50)}'`;
    await writeSeedWithCommit(config, commitMsg, seedPath);

    return { ok: true, learning };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-007 5: rejectProposal — I/O function
// =============================================================================

/**
 * Reject a single proposal by ID: set status to "rejected".
 *
 * Errors:
 * - Not found: "Proposal 'xxx' not found"
 * - Not pending: "Proposal 'xxx' is already rejected"
 *
 * Commit message: "Reject: rejected '${content.slice(0, 50)}'"
 */
export async function rejectProposal(
  proposalId: string,
  seedPath?: string,
): Promise<RejectResult> {
  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config = loadResult.config;
    const proposal = config.state.proposals.find((p) => p.id === proposalId);

    if (!proposal) {
      return { ok: false, error: `Proposal '${proposalId}' not found` };
    }

    if (proposal.status !== "pending") {
      return { ok: false, error: `Proposal '${proposalId}' is already ${proposal.status}` };
    }

    // Set status to rejected
    proposal.status = "rejected";

    // Commit
    const commitMsg = `Reject: rejected '${proposal.content.slice(0, 50)}'`;
    await writeSeedWithCommit(config, commitMsg, seedPath);

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-007 6: acceptAllProposals — I/O function
// =============================================================================

/**
 * Accept all pending proposals: convert each to Learning, route, remove from proposals.
 *
 * If none pending: returns { ok: true, count: 0 } without writing.
 * Commit message: "Confirm: accepted N proposals"
 */
export async function acceptAllProposals(
  seedPath?: string,
): Promise<BulkResult> {
  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config = loadResult.config;
    const pending = config.state.proposals.filter((p) => p.status === "pending");

    if (pending.length === 0) {
      return { ok: true, count: 0 };
    }

    // Convert each pending proposal
    for (const proposal of pending) {
      const learning = proposalToLearning(proposal);
      addLearningToCategory(config, learning, proposal.type);
    }

    // Remove all pending proposals (keep rejected)
    config.state.proposals = config.state.proposals.filter(
      (p) => p.status !== "pending",
    );

    // Single commit
    const commitMsg = `Confirm: accepted ${pending.length} proposals`;
    await writeSeedWithCommit(config, commitMsg, seedPath);

    return { ok: true, count: pending.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-007 7: rejectAllProposals — I/O function
// =============================================================================

/**
 * Reject all pending proposals: set status to "rejected".
 *
 * If none pending: returns { ok: true, count: 0 } without writing.
 * Commit message: "Reject: rejected N proposals"
 */
export async function rejectAllProposals(
  seedPath?: string,
): Promise<BulkResult> {
  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config = loadResult.config;
    const pending = config.state.proposals.filter((p) => p.status === "pending");

    if (pending.length === 0) {
      return { ok: true, count: 0 };
    }

    // Set each pending proposal to rejected
    for (const proposal of pending) {
      proposal.status = "rejected";
    }

    // Single commit
    const commitMsg = `Reject: rejected ${pending.length} proposals`;
    await writeSeedWithCommit(config, commitMsg, seedPath);

    return { ok: true, count: pending.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-007 8: cleanRejected — I/O function
// =============================================================================

/**
 * Remove all rejected proposals from state.
 *
 * If none rejected: returns { ok: true, count: 0 } without writing.
 * Commit message: "Cleanup: removed N rejected proposals"
 */
export async function cleanRejected(
  seedPath?: string,
): Promise<BulkResult> {
  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config = loadResult.config;
    const rejected = config.state.proposals.filter(
      (p) => p.status === "rejected",
    );

    if (rejected.length === 0) {
      return { ok: true, count: 0 };
    }

    // Filter out rejected, keep everything else
    config.state.proposals = config.state.proposals.filter(
      (p) => p.status !== "rejected",
    );

    // Single commit
    const commitMsg = `Cleanup: removed ${rejected.length} rejected proposals`;
    await writeSeedWithCommit(config, commitMsg, seedPath);

    return { ok: true, count: rejected.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
