#!/usr/bin/env bun

import { loadSeed, resolveSeedPath } from "./loader";
import { formatIdentitySummary } from "./session";
import { isGitRepo, repairFromGit, writeSeedWithCommit, hasUncommittedChanges } from "./git";
import { validateSeed } from "./validate";
import { nanoid } from "nanoid";
import type { Learning } from "./schema";
import {
  addRelationship,
  loadRelationship,
  listRelationships,
  addKeyMoment,
} from "./relationships";
import { redactEvent } from "./redaction";

// =============================================================================
// F-011: ANSI Helpers
// =============================================================================

const isTTY = process.stdout.isTTY ?? false;

const ansi = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

// =============================================================================
// F-011: Command Handlers
// =============================================================================

async function cmdShow(seedPath?: string): Promise<number> {
  const result = await loadSeed(seedPath);
  if (!result.ok) {
    console.error(ansi.red(`Error: ${result.error.message}`));
    return 1;
  }

  const { config } = result;

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

async function cmdLearn(args: string[], seedPath?: string): Promise<number> {
  if (args.length < 2) {
    console.error(ansi.red("Usage: pai-seed learn <type> <content...>"));
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
    `Learn: added ${type} via CLI`,
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
// F-011: Help Text
// =============================================================================

function printHelp(): void {
  console.log(`${ansi.bold("pai-seed")} — CLI for seed.json management

${ansi.bold("Usage:")}
  pai-seed <command> [args...]

${ansi.bold("Commands:")}
  show                      Show seed configuration summary
  status                    Quick health check (path, version, validity)
  diff                      Show git diff for seed.json
  learn <type> <content>    Add a confirmed learning
  forget <id>               Remove a learning by ID
  rel <subcommand>          Manage relationships
  redact <id> [reason]      Redact an event from the log
  repair                    Auto-repair from git history
  help                      Show this help

${ansi.bold("Types for learn:")}
  pattern, insight, self_knowledge

${ansi.bold("Rel subcommands:")}
  list, show <name>, add <name> [context], moment <name> <desc>

${ansi.bold("Examples:")}
  pai-seed show
  pai-seed learn pattern "User prefers concise responses"
  pai-seed forget abc123
  pai-seed rel add Alice "Colleague from project X"
  pai-seed rel moment Alice "Helped with deployment"
  pai-seed diff
  pai-seed repair`);
}

// =============================================================================
// F-011: Main Dispatcher
// =============================================================================

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help";
  const args = argv.slice(1);

  switch (command) {
    case "show":
      return cmdShow();
    case "status":
      return cmdStatus();
    case "diff":
      return cmdDiff();
    case "learn":
      return cmdLearn(args);
    case "forget":
      return cmdForget(args);
    case "rel":
      return cmdRel(args);
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
