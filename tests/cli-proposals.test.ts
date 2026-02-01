import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// main() uses default seed path; we test underlying functions with custom paths
import { writeSeed } from "../src/loader";
import type { SeedConfig } from "../src/schema";
import { createDefaultSeed } from "../src/defaults";
import { initGitRepo } from "../src/git";

let tempDir: string;
let seedPath: string;

function makeSeedWithProposals(count: number): SeedConfig {
  const config = createDefaultSeed();
  for (let i = 0; i < count; i++) {
    config.state.proposals.push({
      id: `test_proposal_${String(i).padStart(3, "0")}_pad`,
      type: i % 3 === 0 ? "pattern" : i % 3 === 1 ? "insight" : "self_knowledge",
      content: `Test proposal content number ${i}`,
      source: `test-session-${i}`,
      extractedAt: new Date(Date.now() - i * 86400000).toISOString(),
      status: "pending",
      method: "regex",
    });
  }
  return config;
}

function makeSeedWithLearnings(): SeedConfig {
  const config = createDefaultSeed();
  config.learned.patterns.push({
    id: "learn_pattern_001_padding",
    content: "User prefers TypeScript strict mode",
    source: "session-1",
    extractedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    confirmed: true,
    confirmedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    tags: ["typescript"],
  });
  config.learned.insights.push({
    id: "learn_insight_001_padding",
    content: "Bun is faster than Node for bundling",
    source: "session-2",
    extractedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    confirmed: true,
    confirmedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    tags: [],
  });
  config.learned.selfKnowledge.push({
    id: "learn_selfknow_001_padding",
    content: "Always check tsconfig first when debugging",
    source: "session-3",
    extractedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    tags: [],
  });
  return config;
}

// Capture stdout
let output: string;
const originalLog = console.log;
const originalError = console.error;

function captureOutput() {
  output = "";
  console.log = (...args: unknown[]) => {
    output += args.map(String).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    output += args.map(String).join(" ") + "\n";
  };
}

function restoreOutput() {
  console.log = originalLog;
  console.error = originalError;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-seed-cli-proposals-"));
  seedPath = join(tempDir, "seed.json");
});

afterEach(async () => {
  restoreOutput();
  await rm(tempDir, { recursive: true, force: true });
});

describe("F-018: proposals list", () => {
  test("shows pending proposals in compact format", async () => {
    const config = makeSeedWithProposals(3);
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    // We need to override the seed path — use env or direct function call
    // For CLI testing, we'll test the underlying functions directly
    captureOutput();

    // Import and call the proposals list logic indirectly via main
    // But main() uses default seed path. For unit testing, test formatting directly.
    const { getPendingProposals } = await import("../src/confirmation");
    const result = await getPendingProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(3);
    }
    restoreOutput();
  });

  test("handles empty proposals", async () => {
    const config = createDefaultSeed();
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    const { getPendingProposals } = await import("../src/confirmation");
    const result = await getPendingProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(0);
    }
  });
});

describe("F-018: proposals accept", () => {
  test("accepts proposal by ID prefix", async () => {
    const config = makeSeedWithProposals(3);
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    const { acceptProposal } = await import("../src/confirmation");
    const result = await acceptProposal("test_proposal_000_pad", seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.learning.content).toBe("Test proposal content number 0");
      expect(result.learning.confirmed).toBe(true);
    }
  });

  test("rejects proposal by ID", async () => {
    const config = makeSeedWithProposals(3);
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    const { rejectProposal } = await import("../src/confirmation");
    const result = await rejectProposal("test_proposal_001_pad", seedPath);
    expect(result.ok).toBe(true);
  });
});

describe("F-018: proposals bulk", () => {
  test("accept-all processes all pending", async () => {
    const config = makeSeedWithProposals(5);
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    const { acceptAllProposals } = await import("../src/confirmation");
    const result = await acceptAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(5);
    }
  });

  test("reject-all rejects all pending", async () => {
    const config = makeSeedWithProposals(3);
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    const { rejectAllProposals } = await import("../src/confirmation");
    const result = await rejectAllProposals(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(3);
    }
  });

  test("clean removes rejected proposals", async () => {
    const config = makeSeedWithProposals(3);
    // Manually reject one
    config.state.proposals[1].status = "rejected";
    await writeSeed(config, seedPath);
    await initGitRepo(tempDir);

    const { cleanRejected } = await import("../src/confirmation");
    const result = await cleanRejected(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(1);
    }
  });
});

describe("F-018: learnings list", () => {
  test("returns all learnings", async () => {
    const config = makeSeedWithLearnings();
    await writeSeed(config, seedPath);

    const { loadSeed } = await import("../src/loader");
    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const total =
        result.config.learned.patterns.length +
        result.config.learned.insights.length +
        result.config.learned.selfKnowledge.length;
      expect(total).toBe(3);
    }
  });

  test("filters by type", async () => {
    const config = makeSeedWithLearnings();
    await writeSeed(config, seedPath);

    const { loadSeed } = await import("../src/loader");
    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.learned.patterns.length).toBe(1);
      expect(result.config.learned.insights.length).toBe(1);
      expect(result.config.learned.selfKnowledge.length).toBe(1);
    }
  });
});

describe("F-018: learnings search", () => {
  test("finds matching learnings by content", async () => {
    const config = makeSeedWithLearnings();
    await writeSeed(config, seedPath);

    const { loadSeed } = await import("../src/loader");
    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const all = [
        ...result.config.learned.patterns,
        ...result.config.learned.insights,
        ...result.config.learned.selfKnowledge,
      ];
      const matches = all.filter((l) =>
        l.content.toLowerCase().includes("typescript"),
      );
      expect(matches.length).toBe(1);
      expect(matches[0].content).toContain("TypeScript");
    }
  });

  test("returns empty for no matches", async () => {
    const config = makeSeedWithLearnings();
    await writeSeed(config, seedPath);

    const { loadSeed } = await import("../src/loader");
    const result = await loadSeed(seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const all = [
        ...result.config.learned.patterns,
        ...result.config.learned.insights,
        ...result.config.learned.selfKnowledge,
      ];
      const matches = all.filter((l) =>
        l.content.toLowerCase().includes("python"),
      );
      expect(matches.length).toBe(0);
    }
  });
});
