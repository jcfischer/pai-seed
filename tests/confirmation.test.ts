import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed, loadSeed } from "../src/loader";
import type { SeedConfig, Proposal } from "../src/schema";
import {
  proposalToLearning,
  addLearningToCategory,
  getPendingProposals,
  acceptProposal,
  rejectProposal,
  acceptAllProposals,
  rejectAllProposals,
  cleanRejected,
  initExtractionStats,
  updateExtractionStats,
} from "../src/confirmation";

// =============================================================================
// Test Helpers
// =============================================================================

/** Initialize a git repo with local-only config (never touches --global). */
async function initTestGitRepo(dir: string): Promise<void> {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await run(["init"]).exited;
  await run(["config", "user.email", "test@test.com"]).exited;
  await run(["config", "user.name", "Test"]).exited;
  await Bun.write(join(dir, ".gitignore"), "*.tmp\n");
  await run(["add", "."]).exited;
  await run(["commit", "-m", "init"]).exited;
}

/** Write a valid seed and commit it so loadSeedWithGit can find it. */
async function writeSeedAndCommit(
  dir: string,
  config?: SeedConfig,
): Promise<string> {
  const seedPath = join(dir, "seed.json");
  const seed = config ?? createDefaultSeed();
  await writeSeed(seed, seedPath);
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await run(["add", "."]).exited;
  await run(["commit", "-m", "seed committed"]).exited;
  return seedPath;
}

/** Create a test proposal with optional overrides. */
function makeProposal(overrides?: Partial<Proposal>): Proposal {
  return {
    id: nanoid(),
    type: "pattern",
    content: "You prefer TypeScript",
    source: "session-123",
    extractedAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

// =============================================================================
// proposalToLearning — Pure function tests (3 tests)
// =============================================================================

describe("proposalToLearning", () => {
  test("converts proposal fields correctly (id, content, source, extractedAt preserved)", () => {
    const proposal = makeProposal({
      id: "prop-abc",
      content: "You prefer explicit error handling",
      source: "session-xyz",
      extractedAt: "2026-01-15T10:00:00.000Z",
    });

    const learning = proposalToLearning(proposal);

    expect(learning.id).toBe("prop-abc");
    expect(learning.content).toBe("You prefer explicit error handling");
    expect(learning.source).toBe("session-xyz");
    expect(learning.extractedAt).toBe("2026-01-15T10:00:00.000Z");
  });

  test("sets confirmed: true and confirmedAt to valid ISO datetime", () => {
    const proposal = makeProposal();
    const before = new Date().toISOString();

    const learning = proposalToLearning(proposal);

    const after = new Date().toISOString();

    expect(learning.confirmed).toBe(true);
    expect(learning.confirmedAt).toBeDefined();
    const confirmedAt = learning.confirmedAt as string;
    // confirmedAt should be between before and after
    expect(confirmedAt >= before).toBe(true);
    expect(confirmedAt <= after).toBe(true);
    // Must be valid ISO
    const parsed = new Date(confirmedAt);
    expect(parsed.toISOString()).toBe(confirmedAt);
  });

  test("sets tags to empty array", () => {
    const proposal = makeProposal();
    const learning = proposalToLearning(proposal);
    expect(learning.tags).toEqual([]);
  });
});

// =============================================================================
// addLearningToCategory — Pure function tests (3 tests)
// =============================================================================

describe("addLearningToCategory", () => {
  test("routes 'pattern' type to learned.patterns", () => {
    const config = createDefaultSeed();
    const proposal = makeProposal({ type: "pattern" });
    const learning = proposalToLearning(proposal);

    addLearningToCategory(config, learning, "pattern");

    expect(config.learned.patterns).toContain(learning);
    expect(config.learned.patterns.length).toBe(1);
    expect(config.learned.insights.length).toBe(0);
    expect(config.learned.selfKnowledge.length).toBe(0);
  });

  test("routes 'insight' type to learned.insights", () => {
    const config = createDefaultSeed();
    const proposal = makeProposal({ type: "insight" });
    const learning = proposalToLearning(proposal);

    addLearningToCategory(config, learning, "insight");

    expect(config.learned.insights).toContain(learning);
    expect(config.learned.insights.length).toBe(1);
    expect(config.learned.patterns.length).toBe(0);
    expect(config.learned.selfKnowledge.length).toBe(0);
  });

  test("routes 'self_knowledge' type to learned.selfKnowledge", () => {
    const config = createDefaultSeed();
    const proposal = makeProposal({ type: "self_knowledge" });
    const learning = proposalToLearning(proposal);

    addLearningToCategory(config, learning, "self_knowledge");

    expect(config.learned.selfKnowledge).toContain(learning);
    expect(config.learned.selfKnowledge.length).toBe(1);
    expect(config.learned.patterns.length).toBe(0);
    expect(config.learned.insights.length).toBe(0);
  });
});

// =============================================================================
// getPendingProposals — I/O tests (4 tests)
// =============================================================================

describe("getPendingProposals", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirm-pending-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("returns pending proposals sorted by extractedAt ascending", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "late", extractedAt: "2026-01-20T10:00:00.000Z" }),
      makeProposal({ id: "early", extractedAt: "2026-01-10T10:00:00.000Z" }),
      makeProposal({ id: "mid", extractedAt: "2026-01-15T10:00:00.000Z" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await getPendingProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(3);
      expect(result.proposals[0].id).toBe("early");
      expect(result.proposals[1].id).toBe("mid");
      expect(result.proposals[2].id).toBe("late");
    }
  });

  test("returns empty array when no proposals exist", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await getPendingProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposals).toEqual([]);
      expect(result.count).toBe(0);
    }
  });

  test("filters out rejected proposals (mixed statuses)", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "pending-1", status: "pending" }),
      makeProposal({ id: "rejected-1", status: "rejected" }),
      makeProposal({ id: "pending-2", status: "pending" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await getPendingProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(2);
      const ids = result.proposals.map((p) => p.id);
      expect(ids).toContain("pending-1");
      expect(ids).toContain("pending-2");
      expect(ids).not.toContain("rejected-1");
    }
  });

  test("handles seed load failure gracefully", async () => {
    const badPath = "/dev/null/impossible/seed.json";
    const result = await getPendingProposals(badPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe("string");
    }
  });
});

// =============================================================================
// acceptProposal — I/O tests (6 tests)
// =============================================================================

describe("acceptProposal", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirm-accept-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("accepts pattern type -> appears in learned.patterns", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    const proposal = makeProposal({ id: "p1", type: "pattern", content: "You prefer functional patterns" });
    seed.state.proposals = [proposal];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptProposal("p1", seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.learning.content).toBe("You prefer functional patterns");
      expect(result.learning.confirmed).toBe(true);
    }

    // Verify it was routed to patterns
    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.learned.patterns.length).toBe(1);
      expect(loadResult.config.learned.patterns[0].content).toBe("You prefer functional patterns");
      // Proposal should be removed
      expect(loadResult.config.state.proposals.length).toBe(0);
    }
  });

  test("accepts insight type -> appears in learned.insights", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    const proposal = makeProposal({ id: "i1", type: "insight", content: "Caching reduces latency significantly" });
    seed.state.proposals = [proposal];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptProposal("i1", seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.learned.insights.length).toBe(1);
      expect(loadResult.config.learned.insights[0].content).toBe("Caching reduces latency significantly");
    }
  });

  test("accepts self_knowledge type -> appears in learned.selfKnowledge", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    const proposal = makeProposal({ id: "sk1", type: "self_knowledge", content: "Always run tests before deploy" });
    seed.state.proposals = [proposal];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptProposal("sk1", seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.learned.selfKnowledge.length).toBe(1);
      expect(loadResult.config.learned.selfKnowledge[0].content).toBe("Always run tests before deploy");
    }
  });

  test("returns error when proposal ID not found", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await acceptProposal("nonexistent-id", seedPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Proposal 'nonexistent-id' not found");
    }
  });

  test("returns error when proposal already rejected", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [makeProposal({ id: "rej1", status: "rejected" })];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptProposal("rej1", seedPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Proposal 'rej1' is already rejected");
    }
  });

  test("creates git commit with correct message format", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [makeProposal({ id: "cm1", content: "You prefer explicit error handling over silent failures" })];
    await writeSeedAndCommit(testDir, seed);

    await acceptProposal("cm1", seedPath);

    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toMatch(/^Confirm: accepted '.{1,50}'$/);
  });
});

// =============================================================================
// rejectProposal — I/O tests (4 tests)
// =============================================================================

describe("rejectProposal", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirm-reject-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("rejects proposal successfully, status changes to 'rejected'", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [makeProposal({ id: "r1", status: "pending" })];
    await writeSeedAndCommit(testDir, seed);

    const result = await rejectProposal("r1", seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const proposal = loadResult.config.state.proposals.find((p) => p.id === "r1");
      expect(proposal).toBeDefined();
      expect(proposal!.status).toBe("rejected");
    }
  });

  test("returns error when proposal ID not found", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await rejectProposal("nonexistent-id", seedPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Proposal 'nonexistent-id' not found");
    }
  });

  test("returns error when proposal already rejected", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [makeProposal({ id: "rej2", status: "rejected" })];
    await writeSeedAndCommit(testDir, seed);

    const result = await rejectProposal("rej2", seedPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Proposal 'rej2' is already rejected");
    }
  });

  test("creates git commit with correct message format", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [makeProposal({ id: "rm1", content: "You prefer short functions that do one thing" })];
    await writeSeedAndCommit(testDir, seed);

    await rejectProposal("rm1", seedPath);

    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toMatch(/^Reject: rejected '.{1,50}'$/);
  });
});

// =============================================================================
// acceptAllProposals — I/O tests (3 tests)
// =============================================================================

describe("acceptAllProposals", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirm-acceptall-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("accepts all pending proposals, each routed to correct category", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "ap1", type: "pattern", content: "You prefer TypeScript" }),
      makeProposal({ id: "ap2", type: "insight", content: "Caching helps performance" }),
      makeProposal({ id: "ap3", type: "self_knowledge", content: "Remember to check tests" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(3);
    }

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.learned.patterns.length).toBe(1);
      expect(loadResult.config.learned.insights.length).toBe(1);
      expect(loadResult.config.learned.selfKnowledge.length).toBe(1);
      // All proposals removed
      expect(loadResult.config.state.proposals.length).toBe(0);
    }
  });

  test("returns count 0 when no pending proposals (no git commit)", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await acceptAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(0);
    }

    // No new commit should have been created
    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toBe("seed committed");
  });

  test("preserves rejected proposals in state (mixed statuses)", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "keep-rej", status: "rejected", content: "Rejected item" }),
      makeProposal({ id: "accept-me", status: "pending", content: "Pending item to accept" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(1);
    }

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      // Rejected proposal should still be in state.proposals
      expect(loadResult.config.state.proposals.length).toBe(1);
      expect(loadResult.config.state.proposals[0].id).toBe("keep-rej");
      expect(loadResult.config.state.proposals[0].status).toBe("rejected");
    }
  });
});

// =============================================================================
// rejectAllProposals — I/O tests (3 tests)
// =============================================================================

describe("rejectAllProposals", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirm-rejectall-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("rejects all pending proposals", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "ra1", status: "pending" }),
      makeProposal({ id: "ra2", status: "pending" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await rejectAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(2);
    }

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      for (const p of loadResult.config.state.proposals) {
        expect(p.status).toBe("rejected");
      }
    }
  });

  test("returns count 0 when no pending proposals (no git commit)", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await rejectAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(0);
    }

    // No new commit
    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toBe("seed committed");
  });

  test("preserves already-rejected proposals unchanged", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "already-rej", status: "rejected", content: "Already rejected" }),
      makeProposal({ id: "to-reject", status: "pending", content: "Pending to reject" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await rejectAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(1); // Only the pending one counts
    }

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.state.proposals.length).toBe(2);
      for (const p of loadResult.config.state.proposals) {
        expect(p.status).toBe("rejected");
      }
    }
  });
});

// =============================================================================
// cleanRejected — I/O tests (4 tests)
// =============================================================================

describe("cleanRejected", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-confirm-clean-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("removes rejected proposals from state", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "rej-clean-1", status: "rejected" }),
      makeProposal({ id: "rej-clean-2", status: "rejected" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await cleanRejected(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(2);
    }

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.state.proposals.length).toBe(0);
    }
  });

  test("returns count 0 when nothing to clean (no git commit)", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await cleanRejected(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(0);
    }

    // No new commit
    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toBe("seed committed");
  });

  test("preserves pending proposals (mixed status filtering)", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "keep-pending", status: "pending", content: "Still pending" }),
      makeProposal({ id: "remove-rej", status: "rejected", content: "Remove me" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await cleanRejected(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(1);
    }

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.state.proposals.length).toBe(1);
      expect(loadResult.config.state.proposals[0].id).toBe("keep-pending");
      expect(loadResult.config.state.proposals[0].status).toBe("pending");
    }
  });

  test("verifies commit message includes correct count", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "c1", status: "rejected" }),
      makeProposal({ id: "c2", status: "rejected" }),
      makeProposal({ id: "c3", status: "rejected" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    await cleanRejected(seedPath);

    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toBe("Cleanup: removed 3 rejected proposals");
  });
});

// =============================================================================
// F-021: initExtractionStats — Pure function tests
// =============================================================================

describe("initExtractionStats", () => {
  test("returns all-zero stats object", () => {
    const stats = initExtractionStats();
    expect(stats.accepted).toBe(0);
    expect(stats.rejected).toBe(0);
    expect(stats.byType.pattern.accepted).toBe(0);
    expect(stats.byType.pattern.rejected).toBe(0);
    expect(stats.byType.insight.accepted).toBe(0);
    expect(stats.byType.insight.rejected).toBe(0);
    expect(stats.byType.self_knowledge.accepted).toBe(0);
    expect(stats.byType.self_knowledge.rejected).toBe(0);
    expect(stats.confidenceSum.accepted).toBe(0);
    expect(stats.confidenceSum.rejected).toBe(0);
    expect(stats.confidenceCount.accepted).toBe(0);
    expect(stats.confidenceCount.rejected).toBe(0);
  });
});

// =============================================================================
// F-021: updateExtractionStats — Pure function tests
// =============================================================================

describe("updateExtractionStats", () => {
  test("increments accepted counters for pattern type", () => {
    const stats = initExtractionStats();
    updateExtractionStats(stats, "pattern", "accepted", 0.85);

    expect(stats.accepted).toBe(1);
    expect(stats.rejected).toBe(0);
    expect(stats.byType.pattern.accepted).toBe(1);
    expect(stats.confidenceSum.accepted).toBe(0.85);
    expect(stats.confidenceCount.accepted).toBe(1);
  });

  test("increments rejected counters for insight type", () => {
    const stats = initExtractionStats();
    updateExtractionStats(stats, "insight", "rejected", 0.55);

    expect(stats.rejected).toBe(1);
    expect(stats.accepted).toBe(0);
    expect(stats.byType.insight.rejected).toBe(1);
    expect(stats.confidenceSum.rejected).toBe(0.55);
    expect(stats.confidenceCount.rejected).toBe(1);
  });

  test("handles missing confidence (no confidence tracking)", () => {
    const stats = initExtractionStats();
    updateExtractionStats(stats, "self_knowledge", "accepted");

    expect(stats.accepted).toBe(1);
    expect(stats.byType.self_knowledge.accepted).toBe(1);
    expect(stats.confidenceSum.accepted).toBe(0);
    expect(stats.confidenceCount.accepted).toBe(0);
  });

  test("accumulates multiple decisions correctly", () => {
    const stats = initExtractionStats();
    updateExtractionStats(stats, "pattern", "accepted", 0.9);
    updateExtractionStats(stats, "pattern", "accepted", 0.8);
    updateExtractionStats(stats, "insight", "rejected", 0.5);

    expect(stats.accepted).toBe(2);
    expect(stats.rejected).toBe(1);
    expect(stats.byType.pattern.accepted).toBe(2);
    expect(stats.byType.insight.rejected).toBe(1);
    expect(stats.confidenceSum.accepted).toBeCloseTo(1.7);
    expect(stats.confidenceCount.accepted).toBe(2);
  });
});

// =============================================================================
// F-021: Stats tracked on accept/reject I/O tests
// =============================================================================

describe("F-021 stats tracking via accept/reject", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-stats-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("acceptProposal increments stats and sets decidedAt", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "s1", type: "pattern", confidence: 0.85 }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptProposal("s1", seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const stats = loadResult.config.state.extractionStats;
      expect(stats).toBeDefined();
      expect(stats!.accepted).toBe(1);
      expect(stats!.rejected).toBe(0);
      expect(stats!.byType.pattern.accepted).toBe(1);
      expect(stats!.confidenceSum.accepted).toBeCloseTo(0.85);
      expect(stats!.confidenceCount.accepted).toBe(1);
    }
  });

  test("rejectProposal increments stats and sets decidedAt", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "s2", type: "insight", confidence: 0.55 }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await rejectProposal("s2", seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const stats = loadResult.config.state.extractionStats;
      expect(stats).toBeDefined();
      expect(stats!.rejected).toBe(1);
      expect(stats!.byType.insight.rejected).toBe(1);
      // decidedAt should be set on the rejected proposal
      const proposal = loadResult.config.state.proposals.find((p) => p.id === "s2");
      expect(proposal?.decidedAt).toBeDefined();
    }
  });

  test("acceptAllProposals increments stats for each", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "ba1", type: "pattern", confidence: 0.9 }),
      makeProposal({ id: "ba2", type: "insight", confidence: 0.8 }),
      makeProposal({ id: "ba3", type: "self_knowledge" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await acceptAllProposals(seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const stats = loadResult.config.state.extractionStats;
      expect(stats).toBeDefined();
      expect(stats!.accepted).toBe(3);
      expect(stats!.byType.pattern.accepted).toBe(1);
      expect(stats!.byType.insight.accepted).toBe(1);
      expect(stats!.byType.self_knowledge.accepted).toBe(1);
      expect(stats!.confidenceCount.accepted).toBe(2); // only 2 had confidence
    }
  });

  test("rejectAllProposals increments stats for each", async () => {
    await initTestGitRepo(testDir);

    const seed = createDefaultSeed();
    seed.state.proposals = [
      makeProposal({ id: "br1", type: "pattern" }),
      makeProposal({ id: "br2", type: "insight" }),
    ];
    await writeSeedAndCommit(testDir, seed);

    const result = await rejectAllProposals(seedPath);
    expect(result.ok).toBe(true);

    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const stats = loadResult.config.state.extractionStats;
      expect(stats).toBeDefined();
      expect(stats!.rejected).toBe(2);
      expect(stats!.byType.pattern.rejected).toBe(1);
      expect(stats!.byType.insight.rejected).toBe(1);
    }
  });
});
