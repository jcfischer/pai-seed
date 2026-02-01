import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed } from "../src/loader";
import type { Learning } from "../src/schema";
import {
  isStale,
  getStaleLearnings,
  getFreshnessStats,
  freshnessScore,
  reconfirmLearning,
  generateReviewPrompt,
} from "../src/freshness";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let seedPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-freshness-test-"));
  seedPath = join(tempDir, "seed.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeLearning(
  id: string,
  content: string,
  daysAgo: number,
): Learning {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    id,
    content,
    source: "test",
    extractedAt: date.toISOString(),
    confirmed: true,
    confirmedAt: date.toISOString(),
    tags: [],
  };
}

const now = new Date();

// =============================================================================
// T-15.1: isStale and getStaleLearnings
// =============================================================================

describe("isStale", () => {
  test("returns true for learning older than cutoff", () => {
    const learning = makeLearning("p1", "old pattern", 100);
    expect(isStale(learning, 90, now)).toBe(true);
  });

  test("returns false for fresh learning", () => {
    const learning = makeLearning("p1", "new pattern", 10);
    expect(isStale(learning, 90, now)).toBe(false);
  });

  test("uses confirmedAt over extractedAt", () => {
    const learning: Learning = {
      id: "p1",
      content: "test",
      source: "test",
      extractedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(), // 200 days ago
      confirmed: true,
      confirmedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), // 10 days ago
      tags: [],
    };
    expect(isStale(learning, 90, now)).toBe(false);
  });

  test("respects custom cutoffDays", () => {
    const learning = makeLearning("p1", "test", 31);
    expect(isStale(learning, 30, now)).toBe(true);
    expect(isStale(learning, 60, now)).toBe(false);
  });
});

describe("getStaleLearnings", () => {
  test("returns stale learnings from all categories", () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "old pattern", 100));
    seed.learned.insights.push(makeLearning("i1", "old insight", 95));
    seed.learned.selfKnowledge.push(makeLearning("sk1", "fresh knowledge", 10));

    const stale = getStaleLearnings(seed, 90, now);
    expect(stale.length).toBe(2);
    expect(stale[0].learning.id).toBe("p1"); // Oldest first
    expect(stale[1].learning.id).toBe("i1");
  });

  test("returns empty for all fresh", () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "new", 5));

    const stale = getStaleLearnings(seed, 90, now);
    expect(stale).toEqual([]);
  });
});

// =============================================================================
// T-15.2: getFreshnessStats
// =============================================================================

describe("getFreshnessStats", () => {
  test("returns correct counts per category", () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(
      makeLearning("p1", "fresh", 10),
      makeLearning("p2", "stale", 100),
    );
    seed.learned.insights.push(makeLearning("i1", "stale", 95));

    const stats = getFreshnessStats(seed, 90, now);
    expect(stats.patterns).toEqual({ fresh: 1, stale: 1, total: 2 });
    expect(stats.insights).toEqual({ fresh: 0, stale: 1, total: 1 });
    expect(stats.selfKnowledge).toEqual({ fresh: 0, stale: 0, total: 0 });
    expect(stats.total).toEqual({ fresh: 1, stale: 2, total: 3 });
  });

  test("handles empty seed", () => {
    const seed = createDefaultSeed();
    const stats = getFreshnessStats(seed, 90, now);
    expect(stats.total).toEqual({ fresh: 0, stale: 0, total: 0 });
  });
});

// =============================================================================
// T-15.3: freshnessScore
// =============================================================================

describe("freshnessScore", () => {
  test("returns 1.0 for just-confirmed learning", () => {
    const learning = makeLearning("p1", "test", 0);
    const score = freshnessScore(learning, 90, now);
    expect(score).toBeCloseTo(1.0, 1);
  });

  test("returns ~0.5 for learning at half the cutoff", () => {
    const learning = makeLearning("p1", "test", 45);
    const score = freshnessScore(learning, 90, now);
    expect(score).toBeCloseTo(0.5, 1);
  });

  test("returns 0.0 for learning past cutoff", () => {
    const learning = makeLearning("p1", "test", 100);
    const score = freshnessScore(learning, 90, now);
    expect(score).toBe(0);
  });

  test("clamps to 0.0 minimum", () => {
    const learning = makeLearning("p1", "test", 500);
    const score = freshnessScore(learning, 90, now);
    expect(score).toBe(0);
  });
});

// =============================================================================
// T-15.4: reconfirmLearning
// =============================================================================

describe("reconfirmLearning", () => {
  test("updates confirmedAt to now", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "test pattern", 100));
    await writeSeed(seed, seedPath);

    const result = await reconfirmLearning("p1", seedPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // confirmedAt should be recent (within last few seconds)
    const confirmDate = new Date(result.learning.confirmedAt!);
    const diff = Date.now() - confirmDate.getTime();
    expect(diff).toBeLessThan(5000);
  });

  test("returns error for unknown ID", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const result = await reconfirmLearning("nonexistent", seedPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });

  test("saves updated seed to disk", async () => {
    const seed = createDefaultSeed();
    seed.learned.insights.push(makeLearning("i1", "test insight", 100));
    await writeSeed(seed, seedPath);

    await reconfirmLearning("i1", seedPath);

    // Reload and verify
    const { loadSeed } = await import("../src/loader");
    const loaded = await loadSeed(seedPath);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const insight = loaded.config.learned.insights.find((l) => l.id === "i1");
    expect(insight).toBeDefined();
    const confirmDate = new Date(insight!.confirmedAt!);
    const diff = Date.now() - confirmDate.getTime();
    expect(diff).toBeLessThan(5000);
  });
});

// =============================================================================
// T-15.5: generateReviewPrompt
// =============================================================================

describe("generateReviewPrompt", () => {
  test("returns null when no stale learnings", () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "fresh", 10));

    const prompt = generateReviewPrompt(seed, 90, now);
    expect(prompt).toBeNull();
  });

  test("returns formatted prompt with stale learnings", () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "old pattern", 100));

    const prompt = generateReviewPrompt(seed, 90, now);
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("Identity Review");
    expect(prompt).toContain("old pattern");
    expect(prompt).toContain("p1");
    expect(prompt).toContain("pai-seed refresh");
  });

  test("groups by category", () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "stale pattern", 100));
    seed.learned.insights.push(makeLearning("i1", "stale insight", 95));

    const prompt = generateReviewPrompt(seed, 90, now);
    expect(prompt).toContain("Patterns:");
    expect(prompt).toContain("Insights:");
  });
});

// =============================================================================
// T-15.7: Exports
// =============================================================================

describe("exports", () => {
  test("all exports importable from index", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.isStale).toBe("function");
    expect(typeof mod.getStaleLearnings).toBe("function");
    expect(typeof mod.getFreshnessStats).toBe("function");
    expect(typeof mod.freshnessScore).toBe("function");
    expect(typeof mod.reconfirmLearning).toBe("function");
    expect(typeof mod.generateReviewPrompt).toBe("function");
  });
});
