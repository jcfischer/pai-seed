import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acrDocumentSchema,
  exportLearnings,
  exportEventSummaries,
  exportAllForACR,
} from "../src/acr";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed } from "../src/loader";
import { logEvent } from "../src/events";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let seedPath: string;
let eventsDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-acr-test-"));
  seedPath = join(tempDir, "seed.json");
  eventsDir = join(tempDir, "events");

  const { mkdir } = await import("node:fs/promises");
  await mkdir(eventsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const opts = () => ({ seedPath, eventsDir });

function makeLearning(id: string, content: string) {
  return {
    id,
    content,
    source: "test",
    extractedAt: new Date().toISOString(),
    confirmed: true,
    confirmedAt: new Date().toISOString(),
    tags: ["test-tag"],
  };
}

// =============================================================================
// T-12.1: ACR Document Schema
// =============================================================================

describe("acrDocumentSchema", () => {
  test("validates correct document", () => {
    const doc = {
      sourceId: "seed:learning:abc",
      content: "Pattern: user prefers concise responses",
      source: "seed",
      lastUpdated: new Date().toISOString(),
      metadata: { type: "pattern" },
    };
    const result = acrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  test("rejects missing fields", () => {
    const doc = { sourceId: "test" };
    const result = acrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// T-12.2: exportLearnings
// =============================================================================

describe("exportLearnings", () => {
  test("exports patterns with correct sourceId format", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "User prefers lists"));
    await writeSeed(seed, seedPath);

    const docs = await exportLearnings(opts());
    expect(docs.length).toBe(1);
    expect(docs[0].sourceId).toBe("seed:learning:p1");
    expect(docs[0].source).toBe("seed");
  });

  test("exports insights and selfKnowledge", async () => {
    const seed = createDefaultSeed();
    seed.learned.insights.push(makeLearning("i1", "Concise is better"));
    seed.learned.selfKnowledge.push(makeLearning("sk1", "I learn faster with examples"));
    await writeSeed(seed, seedPath);

    const docs = await exportLearnings(opts());
    expect(docs.length).toBe(2);
    expect(docs[0].sourceId).toBe("seed:learning:i1");
    expect(docs[1].sourceId).toBe("seed:learning:sk1");
  });

  test("returns empty array for no learnings", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const docs = await exportLearnings(opts());
    expect(docs).toEqual([]);
  });

  test("content includes type prefix", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "Use bullet points"));
    seed.learned.insights.push(makeLearning("i1", "Short answers work"));
    seed.learned.selfKnowledge.push(makeLearning("sk1", "I need context"));
    await writeSeed(seed, seedPath);

    const docs = await exportLearnings(opts());
    expect(docs[0].content).toBe("Pattern: Use bullet points");
    expect(docs[1].content).toBe("Insight: Short answers work");
    expect(docs[2].content).toBe("Self-knowledge: I need context");
  });

  test("metadata includes correct fields", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "Test"));
    await writeSeed(seed, seedPath);

    const docs = await exportLearnings(opts());
    expect(docs[0].metadata.type).toBe("pattern");
    expect(docs[0].metadata.confirmed).toBe(true);
    expect(docs[0].metadata.tags).toEqual(["test-tag"]);
  });
});

// =============================================================================
// T-12.3: exportEventSummaries
// =============================================================================

describe("exportEventSummaries", () => {
  test("exports event summaries for date range", async () => {
    // Write a few events
    await logEvent("session_start", { action: "begin" }, "sess-1", eventsDir);
    await logEvent("skill_invoked", { skill: "test" }, "sess-1", eventsDir);

    const docs = await exportEventSummaries(opts());
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].sourceId).toMatch(/^seed:event:\d{4}-\d{2}-\d{2}$/);
    expect(docs[0].source).toBe("seed:events");
  });

  test("groups events by day correctly", async () => {
    await logEvent("session_start", {}, "s1", eventsDir);
    await logEvent("session_end", {}, "s1", eventsDir);
    await logEvent("learning_extracted", {}, "s1", eventsDir);

    const docs = await exportEventSummaries(opts());
    expect(docs.length).toBe(1); // All same day
    expect(docs[0].content).toContain("3 total");
  });

  test("returns empty array for no events", async () => {
    const docs = await exportEventSummaries(opts());
    expect(docs).toEqual([]);
  });

  test("handles missing events directory gracefully", async () => {
    const docs = await exportEventSummaries({
      eventsDir: join(tempDir, "nonexistent"),
    });
    expect(docs).toEqual([]);
  });
});

// =============================================================================
// T-12.4: exportAllForACR
// =============================================================================

describe("exportAllForACR", () => {
  test("combines learnings and event summaries", async () => {
    const seed = createDefaultSeed();
    seed.learned.patterns.push(makeLearning("p1", "Test pattern"));
    await writeSeed(seed, seedPath);
    await logEvent("session_start", {}, "s1", eventsDir);

    const result = await exportAllForACR(opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.learningCount).toBe(1);
    expect(result.eventSummaryCount).toBe(1);
    expect(result.documents.length).toBe(2);
  });

  test("works with no learnings and no events", async () => {
    const seed = createDefaultSeed();
    await writeSeed(seed, seedPath);

    const result = await exportAllForACR(opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents.length).toBe(0);
  });
});

// =============================================================================
// T-12.5: Exports
// =============================================================================

describe("exports", () => {
  test("all exports importable from index", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.exportLearnings).toBe("function");
    expect(typeof mod.exportEventSummaries).toBe("function");
    expect(typeof mod.exportAllForACR).toBe("function");
    expect(mod.acrDocumentSchema).toBeDefined();
  });
});
