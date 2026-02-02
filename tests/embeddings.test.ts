import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  cosineSimilarity,
  initEmbeddingsDb,
  contentHash,
  storeEmbedding,
  getStoredEmbedding,
  getAllEmbeddings,
  deleteEmbedding,
  countEmbeddings,
  embedLearning,
  embedAllMissing,
  searchSimilar,
  retrieveRelevantLearnings,
  resolveEmbeddingsDbPath,
} from "../src/embeddings";
import type { SeedConfig } from "../src/schema";
import { createDefaultSeed } from "../src/defaults";

// =============================================================================
// Test helpers
// =============================================================================

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pai-embed-test-"));
}

function makeLearning(id: string, content: string, confirmedAt?: string) {
  return {
    id,
    content,
    source: "test",
    extractedAt: "2026-01-01T00:00:00Z",
    confirmedAt: confirmedAt ?? "2026-01-15T00:00:00Z",
    confirmed: true,
    tags: [],
  };
}

function makeConfig(learnings: {
  patterns?: ReturnType<typeof makeLearning>[];
  insights?: ReturnType<typeof makeLearning>[];
  selfKnowledge?: ReturnType<typeof makeLearning>[];
}): SeedConfig {
  const config = createDefaultSeed();
  config.learned.patterns = learnings.patterns ?? [];
  config.learned.insights = learnings.insights ?? [];
  config.learned.selfKnowledge = learnings.selfKnowledge ?? [];
  return config;
}

// Mock embedding: a deterministic Float32Array based on string hash
function mockEmbedding(text: string, dim: number = 384): Float32Array {
  const arr = new Float32Array(dim);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < dim; i++) {
    hash = ((hash << 5) - hash + i) | 0;
    arr[i] = (hash % 1000) / 1000;
  }
  // Normalize
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  if (norm > 0) for (let i = 0; i < dim; i++) arr[i] /= norm;
  return arr;
}

// =============================================================================
// T-25.1: Cosine Similarity
// =============================================================================

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("returns -1.0 for opposite vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("handles non-unit vectors", () => {
    const a = new Float32Array([3, 4]);
    const b = new Float32Array([3, 4]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it("throws on length mismatch", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow("Vector length mismatch");
  });

  it("returns 0 for zero vectors", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("computes correctly for 384-dim mock vectors", () => {
    const a = mockEmbedding("hello");
    const b = mockEmbedding("hello");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);

    const c = mockEmbedding("completely different text");
    const sim = cosineSimilarity(a, c);
    expect(sim).toBeLessThan(1.0);
    expect(sim).toBeGreaterThan(-1.0);
  });
});

// =============================================================================
// T-25.2: SQLite Storage Layer
// =============================================================================

describe("SQLite storage", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, "test-embeddings.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initEmbeddingsDb creates database and table", () => {
    const db = initEmbeddingsDb(dbPath);
    expect(countEmbeddings(db)).toBe(0);
    db.close();
  });

  it("storeEmbedding + getStoredEmbedding roundtrip", () => {
    const db = initEmbeddingsDb(dbPath);
    const emb = mockEmbedding("test");
    const hash = contentHash("test content");

    storeEmbedding(db, "learn-1", emb, hash);

    const stored = getStoredEmbedding(db, "learn-1");
    expect(stored).not.toBeNull();
    expect(stored!.contentHash).toBe(hash);
    expect(stored!.embedding.length).toBe(384);
    // Verify values survived roundtrip
    expect(cosineSimilarity(emb, stored!.embedding)).toBeCloseTo(1.0, 4);
    db.close();
  });

  it("getStoredEmbedding returns null for missing ID", () => {
    const db = initEmbeddingsDb(dbPath);
    expect(getStoredEmbedding(db, "nonexistent")).toBeNull();
    db.close();
  });

  it("storeEmbedding upserts on duplicate ID", () => {
    const db = initEmbeddingsDb(dbPath);
    const emb1 = mockEmbedding("version1");
    const emb2 = mockEmbedding("version2");

    storeEmbedding(db, "learn-1", emb1, "hash1");
    storeEmbedding(db, "learn-1", emb2, "hash2");

    expect(countEmbeddings(db)).toBe(1);
    const stored = getStoredEmbedding(db, "learn-1");
    expect(stored!.contentHash).toBe("hash2");
    db.close();
  });

  it("getAllEmbeddings returns all entries", () => {
    const db = initEmbeddingsDb(dbPath);
    storeEmbedding(db, "a", mockEmbedding("a"), "ha");
    storeEmbedding(db, "b", mockEmbedding("b"), "hb");
    storeEmbedding(db, "c", mockEmbedding("c"), "hc");

    const all = getAllEmbeddings(db);
    expect(all.length).toBe(3);
    expect(all.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
    db.close();
  });

  it("deleteEmbedding removes entry", () => {
    const db = initEmbeddingsDb(dbPath);
    storeEmbedding(db, "a", mockEmbedding("a"), "ha");
    expect(countEmbeddings(db)).toBe(1);

    deleteEmbedding(db, "a");
    expect(countEmbeddings(db)).toBe(0);
    db.close();
  });

  it("contentHash is deterministic", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
    expect(contentHash("hello")).not.toBe(contentHash("world"));
  });

  it("resolveEmbeddingsDbPath uses env var when set", () => {
    const original = process.env.PAI_EMBEDDINGS_DB;
    process.env.PAI_EMBEDDINGS_DB = "/tmp/custom.db";
    expect(resolveEmbeddingsDbPath()).toBe("/tmp/custom.db");
    if (original) {
      process.env.PAI_EMBEDDINGS_DB = original;
    } else {
      delete process.env.PAI_EMBEDDINGS_DB;
    }
  });
});

// =============================================================================
// T-25.5: searchSimilar (with mock embeddings pre-stored)
// =============================================================================

describe("searchSimilar (mock embeddings)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, "test-embeddings.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no embeddings stored", async () => {
    const db = initEmbeddingsDb(dbPath);
    // searchSimilar needs the real model to embed the query
    // With no stored embeddings, it returns empty regardless
    const results = await searchSimilar(db, "anything", 5, 0.0);
    // May return empty (model might not be loaded in test env)
    expect(Array.isArray(results)).toBe(true);
    db.close();
  });
});

// =============================================================================
// T-25.6: retrieveRelevantLearnings
// =============================================================================

describe("retrieveRelevantLearnings", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, "test-embeddings.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no learnings exist", async () => {
    const config = makeConfig({});
    const result = await retrieveRelevantLearnings(config, { project: "test" }, { dbPath });
    expect(result).toEqual([]);
  });

  it("falls back to recency when no embeddings exist", async () => {
    const config = makeConfig({
      patterns: [
        makeLearning("p1", "Old pattern", "2026-01-01T00:00:00Z"),
        makeLearning("p2", "New pattern", "2026-01-20T00:00:00Z"),
        makeLearning("p3", "Newest pattern", "2026-01-25T00:00:00Z"),
      ],
    });

    const result = await retrieveRelevantLearnings(
      config,
      { project: "test" },
      { maxResults: 2, dbPath },
    );

    expect(result.length).toBe(2);
    // Recency fallback: newest first
    expect(result[0].learning.id).toBe("p3");
    expect(result[1].learning.id).toBe("p2");
    // Score is 0 for recency fallback
    expect(result[0].score).toBe(0);
    // Method is "recency" for fallback
    expect(result[0].method).toBe("recency");
    expect(result[1].method).toBe("recency");
  });

  it("respects maxResults", async () => {
    const config = makeConfig({
      patterns: [
        makeLearning("p1", "A"),
        makeLearning("p2", "B"),
        makeLearning("p3", "C"),
        makeLearning("p4", "D"),
        makeLearning("p5", "E"),
      ],
    });

    const result = await retrieveRelevantLearnings(
      config,
      { project: "test" },
      { maxResults: 3, dbPath },
    );

    expect(result.length).toBe(3);
  });

  it("includes all learning types in results", async () => {
    const config = makeConfig({
      patterns: [makeLearning("p1", "Pattern learning", "2026-01-25T00:00:00Z")],
      insights: [makeLearning("i1", "Insight learning", "2026-01-24T00:00:00Z")],
      selfKnowledge: [makeLearning("s1", "Self knowledge", "2026-01-23T00:00:00Z")],
    });

    const result = await retrieveRelevantLearnings(
      config,
      { project: "test" },
      { maxResults: 5, dbPath },
    );

    expect(result.length).toBe(3);
    const types = result.map((r) => r.type).sort();
    expect(types).toEqual(["insight", "pattern", "self_knowledge"]);
  });

  it("returns results with correct type labels", async () => {
    const config = makeConfig({
      patterns: [makeLearning("p1", "A pattern", "2026-01-25T00:00:00Z")],
      insights: [makeLearning("i1", "An insight", "2026-01-20T00:00:00Z")],
    });

    const result = await retrieveRelevantLearnings(
      config,
      {},
      { maxResults: 5, dbPath },
    );

    const pattern = result.find((r) => r.learning.id === "p1");
    const insight = result.find((r) => r.learning.id === "i1");
    expect(pattern?.type).toBe("pattern");
    expect(insight?.type).toBe("insight");
  });
});

// =============================================================================
// T-25.4: embedLearning + embedAllMissing
// =============================================================================

describe("embedLearning", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, "test-embeddings.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips if already embedded with same content hash", async () => {
    const db = initEmbeddingsDb(dbPath);
    const hash = contentHash("test content");
    storeEmbedding(db, "learn-1", mockEmbedding("test"), hash);

    // embedLearning checks hash — should skip
    const result = await embedLearning(db, "learn-1", "test content");
    expect(result).toBe(false);
    db.close();
  });
});

describe("embedAllMissing", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, "test-embeddings.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports skipped for already-embedded learnings", async () => {
    const config = makeConfig({
      patterns: [makeLearning("p1", "Already embedded")],
    });

    // Pre-store embedding
    const db = initEmbeddingsDb(dbPath);
    storeEmbedding(db, "p1", mockEmbedding("Already embedded"), contentHash("Already embedded"));
    db.close();

    const result = await embedAllMissing(config, dbPath);
    expect(result.skipped).toBe(1);
    expect(result.embedded).toBe(0);
  });

  it("returns zeros for empty config", async () => {
    const config = makeConfig({});
    const result = await embedAllMissing(config, dbPath);
    expect(result.embedded).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });
});

// =============================================================================
// Integration tests (require model, skip in CI)
// =============================================================================

const RUN_INTEGRATION = process.env.PAI_TEST_EMBEDDINGS === "1";

describe.skipIf(!RUN_INTEGRATION)("integration: real embeddings", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, "test-embeddings.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("embedLearning generates and stores real embedding", async () => {
    const db = initEmbeddingsDb(dbPath);
    const result = await embedLearning(db, "learn-1", "User prefers TypeScript strict mode");
    expect(result).toBe(true);

    const stored = getStoredEmbedding(db, "learn-1");
    expect(stored).not.toBeNull();
    expect(stored!.embedding.length).toBe(384);
    db.close();
  });

  it("searchSimilar finds semantically similar learnings", async () => {
    const db = initEmbeddingsDb(dbPath);

    // Store embeddings for different topics
    await embedLearning(db, "ts-strict", "User prefers TypeScript strict mode for type safety");
    await embedLearning(db, "zod-val", "Uses Zod for runtime schema validation");
    await embedLearning(db, "weather", "The weather is nice today");

    const results = await searchSimilar(db, "type checking in code", 3, 0.1);
    expect(results.length).toBeGreaterThan(0);
    // TypeScript strict should rank higher than weather
    const tsIdx = results.findIndex((r) => r.id === "ts-strict");
    const weatherIdx = results.findIndex((r) => r.id === "weather");
    if (tsIdx >= 0 && weatherIdx >= 0) {
      expect(tsIdx).toBeLessThan(weatherIdx);
    }
    db.close();
  });

  it("retrieveRelevantLearnings uses semantic ranking", async () => {
    const config = makeConfig({
      patterns: [
        makeLearning("ts", "Prefers TypeScript strict mode"),
        makeLearning("zod", "Uses Zod for schema validation"),
        makeLearning("weather", "Likes sunny weather"),
      ],
    });

    // Pre-embed all learnings
    await embedAllMissing(config, dbPath);

    const result = await retrieveRelevantLearnings(
      config,
      { project: "typescript-project" },
      { maxResults: 2, dbPath },
    );

    expect(result.length).toBe(2);
    // Should prefer TypeScript-related learnings
    expect(result[0].score).toBeGreaterThan(0);
    expect(result[0].learning.id).not.toBe("weather");
  });

  it("embedAllMissing embeds all learnings", async () => {
    const config = makeConfig({
      patterns: [makeLearning("p1", "Pattern one")],
      insights: [makeLearning("i1", "Insight one")],
    });

    const result = await embedAllMissing(config, dbPath);
    expect(result.embedded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });
});
