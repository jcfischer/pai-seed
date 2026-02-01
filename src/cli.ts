#!/usr/bin/env bun

import { loadSeed, resolveSeedPath } from "./loader";
import { loadSeedWithGit } from "./git";
import { formatIdentitySummary } from "./session";
import { isGitRepo, repairFromGit, writeSeedWithCommit, hasUncommittedChanges } from "./git";
import { validateSeed } from "./validate";
import { nanoid } from "nanoid";
import type { Learning, Proposal, SeedConfig } from "./schema";
import {
  addRelationship,
  loadRelationship,
  listRelationships,
  addKeyMoment,
} from "./relationships";
import { redactEvent } from "./redaction";
import { getStaleLearnings, reconfirmLearning } from "./freshness";
import {
  getPendingProposals,
  acceptProposal,
  rejectProposal,
  acceptAllProposals,
  rejectAllProposals,
  cleanRejected,
  proposalToLearning,
  addLearningToCategory,
} from "./confirmation";
import { resolveIdPrefix } from "./id-prefix";

// =============================================================================
// F-011: ANSI Helpers
// =============================================================================

const isTTY = process.stdout.isTTY ?? false;

const ansi = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string) => (isTTY ? `\x1b[34m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

// =============================================================================
// F-011: Command Handlers
// =============================================================================

async function cmdShow(seedPath?: string, json?: boolean): Promise<number> {
  const result = await loadSeed(seedPath);
  if (!result.ok) {
    if (json) {
      console.log(JSON.stringify({ error: result.error.message }));
    } else {
      console.error(ansi.red(`Error: ${result.error.message}`));
    }
    return 1;
  }

  const { config } = result;

  // JSON output for machine consumption (used by ACR)
  if (json) {
    const allLearnings = [
      ...config.learned.patterns.map((l) => ({ ...l, _type: "pattern" as const })),
      ...config.learned.insights.map((l) => ({ ...l, _type: "insight" as const })),
      ...config.learned.selfKnowledge.map((l) => ({ ...l, _type: "self_knowledge" as const })),
    ];

    const learnings = allLearnings.map((l) => ({
      id: l.id,
      type: l._type,
      content: l.content,
      confirmed: l.confirmed ?? false,
      tags: l.tags ?? [],
      createdAt: new Date(l.extractedAt).getTime(),
      updatedAt: new Date(l.confirmedAt ?? l.extractedAt).getTime(),
    }));

    console.log(JSON.stringify({
      version: config.version,
      learnings,
    }));
    return 0;
  }

  // Identity
  console.log(ansi.bold("=== Identity ==="));
  console.log(formatIdentitySummary(config.identity));
  console.log();

  // Learnings
  console.log(ansi.bold("=== Learnings ==="));
  const patterns = config.learned.patterns.length;
  const insights = config.learned.insights.length;
  const selfK = config.learned.selfKnowledge.length;
  console.log(`Patterns: ${patterns} | Insights: ${insights} | Self-knowledge: ${selfK}`);
  console.log(`Total: ${patterns + insights + selfK}`);
  console.log();

  // Proposals
  console.log(ansi.bold("=== Proposals ==="));
  const proposals = config.state.proposals.length;
  console.log(`Pending: ${proposals}`);

  // Checkpoint
  if (config.state.checkpointRef) {
    console.log();
    console.log(ansi.bold("=== Checkpoint ==="));
    console.log(`Ref: ${config.state.checkpointRef}`);
  }

  // Migration info
  if (result.migrated) {
    console.log();
    console.log(ansi.yellow(`Migrated: ${result.migrated.from} → ${result.migrated.to}`));
  }

  return 0;
}

async function cmdStatus(seedPath?: string): Promise<number> {
  const path = resolveSeedPath(seedPath);
  console.log(`Path: ${path}`);

  const file = Bun.file(path);
  const exists = await file.exists();
  console.log(`Exists: ${exists ? ansi.green("yes") : ansi.red("no")}`);

  if (!exists) return 0;

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    const validation = validateSeed(parsed);

    if (validation.valid) {
      console.log(`Version: ${validation.config.version}`);
      console.log(`Valid: ${ansi.green("yes")}`);
    } else {
      console.log(`Valid: ${ansi.red("no")}`);
      for (const err of validation.errors) {
        console.log(`  ${err.path}: ${err.message}`);
      }
    }
  } catch (err) {
    console.log(`Valid: ${ansi.red("no")} (${err instanceof Error ? err.message : "parse error"})`);
  }

  // Git status
  const dir = path.replace(/\/[^/]+$/, "");
  const isRepo = await isGitRepo(dir);
  console.log(`Git repo: ${isRepo ? ansi.green("yes") : ansi.dim("no")}`);
  if (isRepo) {
    const uncommitted = await hasUncommittedChanges(dir);
    console.log(`Uncommitted changes: ${uncommitted ? ansi.yellow("yes") : "no"}`);
  }

  return 0;
}

async function cmdDiff(seedPath?: string): Promise<number> {
  const path = resolveSeedPath(seedPath);
  const dir = path.replace(/\/[^/]+$/, "");

  if (!(await isGitRepo(dir))) {
    console.log("Not a git repository");
    return 0;
  }

  try {
    const proc = Bun.spawn(["git", "diff", "HEAD", "--", "seed.json"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    if (exitCode !== 0 || !stdout.trim()) {
      console.log("No changes since last commit");
      return 0;
    }

    console.log(stdout);
  } catch {
    console.log("No changes since last commit");
  }

  return 0;
}

async function cmdLearn(args: string[], seedPath?: string, verb = "added"): Promise<number> {
  if (args.length < 2) {
    const cmd = verb === "captured" ? "capture" : "learn";
    console.error(ansi.red(`Usage: pai-seed ${cmd} <type> <content...>`));
    console.error("Types: pattern, insight, self_knowledge");
    return 1;
  }

  const type = args[0];
  if (!["pattern", "insight", "self_knowledge"].includes(type)) {
    console.error(ansi.red(`Invalid type: "${type}". Must be pattern, insight, or self_knowledge`));
    return 1;
  }

  const content = args.slice(1).join(" ");
  if (!content.trim()) {
    console.error(ansi.red("Content cannot be empty"));
    return 1;
  }

  const result = await loadSeed(seedPath);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  const learning: Learning = {
    id: nanoid(),
    content: content.trim(),
    source: "cli:manual",
    extractedAt: new Date().toISOString(),
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    tags: [],
  };

  const config = { ...result.config };
  const learned = { ...config.learned };

  if (type === "pattern") {
    learned.patterns = [...learned.patterns, learning];
  } else if (type === "insight") {
    learned.insights = [...learned.insights, learning];
  } else {
    learned.selfKnowledge = [...learned.selfKnowledge, learning];
  }

  config.learned = learned;

  const writeResult = await writeSeedWithCommit(
    config,
    `Learn: ${verb} ${type} via CLI`,
    seedPath,
  );

  if (!writeResult.ok) {
    console.error(ansi.red(`Error: ${writeResult.error.message}`));
    return 1;
  }

  console.log(ansi.green(`Added ${type}: "${content.trim()}"`));
  console.log(ansi.dim(`ID: ${learning.id}`));
  return 0;
}

async function cmdForget(args: string[], seedPath?: string): Promise<number> {
  if (args.length < 1) {
    console.error(ansi.red("Usage: pai-seed forget <id>"));
    return 1;
  }

  const id = args[0];

  const result = await loadSeed(seedPath);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  const config = { ...result.config };
  const learned = { ...config.learned };

  // Search all categories
  let found = false;
  let category = "";

  const originalPatterns = learned.patterns.length;
  learned.patterns = learned.patterns.filter((l) => l.id !== id);
  if (learned.patterns.length < originalPatterns) {
    found = true;
    category = "pattern";
  }

  const originalInsights = learned.insights.length;
  learned.insights = learned.insights.filter((l) => l.id !== id);
  if (learned.insights.length < originalInsights) {
    found = true;
    category = "insight";
  }

  const originalSelfK = learned.selfKnowledge.length;
  learned.selfKnowledge = learned.selfKnowledge.filter((l) => l.id !== id);
  if (learned.selfKnowledge.length < originalSelfK) {
    found = true;
    category = "self_knowledge";
  }

  if (!found) {
    console.error(ansi.red(`Learning not found: ${id}`));
    return 1;
  }

  config.learned = learned;

  const writeResult = await writeSeedWithCommit(
    config,
    `Learn: removed ${id}`,
    seedPath,
  );

  if (!writeResult.ok) {
    console.error(ansi.red(`Error: ${writeResult.error.message}`));
    return 1;
  }

  console.log(ansi.green(`Removed ${category}: ${id}`));
  return 0;
}

async function cmdRepair(seedPath?: string): Promise<number> {
  const result = await repairFromGit(seedPath);

  if (!result.ok) {
    console.error(ansi.red(`Repair failed: ${result.error}`));
    return 1;
  }

  if (result.repaired) {
    console.log(ansi.green(`Repaired: ${result.message}`));
  } else {
    console.log(ansi.yellow(`Reset: ${result.message}`));
  }

  return 0;
}

// =============================================================================
// F-013: Relationship Commands
// =============================================================================

async function cmdRel(args: string[]): Promise<number> {
  const sub = args[0];

  if (!sub || sub === "help") {
    console.log(`${ansi.bold("pai-seed rel")} — Relationship management

${ansi.bold("Usage:")}
  pai-seed rel <subcommand> [args...]

${ansi.bold("Subcommands:")}
  list                        List all relationships
  show <name>                 Show relationship details
  add <name> [context]        Create new relationship
  moment <name> <description> Add key moment`);
    return 0;
  }

  // Resolve paiDir from seedPath to keep relationships in the same .pai directory
  const seedPath = resolveSeedPath();
  const paiDir = seedPath.replace(/\/[^/]+$/, "");
  const opts = { paiDir };

  switch (sub) {
    case "list": {
      const result = await listRelationships(opts);
      if (!result.ok) {
        console.error(ansi.red(`Error: ${result.error}`));
        return 1;
      }
      if (result.names.length === 0) {
        console.log(ansi.dim("No relationships found."));
        return 0;
      }
      console.log(ansi.bold("Relationships:"));
      for (const name of result.names) {
        console.log(`  ${name}`);
      }
      return 0;
    }

    case "show": {
      const name = args.slice(1).join(" ");
      if (!name) {
        console.error(ansi.red("Usage: pai-seed rel show <name>"));
        return 1;
      }
      const result = await loadRelationship(name, opts);
      if (!result.ok) {
        console.error(ansi.red(`Error: ${result.error}`));
        return 1;
      }
      const rel = result.relationship;
      console.log(ansi.bold(`=== ${rel.name} ===`));
      console.log(`First encountered: ${rel.firstEncountered.slice(0, 10)}`);
      console.log(`Last interaction:  ${rel.lastInteraction.slice(0, 10)}`);
      if (rel.context) {
        console.log(`Context: ${rel.context}`);
      }
      if (rel.keyMoments.length > 0) {
        console.log();
        console.log(ansi.bold("Key Moments:"));
        for (const m of rel.keyMoments) {
          const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
          console.log(`  ${m.date.slice(0, 10)}: ${m.description}${tags}`);
        }
      }
      return 0;
    }

    case "add": {
      if (args.length < 2) {
        console.error(ansi.red("Usage: pai-seed rel add <name> [context]"));
        return 1;
      }
      const name = args[1];
      const context = args.slice(2).join(" ") || undefined;
      const result = await addRelationship(name, context, opts);
      if (!result.ok) {
        console.error(ansi.red(`Error: ${result.error}`));
        return 1;
      }
      console.log(ansi.green(`Added relationship: ${name}`));
      return 0;
    }

    case "moment": {
      if (args.length < 3) {
        console.error(ansi.red("Usage: pai-seed rel moment <name> <description>"));
        return 1;
      }
      const name = args[1];
      const description = args.slice(2).join(" ");
      const result = await addKeyMoment(name, description, undefined, opts);
      if (!result.ok) {
        console.error(ansi.red(`Error: ${result.error}`));
        return 1;
      }
      console.log(ansi.green(`Added moment to ${name}: "${description}"`));
      return 0;
    }

    default:
      console.error(ansi.red(`Unknown rel subcommand: ${sub}`));
      console.error('Run "pai-seed rel help" for usage.');
      return 1;
  }
}

// =============================================================================
// F-015: Stale and Refresh Commands
// =============================================================================

async function cmdStale(seedPath?: string): Promise<number> {
  const result = await loadSeed(seedPath);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  const stale = getStaleLearnings(result.config);
  if (stale.length === 0) {
    console.log(ansi.green("No stale learnings. All learnings are fresh."));
    return 0;
  }

  console.log(ansi.bold(`${stale.length} stale learning${stale.length === 1 ? "" : "s"}:`));
  console.log();
  for (const item of stale) {
    const label = item.category === "selfKnowledge" ? "self_knowledge" : item.category;
    console.log(`  ${ansi.yellow(`[${label}]`)} ${item.learning.content}`);
    console.log(`    ${ansi.dim(`ID: ${item.learning.id} | ${item.daysSinceConfirmed}d since confirmed`)}`);
  }
  console.log();
  console.log(ansi.dim('Use "pai-seed refresh <id>" to re-confirm or "pai-seed forget <id>" to remove.'));
  return 0;
}

async function cmdRefresh(args: string[], seedPath?: string): Promise<number> {
  if (args.length < 1) {
    console.error(ansi.red("Usage: pai-seed refresh <id>"));
    return 1;
  }

  const id = args[0];
  const result = await reconfirmLearning(id, seedPath);

  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  console.log(ansi.green(`Refreshed: "${result.learning.content}"`));
  console.log(ansi.dim(`Confirmed at: ${result.learning.confirmedAt}`));
  return 0;
}

// =============================================================================
// F-016: Redact Command
// =============================================================================

async function cmdRedact(args: string[]): Promise<number> {
  if (args.length < 1) {
    console.error(ansi.red("Usage: pai-seed redact <event_id> [reason]"));
    return 1;
  }

  const eventId = args[0];
  const reason = args.slice(1).join(" ") || undefined;

  const result = await redactEvent(eventId, reason);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  console.log(ansi.green(`Redacted event: ${result.redactedEventId}`));
  if (reason) {
    console.log(ansi.dim(`Reason: ${reason}`));
  }
  return 0;
}

// =============================================================================
// F-018: Formatting Helpers
// =============================================================================

function typeBadge(type: string): string {
  switch (type) {
    case "pattern":
      return ansi.blue("pattern");
    case "insight":
      return ansi.green("insight");
    case "self_knowledge":
      return ansi.yellow("self-know");
    default:
      return type;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function relativeAge(isoDate: string): string {
  const days = Math.floor(
    (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatProposalCompact(p: Proposal): string {
  const method = p.method ? ansi.dim(` (${p.method})`) : "";
  return `${ansi.dim(shortId(p.id))}  ${typeBadge(p.type).padEnd(isTTY ? 19 : 10)}  ${truncate(p.content, 60)}${method}`;
}

function formatProposalVerbose(p: Proposal): string {
  const lines = [
    `${ansi.dim("──")} ${ansi.bold(p.id)} ${ansi.dim("─".repeat(Math.max(0, 50 - p.id.length)))}`,
    `Type:      ${typeBadge(p.type)}`,
    `Content:   ${p.content}`,
    `Source:    ${p.source}`,
    `Extracted: ${p.extractedAt.slice(0, 16).replace("T", " ")}`,
  ];
  if (p.method) {
    lines.push(`Method:    ${p.method}`);
  }
  return lines.join("\n");
}

function formatLearningCompact(l: Learning, type: string): string {
  const age = relativeAge(l.confirmedAt ?? l.extractedAt);
  return `${ansi.dim(shortId(l.id))}  ${typeBadge(type).padEnd(isTTY ? 19 : 10)}  ${truncate(l.content, 52)}  ${ansi.dim(age)}`;
}

function formatLearningVerbose(l: Learning, type: string): string {
  const lines = [
    `${ansi.dim("──")} ${ansi.bold(l.id)} ${ansi.dim("─".repeat(Math.max(0, 50 - l.id.length)))}`,
    `Type:      ${typeBadge(type)}`,
    `Content:   ${l.content}`,
    `Source:    ${l.source}`,
    `Extracted: ${l.extractedAt.slice(0, 16).replace("T", " ")}`,
  ];
  if (l.confirmedAt) {
    lines.push(`Confirmed: ${l.confirmedAt.slice(0, 16).replace("T", " ")}`);
  }
  if (l.tags && l.tags.length > 0) {
    lines.push(`Tags:      ${l.tags.join(", ")}`);
  }
  return lines.join("\n");
}

/** Collect all learnings with their type labels. */
function allLearnings(config: SeedConfig): Array<{ learning: Learning; type: string }> {
  return [
    ...config.learned.patterns.map((l) => ({ learning: l, type: "pattern" })),
    ...config.learned.insights.map((l) => ({ learning: l, type: "insight" })),
    ...config.learned.selfKnowledge.map((l) => ({ learning: l, type: "self_knowledge" })),
  ];
}

// =============================================================================
// F-018: Proposals Command
// =============================================================================

async function cmdProposals(args: string[]): Promise<number> {
  const action = args[0];

  if (!action || action === "help") {
    console.log(`${ansi.bold("pai-seed proposals")} — Manage pending proposals

${ansi.bold("Usage:")}
  pai-seed proposals <action> [args...]

${ansi.bold("Actions:")}
  list [--verbose]       List pending proposals
  accept <id>            Accept a proposal by ID prefix
  reject <id>            Reject a proposal by ID prefix
  review                 Interactive review of all proposals
  accept-all             Accept all pending proposals
  reject-all             Reject all pending proposals
  clean                  Remove rejected proposals from state

${ansi.bold("Examples:")}
  pai-seed proposals list
  pai-seed proposals accept gDo_K4_n
  pai-seed proposals review`);
    return 0;
  }

  switch (action) {
    case "list":
      return cmdProposalsList(args.slice(1));
    case "accept":
      return cmdProposalsAccept(args.slice(1));
    case "reject":
      return cmdProposalsReject(args.slice(1));
    case "review":
      return cmdProposalsReview();
    case "accept-all":
      return cmdProposalsAcceptAll();
    case "reject-all":
      return cmdProposalsRejectAll();
    case "clean":
      return cmdProposalsClean();
    default:
      console.error(ansi.red(`Unknown proposals action: ${action}`));
      console.error('Run "pai-seed proposals help" for usage.');
      return 1;
  }
}

async function cmdProposalsList(args: string[]): Promise<number> {
  const verbose = args.includes("--verbose");
  const result = await getPendingProposals();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  if (result.count === 0) {
    console.log("No pending proposals.");
    return 0;
  }

  console.log(ansi.bold(`${result.count} pending proposal${result.count === 1 ? "" : "s"}:\n`));

  if (verbose) {
    for (const p of result.proposals) {
      console.log(formatProposalVerbose(p));
      console.log();
    }
  } else {
    console.log(`${ansi.dim("ID        Type        Content")}`);
    console.log(ansi.dim("─".repeat(72)));
    for (const p of result.proposals) {
      console.log(formatProposalCompact(p));
    }
  }

  return 0;
}

async function cmdProposalsAccept(args: string[]): Promise<number> {
  if (args.length < 1) {
    console.error(ansi.red("Usage: pai-seed proposals accept <id-prefix>"));
    return 1;
  }

  const prefix = args[0];
  const pending = await getPendingProposals();
  if (!pending.ok) {
    console.error(ansi.red(`Error: ${pending.error}`));
    return 1;
  }

  const resolved = resolveIdPrefix(pending.proposals, prefix);
  if (!resolved.ok) {
    console.error(ansi.red(resolved.error));
    return 1;
  }

  const result = await acceptProposal(resolved.id);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  console.log(ansi.green(`Accepted: "${truncate(result.learning.content, 60)}"`));
  console.log(ansi.dim(`ID: ${resolved.id}`));
  return 0;
}

async function cmdProposalsReject(args: string[]): Promise<number> {
  if (args.length < 1) {
    console.error(ansi.red("Usage: pai-seed proposals reject <id-prefix>"));
    return 1;
  }

  const prefix = args[0];
  const pending = await getPendingProposals();
  if (!pending.ok) {
    console.error(ansi.red(`Error: ${pending.error}`));
    return 1;
  }

  const resolved = resolveIdPrefix(pending.proposals, prefix);
  if (!resolved.ok) {
    console.error(ansi.red(resolved.error));
    return 1;
  }

  // Get the content for display before rejecting
  const proposal = pending.proposals.find((p) => p.id === resolved.id);
  const result = await rejectProposal(resolved.id);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  console.log(ansi.yellow(`Rejected: "${truncate(proposal?.content ?? resolved.id, 60)}"`));
  return 0;
}

async function cmdProposalsReview(): Promise<number> {
  const pending = await getPendingProposals();
  if (!pending.ok) {
    console.error(ansi.red(`Error: ${pending.error}`));
    return 1;
  }

  if (pending.count === 0) {
    console.log("No proposals to review.");
    return 0;
  }

  const decisions: Array<{ proposal: Proposal; action: "accept" | "reject" }> = [];
  let skipped = 0;

  for (let i = 0; i < pending.proposals.length; i++) {
    const p = pending.proposals[i];
    console.log();
    console.log(ansi.bold(`[${i + 1}/${pending.count}] ${typeBadge(p.type)} — ${shortId(p.id)}`));
    console.log(p.content);
    console.log(ansi.dim(`Source: ${p.source} | Extracted: ${p.extractedAt.slice(0, 16).replace("T", " ")}`));
    console.log();

    const answer = await promptReviewAction();
    if (answer === "a") {
      decisions.push({ proposal: p, action: "accept" });
      console.log(ansi.green("  → accepted"));
    } else if (answer === "r") {
      decisions.push({ proposal: p, action: "reject" });
      console.log(ansi.yellow("  → rejected"));
    } else if (answer === "q") {
      break;
    } else {
      skipped++;
      console.log(ansi.dim("  → skipped"));
    }
  }

  // Apply all decisions in one batch
  if (decisions.length > 0) {
    const loadResult = await loadSeedWithGit();
    if (!loadResult.ok) {
      console.error(ansi.red(`Error applying decisions: ${loadResult.error.message}`));
      return 1;
    }

    const config = loadResult.config;
    let accepted = 0;
    let rejected = 0;

    for (const { proposal, action } of decisions) {
      const found = config.state.proposals.find((p) => p.id === proposal.id);
      if (!found || found.status !== "pending") continue;

      if (action === "accept") {
        const learning = proposalToLearning(found);
        addLearningToCategory(config, learning, found.type);
        config.state.proposals = config.state.proposals.filter((p) => p.id !== found.id);
        accepted++;
      } else {
        found.status = "rejected";
        rejected++;
      }
    }

    if (accepted > 0 || rejected > 0) {
      const parts: string[] = [];
      if (accepted > 0) parts.push(`accepted ${accepted}`);
      if (rejected > 0) parts.push(`rejected ${rejected}`);
      await writeSeedWithCommit(config, `Review: ${parts.join(", ")} proposals`);
    }

    console.log();
    console.log(ansi.bold("Summary:"));
    console.log(`  ${ansi.green(`${accepted} accepted`)}, ${ansi.yellow(`${rejected} rejected`)}, ${ansi.dim(`${skipped} skipped`)}`);
  } else {
    console.log("\nNo decisions made.");
  }

  return 0;
}

async function promptReviewAction(): Promise<string> {
  process.stdout.write(`${ansi.dim("[a]ccept  [r]eject  [s]kip  [q]uit")} > `);

  // Try raw mode for single keypress, fall back to line input
  if (process.stdin.isTTY) {
    return new Promise((resolve) => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf-8");
      process.stdin.once("data", (data: string) => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        const key = data.trim().toLowerCase();
        process.stdout.write("\n");
        resolve(key);
      });
    });
  }

  // Line-based fallback
  const reader = process.stdin[Symbol.asyncIterator]();
  const { value } = await reader.next();
  return (value?.toString().trim().toLowerCase() ?? "s")[0] ?? "s";
}

async function cmdProposalsAcceptAll(): Promise<number> {
  const result = await acceptAllProposals();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  if (result.count === 0) {
    console.log("No pending proposals to accept.");
  } else {
    console.log(ansi.green(`Accepted ${result.count} proposal${result.count === 1 ? "" : "s"}.`));
  }
  return 0;
}

async function cmdProposalsRejectAll(): Promise<number> {
  const result = await rejectAllProposals();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  if (result.count === 0) {
    console.log("No pending proposals to reject.");
  } else {
    console.log(ansi.yellow(`Rejected ${result.count} proposal${result.count === 1 ? "" : "s"}.`));
  }
  return 0;
}

async function cmdProposalsClean(): Promise<number> {
  const result = await cleanRejected();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error}`));
    return 1;
  }

  if (result.count === 0) {
    console.log("No rejected proposals to clean.");
  } else {
    console.log(ansi.green(`Cleaned ${result.count} rejected proposal${result.count === 1 ? "" : "s"}.`));
  }
  return 0;
}

// =============================================================================
// F-018: Learnings Command
// =============================================================================

async function cmdLearnings(args: string[]): Promise<number> {
  const action = args[0];

  if (!action || action === "help") {
    console.log(`${ansi.bold("pai-seed learnings")} — Browse confirmed learnings

${ansi.bold("Usage:")}
  pai-seed learnings <action> [args...]

${ansi.bold("Actions:")}
  list [--type=X] [--verbose]   List confirmed learnings
  show <id>                     Show full detail for a learning
  search <query> [--type=X]     Search learning content

${ansi.bold("Types:")} pattern, insight, self_knowledge

${ansi.bold("Examples:")}
  pai-seed learnings list
  pai-seed learnings list --type=pattern
  pai-seed learnings show gDo_K4_n
  pai-seed learnings search "TypeScript"`);
    return 0;
  }

  switch (action) {
    case "list":
      return cmdLearningsList(args.slice(1));
    case "show":
      return cmdLearningsShow(args.slice(1));
    case "search":
      return cmdLearningsSearch(args.slice(1));
    default:
      console.error(ansi.red(`Unknown learnings action: ${action}`));
      console.error('Run "pai-seed learnings help" for usage.');
      return 1;
  }
}

function parseTypeFilter(args: string[]): string | undefined {
  const typeArg = args.find((a) => a.startsWith("--type="));
  return typeArg?.split("=")[1];
}

async function cmdLearningsList(args: string[]): Promise<number> {
  const verbose = args.includes("--verbose");
  const typeFilter = parseTypeFilter(args);

  if (typeFilter && !["pattern", "insight", "self_knowledge"].includes(typeFilter)) {
    console.error(ansi.red(`Invalid type: "${typeFilter}". Must be pattern, insight, or self_knowledge`));
    return 1;
  }

  const result = await loadSeed();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  let items = allLearnings(result.config);
  if (typeFilter) {
    items = items.filter((i) => i.type === typeFilter);
  }

  if (items.length === 0) {
    console.log("No learnings found.");
    return 0;
  }

  const label = typeFilter ? `${typeFilter} ` : "";
  console.log(ansi.bold(`${items.length} ${label}learning${items.length === 1 ? "" : "s"}:\n`));

  if (verbose) {
    for (const { learning, type } of items) {
      console.log(formatLearningVerbose(learning, type));
      console.log();
    }
  } else {
    console.log(`${ansi.dim("ID        Type        Content                                               Age")}`);
    console.log(ansi.dim("─".repeat(80)));
    for (const { learning, type } of items) {
      console.log(formatLearningCompact(learning, type));
    }
  }

  return 0;
}

async function cmdLearningsShow(args: string[]): Promise<number> {
  if (args.length < 1) {
    console.error(ansi.red("Usage: pai-seed learnings show <id-prefix>"));
    return 1;
  }

  const prefix = args[0];
  const result = await loadSeed();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  const items = allLearnings(result.config);
  const resolved = resolveIdPrefix(
    items.map((i) => ({ id: i.learning.id })),
    prefix,
  );
  if (!resolved.ok) {
    console.error(ansi.red(resolved.error));
    return 1;
  }

  const match = items.find((i) => i.learning.id === resolved.id);
  if (!match) {
    console.error(ansi.red(`Learning not found: ${resolved.id}`));
    return 1;
  }

  console.log(formatLearningVerbose(match.learning, match.type));
  return 0;
}

async function cmdLearningsSearch(args: string[]): Promise<number> {
  const typeFilter = parseTypeFilter(args);
  const queryArgs = args.filter((a) => !a.startsWith("--"));
  const query = queryArgs.join(" ");

  if (!query) {
    console.error(ansi.red("Usage: pai-seed learnings search <query>"));
    return 1;
  }

  const result = await loadSeed();
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  let items = allLearnings(result.config);
  if (typeFilter) {
    items = items.filter((i) => i.type === typeFilter);
  }

  const lowerQuery = query.toLowerCase();
  const matches = items.filter((i) =>
    i.learning.content.toLowerCase().includes(lowerQuery),
  );

  if (matches.length === 0) {
    console.log(`No learnings matching "${query}".`);
    return 0;
  }

  console.log(ansi.bold(`${matches.length} match${matches.length === 1 ? "" : "es"} for "${query}":\n`));

  for (const { learning, type } of matches) {
    // Highlight matching portion
    const idx = learning.content.toLowerCase().indexOf(lowerQuery);
    const before = learning.content.slice(0, idx);
    const matched = learning.content.slice(idx, idx + query.length);
    const after = learning.content.slice(idx + query.length);
    const highlighted = `${before}${ansi.bold(matched)}${after}`;

    console.log(`${ansi.dim(shortId(learning.id))}  ${typeBadge(type).padEnd(isTTY ? 19 : 10)}  ${truncate(highlighted, 70)}`);
  }

  return 0;
}

// =============================================================================
// F-011: Help Text
// =============================================================================

function printHelp(): void {
  console.log(`${ansi.bold("pai-seed")} — CLI for seed.json management

${ansi.bold("Usage:")}
  pai-seed <command> [args...]

${ansi.bold("Commands:")}
  show [--json]             Show seed configuration summary
  proposals <action>        Manage pending proposals
  learnings <action>        Browse confirmed learnings
  capture <type> <content>  Deliberately capture a learning
  learn <type> <content>    Add a confirmed learning (alias: capture)
  status                    Quick health check (path, version, validity)
  diff                      Show git diff for seed.json
  forget <id>               Remove a learning by ID
  rel <subcommand>          Manage relationships
  stale                     List stale learnings (>90 days)
  refresh <id>              Re-confirm a learning
  redact <id> [reason]      Redact an event from the log
  repair                    Auto-repair from git history
  help                      Show this help

${ansi.bold("Two channels for learning:")}
  ${ansi.dim("Deliberate:")}  pai-seed capture <type> <content>  (you decide what to save)
  ${ansi.dim("Automatic:")}   Post-session extraction via ACR     (AI proposes, you review)

${ansi.bold("Proposals:")} list, accept <id>, reject <id>, review, accept-all, reject-all, clean
${ansi.bold("Learnings:")} list [--type=X], show <id>, search <query>
${ansi.bold("Types:")} pattern, insight, self_knowledge

${ansi.bold("Examples:")}
  pai-seed capture pattern "User prefers concise responses"
  pai-seed proposals list
  pai-seed proposals accept gDo_K4_n
  pai-seed proposals review
  pai-seed learnings list --type=pattern
  pai-seed learnings search "TypeScript"
  pai-seed show`);
}

// =============================================================================
// F-011: Main Dispatcher
// =============================================================================

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help";
  const args = argv.slice(1);

  switch (command) {
    case "show":
      return cmdShow(undefined, args.includes("--json"));
    case "proposals":
      return cmdProposals(args);
    case "learnings":
      return cmdLearnings(args);
    case "status":
      return cmdStatus();
    case "diff":
      return cmdDiff();
    case "learn":
      return cmdLearn(args);
    case "capture":
      return cmdLearn(args, undefined, "captured");
    case "forget":
      return cmdForget(args);
    case "rel":
      return cmdRel(args);
    case "stale":
      return cmdStale();
    case "refresh":
      return cmdRefresh(args);
    case "redact":
      return cmdRedact(args);
    case "repair":
      return cmdRepair();
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(ansi.red(`Unknown command: ${command}`));
      console.error('Run "pai-seed help" for usage.');
      return 1;
  }
}

// Run if executed directly
if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
