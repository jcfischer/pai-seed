import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed } from "../src/loader";
import type { Learning, Proposal, IdentityLayer, LearnedLayer, StateLayer, ExtractionStats } from "../src/schema";
import {
  formatIdentitySummary,
  formatLearningSummary,
  formatProposals,
  formatSessionState,
  generateSessionContext,
  sessionStartHook,
} from "../src/session";
import { computeExtractionHealth } from "../src/cli";
import { initExtractionStats } from "../src/confirmation";
// ContextMode type used indirectly via SessionContextOptions

// =============================================================================
// Test Helpers
// =============================================================================

function makeLearning(content: string, confirmed: boolean): Learning {
  return {
    id: `learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    content,
    source: "test-session",
    extractedAt: new Date().toISOString(),
    confirmedAt: confirmed ? new Date().toISOString() : undefined,
    confirmed,
    tags: [],
  };
}

function makeProposal(
  content: string,
  status: "pending" | "accepted" | "rejected",
): Proposal {
  return {
    id: `prop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "pattern",
    content,
    source: "test-session",
    extractedAt: new Date().toISOString(),
    status,
  };
}

/** Initialize a git repo with local-only config (never touches --global). */
async function initTestGitRepo(dir: string): Promise<void> {
  const init = Bun.spawn(["git", "init"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await init.exited;
  const email = Bun.spawn(
    ["git", "config", "user.email", "test@pai-seed.local"],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  await email.exited;
  const name = Bun.spawn(
    ["git", "config", "user.name", "pai-seed-test"],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  await name.exited;
}

// =============================================================================
// Temp directory management (for I/O tests)
// =============================================================================

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-session-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// =============================================================================
// formatIdentitySummary
// =============================================================================

describe("formatIdentitySummary", () => {
  test("custom identity values formatted correctly", () => {
    const identity: IdentityLayer = {
      principalName: "Jens-Christian",
      aiName: "Nova",
      catchphrase: "Nova online.",
      voiceId: "voice-123",
      preferences: {
        responseStyle: "concise",
        timezone: "Europe/Zurich",
        locale: "de-CH",
      },
    };

    const result = formatIdentitySummary(identity);

    expect(result).toContain("Nova");
    expect(result).toContain("Jens-Christian");
    expect(result).toContain("Nova online.");
    expect(result).toContain("concise");
    expect(result).toContain("Europe/Zurich");
    expect(result).toContain("de-CH");
  });

  test("default identity values formatted with defaults", () => {
    const identity: IdentityLayer = {
      principalName: "User",
      aiName: "PAI",
      catchphrase: "PAI here, ready to go.",
      voiceId: "default",
      preferences: {
        responseStyle: "adaptive",
        timezone: "UTC",
        locale: "en-US",
      },
    };

    const result = formatIdentitySummary(identity);

    expect(result).toContain("PAI");
    expect(result).toContain("User");
    expect(result).toContain("PAI here, ready to go.");
    expect(result).toContain("adaptive");
    expect(result).toContain("UTC");
    expect(result).toContain("en-US");
  });
});

// =============================================================================
// formatLearningSummary
// =============================================================================

describe("formatLearningSummary", () => {
  test("populated learnings shows counts and confirmed items", () => {
    const learned: LearnedLayer = {
      patterns: [
        makeLearning("Use TDD always", true),
        makeLearning("Prefer bun over npm", true),
      ],
      insights: [makeLearning("User prefers concise answers", true)],
      selfKnowledge: [makeLearning("I tend to over-explain", false)],
    };

    const result = formatLearningSummary(learned);

    expect(result).toContain("2 patterns");
    expect(result).toContain("1 insight");
    expect(result).toContain("1 self-knowledge");
    expect(result).toContain("Use TDD always");
    expect(result).toContain("Prefer bun over npm");
    expect(result).toContain("User prefers concise answers");
  });

  test("empty learnings returns empty string", () => {
    const learned: LearnedLayer = {
      patterns: [],
      insights: [],
      selfKnowledge: [],
    };

    const result = formatLearningSummary(learned);

    expect(result).toBe("");
  });

  test("more than 5 confirmed items shows truncation", () => {
    const learned: LearnedLayer = {
      patterns: [
        makeLearning("Pattern 1", true),
        makeLearning("Pattern 2", true),
        makeLearning("Pattern 3", true),
        makeLearning("Pattern 4", true),
        makeLearning("Pattern 5", true),
        makeLearning("Pattern 6", true),
        makeLearning("Pattern 7", true),
      ],
      insights: [],
      selfKnowledge: [],
    };

    const result = formatLearningSummary(learned);

    expect(result).toContain("7 patterns");
    // Should show first 5 and truncation message
    expect(result).toContain("Pattern 1");
    expect(result).toContain("Pattern 5");
    expect(result).toContain("... and 2 more");
  });

  test("mix of confirmed/unconfirmed: all counted, only confirmed in detail", () => {
    const learned: LearnedLayer = {
      patterns: [
        makeLearning("Confirmed pattern", true),
        makeLearning("Unconfirmed pattern", false),
        makeLearning("Another confirmed", true),
      ],
      insights: [],
      selfKnowledge: [],
    };

    const result = formatLearningSummary(learned);

    // Summary counts ALL items
    expect(result).toContain("3 patterns");
    // Detail lists only confirmed
    expect(result).toContain("Confirmed pattern");
    expect(result).toContain("Another confirmed");
    expect(result).not.toContain("Unconfirmed pattern");
  });
});

// =============================================================================
// formatProposals
// =============================================================================

describe("formatProposals", () => {
  test("pending proposals formatted as numbered list", () => {
    const proposals: Proposal[] = [
      makeProposal("Always use TypeScript", "pending"),
      makeProposal("Prefer functional style", "pending"),
    ];

    const result = formatProposals(proposals);

    expect(result).toContain("Pending proposals (2)");
    expect(result).toContain('1. [pattern] "Always use TypeScript"');
    expect(result).toContain('2. [pattern] "Prefer functional style"');
    expect(result).toContain("test-session");
  });

  test("empty array returns empty string", () => {
    const result = formatProposals([]);

    expect(result).toBe("");
  });

  test("mixed statuses: only pending proposals shown", () => {
    const proposals: Proposal[] = [
      makeProposal("Accepted one", "accepted"),
      makeProposal("Pending one", "pending"),
      makeProposal("Rejected one", "rejected"),
    ];

    const result = formatProposals(proposals);

    expect(result).toContain("Pending proposals (1)");
    expect(result).toContain("Pending one");
    expect(result).not.toContain("Accepted one");
    expect(result).not.toContain("Rejected one");
  });

  test("single pending proposal has correct format", () => {
    const proposals: Proposal[] = [
      makeProposal("Single proposal content", "pending"),
    ];

    const result = formatProposals(proposals);

    expect(result).toContain("Pending proposals (1)");
    expect(result).toContain('1. [pattern] "Single proposal content" (from test-session)');
  });

  // F-019: Cap at 5 with recency sort
  test("3 proposals: all shown, no footer", () => {
    const proposals = Array.from({ length: 3 }, (_, i) =>
      makeProposal(`Proposal ${i + 1}`, "pending"),
    );
    const result = formatProposals(proposals);
    expect(result).toContain("Pending proposals (3)");
    expect(result).toContain("Proposal 1");
    expect(result).toContain("Proposal 3");
    expect(result).not.toContain("more pending");
  });

  test("5 proposals: all shown, no footer", () => {
    const proposals = Array.from({ length: 5 }, (_, i) =>
      makeProposal(`Proposal ${i + 1}`, "pending"),
    );
    const result = formatProposals(proposals);
    expect(result).toContain("Pending proposals (5)");
    expect(result).not.toContain("more pending");
  });

  test("6 proposals: 5 shown + footer", () => {
    const proposals = Array.from({ length: 6 }, (_, i) =>
      makeProposal(`Proposal ${i + 1}`, "pending"),
    );
    const result = formatProposals(proposals);
    expect(result).toContain("Pending proposals (6)");
    expect(result).toContain("... and 1 more pending");
    expect(result).toContain("pai-seed proposals review");
    // Count numbered items (lines starting with digits after spaces)
    const numbered = result.split("\n").filter((l) => /^\s+\d+\./.test(l));
    expect(numbered.length).toBe(5);
  });

  test("48 proposals: 5 shown + footer with 43 remaining", () => {
    const proposals = Array.from({ length: 48 }, (_, i) =>
      makeProposal(`Proposal ${i + 1}`, "pending"),
    );
    const result = formatProposals(proposals);
    expect(result).toContain("Pending proposals (48)");
    expect(result).toContain("... and 43 more pending");
    expect(result).toContain("pai-seed proposals review");
  });

  test("proposals sorted by recency (most recent first)", () => {
    const proposals: Proposal[] = [
      {
        id: "old",
        type: "pattern",
        content: "Old proposal",
        source: "old-session",
        extractedAt: "2026-01-01T00:00:00.000Z",
        status: "pending",
      },
      {
        id: "new",
        type: "insight",
        content: "New proposal",
        source: "new-session",
        extractedAt: "2026-02-01T00:00:00.000Z",
        status: "pending",
      },
      {
        id: "mid",
        type: "self_knowledge",
        content: "Mid proposal",
        source: "mid-session",
        extractedAt: "2026-01-15T00:00:00.000Z",
        status: "pending",
      },
    ];
    const result = formatProposals(proposals);
    const lines = result.split("\n").filter((l) => /^\s+\d+\./.test(l));
    // Most recent first
    expect(lines[0]).toContain("New proposal");
    expect(lines[1]).toContain("Mid proposal");
    expect(lines[2]).toContain("Old proposal");
  });

  test("header shows total count not shown count", () => {
    const proposals = Array.from({ length: 10 }, (_, i) =>
      makeProposal(`P${i}`, "pending"),
    );
    const result = formatProposals(proposals);
    expect(result).toContain("Pending proposals (10):");
  });

  // F-020: Review suggestion
  test("includes review suggestion when proposals pending", () => {
    const proposals = [makeProposal("Test proposal", "pending")];
    const result = formatProposals(proposals);
    expect(result).toContain("Suggestion:");
    expect(result).toContain("pai-seed proposals review");
  });

  test("no review suggestion when no proposals", () => {
    const result = formatProposals([]);
    expect(result).toBe("");
    expect(result).not.toContain("Suggestion:");
  });
});

// =============================================================================
// formatSessionState
// =============================================================================

describe("formatSessionState", () => {
  test("full state shows timestamp, projects, and checkpoint", () => {
    const state: StateLayer = {
      lastSessionId: "sess-123",
      lastSessionAt: "2026-01-30T10:00:00.000Z",
      proposals: [],
      activeProjects: ["pai-seed", "reporter", "ragent"],
      checkpointRef: "abc123def",
    };

    const result = formatSessionState(state);

    expect(result).toContain("Last session: 2026-01-30T10:00:00.000Z");
    expect(result).toContain("Active projects: pai-seed, reporter, ragent");
    expect(result).toContain("Checkpoint: abc123def");
  });

  test("empty state shows never and none, no checkpoint line", () => {
    const state: StateLayer = {
      proposals: [],
      activeProjects: [],
    };

    const result = formatSessionState(state);

    expect(result).toContain("Last session: never");
    expect(result).toContain("Active projects: none");
    expect(result).not.toContain("Checkpoint");
  });

  test("state with projects but no checkpoint omits checkpoint line", () => {
    const state: StateLayer = {
      lastSessionAt: "2026-01-29T08:00:00.000Z",
      proposals: [],
      activeProjects: ["pai-seed"],
    };

    const result = formatSessionState(state);

    expect(result).toContain("Last session: 2026-01-29T08:00:00.000Z");
    expect(result).toContain("Active projects: pai-seed");
    expect(result).not.toContain("Checkpoint");
  });
});

// =============================================================================
// generateSessionContext
// =============================================================================

describe("generateSessionContext", () => {
  test("normal seed returns formatted context with all sections", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    seed.learned.patterns = [makeLearning("Test pattern", true)];
    seed.state.proposals = [makeProposal("Test proposal", "pending")];
    seed.state.activeProjects = ["pai-seed"];
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath, { mode: "full" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsSetup).toBe(false);
      expect(result.config).not.toBeNull();
      expect(result.context).toContain("Nova");
      expect(result.context).toContain("Jens-Christian");
      expect(result.context).toContain("Test pattern");
      expect(result.context).toContain("Test proposal");
      expect(result.context).toContain("pai-seed");
    }
  });

  test("first run (no file) returns needsSetup: true", async () => {
    const seedPath = join(testDir, "nonexistent", "seed.json");

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsSetup).toBe(true);
    }
  });

  test("first run (default principalName 'User') returns needsSetup: true", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const defaultSeed = createDefaultSeed();
    await writeSeed(defaultSeed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsSetup).toBe(true);
    }
  });

  test("empty learnings: context omits learnings section", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    // learned is already empty by default
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsSetup).toBe(false);
      expect(result.context).not.toContain("Learnings:");
    }
  });

  test("no pending proposals: context omits proposals section", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    seed.state.proposals = [makeProposal("Old one", "accepted")];
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context).not.toContain("Pending proposals");
    }
  });

  test("proposalCount matches actual pending count", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    seed.state.proposals = [
      makeProposal("Pending 1", "pending"),
      makeProposal("Pending 2", "pending"),
      makeProposal("Accepted", "accepted"),
    ];
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposalCount).toBe(2);
    }
  });

  test("performance: completes in under 500ms", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    await writeSeed(seed, seedPath);

    const start = performance.now();
    await generateSessionContext(seedPath);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  test("full mode: context includes identity", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath, { mode: "full" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context).toContain("Identity:");
      expect(result.context).toContain("Nova");
      expect(result.context).toContain("Jens-Christian");
    }
  });

  test("complement mode: context excludes identity but includes state", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    seed.learned.patterns = [makeLearning("A real pattern", true)];
    seed.state.activeProjects = ["pai-seed"];
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath, {
      mode: "complement",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context).not.toContain("Identity:");
      expect(result.context).toContain("A real pattern");
      expect(result.context).toContain("pai-seed");
    }
  });

  test("context starts with Seed version line", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.startsWith("Seed: v")).toBe(true);
    }
  });
});

// =============================================================================
// sessionStartHook
// =============================================================================

describe("sessionStartHook", () => {
  test("normal seed returns non-empty string", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    await writeSeed(seed, seedPath);

    const result = await sessionStartHook(seedPath);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Seed: v");
  });

  test("first run returns setup message", async () => {
    const seedPath = join(testDir, "nonexistent", "seed.json");

    const result = await sessionStartHook(seedPath);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should indicate setup is needed, not an error
    expect(result).not.toContain("error");
  });

  test("never throws on any input", async () => {
    let didThrow = false;

    try {
      // Invalid path that will fail loading
      await sessionStartHook("/nonexistent/deeply/nested/impossible/seed.json");
    } catch {
      didThrow = true;
    }

    expect(didThrow).toBe(false);

    // Also test with undefined
    didThrow = false;
    try {
      // This will try the default path - should not throw regardless
      await sessionStartHook(join(testDir, "also-nonexistent", "seed.json"));
    } catch {
      didThrow = true;
    }

    expect(didThrow).toBe(false);
  });
});

// =============================================================================
// F-021: computeExtractionHealth — Pure function tests
// =============================================================================

describe("computeExtractionHealth", () => {
  function makeConfigWithStats(stats: ExtractionStats, pendingCount = 0) {
    const config = createDefaultSeed();
    config.state.extractionStats = stats;
    for (let i = 0; i < pendingCount; i++) {
      config.state.proposals.push({
        id: `p${i}`,
        type: "pattern",
        content: `proposal ${i}`,
        source: "test",
        extractedAt: new Date().toISOString(),
        status: "pending",
      });
    }
    return config;
  }

  test("returns null when no extractionStats", () => {
    const config = createDefaultSeed();
    expect(computeExtractionHealth(config)).toBeNull();
  });

  test("returns null when zero decisions", () => {
    const config = makeConfigWithStats(initExtractionStats());
    expect(computeExtractionHealth(config)).toBeNull();
  });

  test("shows acceptance rate and counts", () => {
    const stats = initExtractionStats();
    stats.accepted = 5;
    stats.rejected = 3;
    const config = makeConfigWithStats(stats, 40);

    const health = computeExtractionHealth(config)!;
    expect(health).toContain("48 total");
    expect(health).toContain("5 accepted");
    expect(health).toContain("3 rejected");
    expect(health).toContain("40 pending");
    expect(health).toContain("62.5%");
    expect(health).toContain("5/8 decided");
  });

  test("shows per-type breakdown when types have decisions", () => {
    const stats = initExtractionStats();
    stats.accepted = 3;
    stats.rejected = 1;
    stats.byType.pattern = { accepted: 2, rejected: 1 };
    stats.byType.insight = { accepted: 1, rejected: 0 };
    const config = makeConfigWithStats(stats);

    const health = computeExtractionHealth(config)!;
    expect(health).toContain("patterns 2/3 (67%)");
    expect(health).toContain("insights 1/1 (100%)");
  });

  test("shows average confidence when available", () => {
    const stats = initExtractionStats();
    stats.accepted = 2;
    stats.rejected = 1;
    stats.confidenceSum = { accepted: 1.6, rejected: 0.5 };
    stats.confidenceCount = { accepted: 2, rejected: 1 };
    const config = makeConfigWithStats(stats);

    const health = computeExtractionHealth(config)!;
    expect(health).toContain("accepted=0.80");
    expect(health).toContain("rejected=0.50");
  });

  test("shows 'need more decisions' when below threshold", () => {
    const stats = initExtractionStats();
    stats.accepted = 3;
    stats.rejected = 2;
    const config = makeConfigWithStats(stats);

    const health = computeExtractionHealth(config)!;
    expect(health).toContain("Need 10+ decisions");
    expect(health).toContain("5 so far");
    expect(health).not.toContain("Warning:");
  });

  test("alerts when acceptance rate >90% with 10+ decisions", () => {
    const stats = initExtractionStats();
    stats.accepted = 19;
    stats.rejected = 1;
    const config = makeConfigWithStats(stats);

    const health = computeExtractionHealth(config)!;
    expect(health).toContain("Warning:");
    expect(health).toContain("filter may be too loose");
  });

  test("alerts when acceptance rate <10% with 10+ decisions", () => {
    const stats = initExtractionStats();
    stats.accepted = 0;
    stats.rejected = 15;
    const config = makeConfigWithStats(stats);

    const health = computeExtractionHealth(config)!;
    expect(health).toContain("Warning:");
    expect(health).toContain("mostly noise");
  });

  test("no alert when rate is between 10-90% with 10+ decisions", () => {
    const stats = initExtractionStats();
    stats.accepted = 6;
    stats.rejected = 4;
    const config = makeConfigWithStats(stats);

    const health = computeExtractionHealth(config)!;
    expect(health).not.toContain("Warning:");
    expect(health).not.toContain("Need 10+ decisions");
  });
});

// =============================================================================
// F-022: Progressive Disclosure — formatRelevantLearnings
// =============================================================================

describe("F-022: formatRelevantLearnings", () => {
  // Import will be added to session.ts
  const { formatRelevantLearnings } = require("../src/session");

  test("T-22.3: returns empty string when no learnings exist", async () => {
    const config = createDefaultSeed();
    // learned layer is already empty by default

    const result = await formatRelevantLearnings(config, { project: "test", cwd: "/test" });

    expect(result).toBe("");
  });

  test("T-22.1: returns learnings with recency fallback when no embeddings", async () => {
    const config = createDefaultSeed();
    config.learned.patterns = [
      makeLearning("Prefers explicit error handling", true),
      makeLearning("Uses Zod for all schema validation", true),
      makeLearning("Tests use temp dirs", true),
    ];
    // Total: 3 learnings

    // Without embeddings, retrieval falls back to recency (score=0)
    const result = await formatRelevantLearnings(config, { project: "test", cwd: "/test" });

    expect(result).toContain("Recent learnings (");
    expect(result).toContain("/3):");
    // Recency fallback: no scores shown
    expect(result).not.toMatch(/\[0\.\d{2}\]/);
    expect(result).toContain("- pattern:");
    expect(result).toContain("Prefers explicit error handling");
  });

  test("T-22.2: truncates to maxResults when many learnings exist", async () => {
    const config = createDefaultSeed();
    config.learned.patterns = Array.from({ length: 15 }, (_, i) =>
      makeLearning(`Pattern ${i + 1}`, true)
    );
    // Total: 15 learnings

    const result = await formatRelevantLearnings(config, { project: "test", cwd: "/test" });

    expect(result).toContain("Recent learnings (5/15):"); // maxResults=5
    // Should show exactly 5 items
    const lines = result.split("\n").filter((l: string) => l.startsWith("  -"));
    expect(lines.length).toBe(5);
  });
});

// =============================================================================
// F-022: Progressive Disclosure — formatCompactProposals
// =============================================================================

describe("F-022: formatCompactProposals", () => {
  // Will replace formatProposals
  const { formatCompactProposals } = require("../src/session");

  test("T-22.5: returns empty string when no proposals exist", () => {
    const result = formatCompactProposals([]);
    expect(result).toBe("");
  });

  test("T-22.4: returns compact index format with ID, type, truncated content, confidence", () => {
    const proposals: Proposal[] = [
      {
        id: "abc123456789",
        type: "pattern",
        content: "Short content",
        source: "test",
        extractedAt: new Date().toISOString(),
        status: "pending",
        confidence: 0.82,
      },
      {
        id: "def789012345",
        type: "insight",
        content: "Medium length content here",
        source: "test",
        extractedAt: new Date().toISOString(),
        status: "pending",
        confidence: 0.71,
      },
      {
        id: "ghi345678901",
        type: "pattern",
        content: "Very long content that exceeds forty characters and needs truncation",
        source: "test",
        extractedAt: new Date().toISOString(),
        status: "pending",
        confidence: 0.95,
      },
    ];

    const result = formatCompactProposals(proposals);

    expect(result).toContain("Pending proposals (3):");
    // Check ID truncation (5 chars)
    expect(result).toContain("abc12");
    expect(result).toContain("def78");
    expect(result).toContain("ghi34");
    // Check type badge
    expect(result).toContain("pattern");
    expect(result).toContain("insight");
    // Check confidence with 2 decimals
    expect(result).toContain("(0.82)");
    expect(result).toContain("(0.71)");
    expect(result).toContain("(0.95)");
    // Check truncation with ellipsis (truncated at 40 chars)
    expect(result).toMatch(/Very long content that exceeds forty cha \.\.\./);  // "forty cha" are chars 35-43
    // Check footer
    expect(result).toContain("Review: `pai-seed proposals review`");
  });

  test("T-22.6: shows N/A for undefined confidence", () => {
    const proposals: Proposal[] = [
      {
        id: "test12345",
        type: "pattern",
        content: "Test",
        source: "test",
        extractedAt: new Date().toISOString(),
        status: "pending",
        // confidence is undefined
      },
    ];

    const result = formatCompactProposals(proposals);

    expect(result).toContain("(N/A)");
    expect(result).not.toContain("undefined");
  });
});

// =============================================================================
// F-022: Progressive Disclosure — generateSessionContext integration
// =============================================================================

describe("F-022: generateSessionContext with progressive disclosure", () => {
  test("T-22.7: includes metadata fields (learningsShown, learningsTotal, tokenEstimate)", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    seed.learned.patterns = Array.from({ length: 15 }, (_, i) =>
      makeLearning(`Pattern ${i + 1}`, true)
    );
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.learningsShown).toBeDefined();
      expect(result.learningsTotal).toBe(15);
      expect(result.tokenEstimate).toBeGreaterThan(0);
    }
  });

  test("T-22.8: handles empty seed with zero metadata", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    // No learnings, no proposals
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.learningsShown).toBe(0);
      expect(result.learningsTotal).toBe(0);
      expect(result.tokenEstimate).toBeGreaterThan(0); // Still has version + state
      expect(result.context).toContain("Seed: v"); // Version always present
    }
  });

  test("T-22.9: produces progressive disclosure format (no old format)", async () => {
    const seedPath = join(testDir, "seed.json");
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.identity.principalName = "Jens-Christian";
    seed.identity.aiName = "Nova";
    seed.identity.catchphrase = "Nova online.";
    seed.learned.patterns = Array.from({ length: 15 }, (_, i) =>
      makeLearning(`Pattern ${i + 1}`, true)
    );
    seed.state.proposals = [
      {
        id: "abc123456",
        type: "pattern",
        content: "Test proposal",
        source: "test",
        extractedAt: new Date().toISOString(),
        status: "pending",
        confidence: 0.75,
      },
    ];
    await writeSeed(seed, seedPath);

    const result = await generateSessionContext(seedPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should use new format
      expect(result.context).toMatch(/(?:Relevant|Recent) learnings \(\d+\/\d+\):/);
      // Should NOT use old format
      expect(result.context).not.toContain("Learnings: "); // old summary line
      expect(result.context).not.toMatch(/\d+ pattern\w*, \d+ insight/); // old count format
      // Proposals should be compact
      expect(result.context).toContain("abc12"); // 5-char ID
      expect(result.context).toContain("(0.75)"); // confidence
    }
  });
});
