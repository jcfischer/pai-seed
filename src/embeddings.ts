import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { Learning, SeedConfig } from "./schema";

// =============================================================================
// F-025 Types
// =============================================================================

export type RankedLearning = {
  learning: Learning;
  type: "pattern" | "insight" | "self_knowledge";
  score: number;
};

type EmbeddingRow = {
  learning_id: string;
  embedding: Buffer;
  content_hash: string;
  model: string;
  created_at: string;
};

type EmbedBatchResult = {
  embedded: number;
  skipped: number;
  failed: number;
};

// =============================================================================
// F-025 T-25.1: Cosine Similarity (pure, no deps)
// =============================================================================

/**
 * Compute cosine similarity between two vectors.
 * Both must be same length. Returns value in [-1, 1].
 * For normalized vectors (MiniLM output), this equals dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// =============================================================================
// F-025 T-25.2: SQLite Storage Layer
// =============================================================================

const EMBEDDINGS_DB_NAME = "embeddings.db";
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/**
 * Resolve the embeddings database path.
 * Uses PAI_EMBEDDINGS_DB env var if set, otherwise ~/.pai/embeddings.db.
 */
export function resolveEmbeddingsDbPath(): string {
  if (process.env.PAI_EMBEDDINGS_DB) {
    return process.env.PAI_EMBEDDINGS_DB;
  }
  const paiDir = process.env.PAI_SEED_DIR ?? join(process.env.HOME ?? "~", ".pai");
  return join(paiDir, EMBEDDINGS_DB_NAME);
}

/**
 * Initialize the embeddings SQLite database.
 * Creates the table if it doesn't exist.
 */
export function initEmbeddingsDb(dbPath?: string): Database {
  const resolvedPath = dbPath ?? resolveEmbeddingsDbPath();
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(resolvedPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS embeddings (
      learning_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

/**
 * Compute SHA-256 hash of content for staleness detection.
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Store an embedding in the database.
 * Upserts — replaces if learning_id already exists.
 */
export function storeEmbedding(
  db: Database,
  learningId: string,
  embedding: Float32Array,
  hash: string,
): void {
  const blob = Buffer.from(embedding.buffer);
  db.run(
    `INSERT OR REPLACE INTO embeddings (learning_id, embedding, content_hash, model, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [learningId, blob, hash, MODEL_NAME, new Date().toISOString()],
  );
}

/**
 * Retrieve a stored embedding by learning ID.
 * Returns null if not found.
 */
export function getStoredEmbedding(
  db: Database,
  learningId: string,
): { embedding: Float32Array; contentHash: string } | null {
  const row = db
    .query("SELECT embedding, content_hash FROM embeddings WHERE learning_id = ?")
    .get(learningId) as EmbeddingRow | null;

  if (!row) return null;

  return {
    embedding: new Float32Array(new Uint8Array(row.embedding).buffer),
    contentHash: row.content_hash,
  };
}

/**
 * Get all stored embeddings.
 * Returns array of { id, embedding, contentHash }.
 */
export function getAllEmbeddings(
  db: Database,
): Array<{ id: string; embedding: Float32Array; contentHash: string }> {
  const rows = db
    .query("SELECT learning_id, embedding, content_hash FROM embeddings")
    .all() as EmbeddingRow[];

  return rows.map((row) => ({
    id: row.learning_id,
    embedding: new Float32Array(new Uint8Array(row.embedding).buffer),
    contentHash: row.content_hash,
  }));
}

/**
 * Delete an embedding by learning ID.
 */
export function deleteEmbedding(db: Database, learningId: string): void {
  db.run("DELETE FROM embeddings WHERE learning_id = ?", [learningId]);
}

/**
 * Count embeddings in the database.
 */
export function countEmbeddings(db: Database): number {
  const row = db.query("SELECT COUNT(*) as count FROM embeddings").get() as { count: number };
  return row.count;
}

// =============================================================================
// F-025 T-25.3: Embedding Generation (Transformers.js)
// =============================================================================

// Lazy singleton — loaded on first use, cached for process lifetime
let _pipeline: any = null;
let _pipelineFailed = false;

/**
 * Get or create the embedding pipeline.
 * Returns null if Transformers.js is unavailable.
 */
async function getEmbeddingPipeline(): Promise<any> {
  if (_pipelineFailed) return null;
  if (_pipeline) return _pipeline;

  try {
    const { pipeline } = await import("@huggingface/transformers");
    _pipeline = await pipeline("feature-extraction", MODEL_NAME, {
      device: "cpu",
      dtype: "fp32",
    });
    return _pipeline;
  } catch {
    _pipelineFailed = true;
    return null;
  }
}

/**
 * Generate an embedding vector for text.
 * Returns null if model is unavailable.
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  const pipe = await getEmbeddingPipeline();
  if (!pipe) return null;

  try {
    const result = await pipe(text, { pooling: "mean", normalize: true });
    return new Float32Array(result.data);
  } catch {
    return null;
  }
}

/**
 * Reset the pipeline singleton. Used in tests.
 */
export function resetPipeline(): void {
  _pipeline = null;
  _pipelineFailed = false;
}

// =============================================================================
// F-025 T-25.4: Embed Learning Functions
// =============================================================================

/**
 * Embed a single learning. Stores in DB.
 * Returns true if embedded, false if skipped (already fresh) or failed.
 */
export async function embedLearning(
  db: Database,
  learningId: string,
  content: string,
): Promise<boolean> {
  const hash = contentHash(content);

  // Check if already embedded with same content
  const existing = getStoredEmbedding(db, learningId);
  if (existing && existing.contentHash === hash) {
    return false; // Already up to date
  }

  const embedding = await generateEmbedding(content);
  if (!embedding) return false;

  storeEmbedding(db, learningId, embedding, hash);
  return true;
}

/**
 * Embed all learnings that are missing or stale in the database.
 * Returns counts of embedded, skipped, and failed.
 */
export async function embedAllMissing(
  config: SeedConfig,
  dbPath?: string,
): Promise<EmbedBatchResult> {
  const db = initEmbeddingsDb(dbPath);
  const result: EmbedBatchResult = { embedded: 0, skipped: 0, failed: 0 };

  try {
    const allLearnings = [
      ...config.learned.patterns.map((l) => ({ learning: l, type: "pattern" as const })),
      ...config.learned.insights.map((l) => ({ learning: l, type: "insight" as const })),
      ...config.learned.selfKnowledge.map((l) => ({ learning: l, type: "self_knowledge" as const })),
    ];

    for (const { learning } of allLearnings) {
      const embedded = await embedLearning(db, learning.id, learning.content);
      if (embedded) {
        result.embedded++;
      } else {
        // Check if it was a skip (already exists) or failure (model unavailable)
        const existing = getStoredEmbedding(db, learning.id);
        if (existing) {
          result.skipped++;
        } else {
          result.failed++;
        }
      }
    }
  } finally {
    db.close();
  }

  return result;
}

// =============================================================================
// F-025 T-25.5: Search Similar
// =============================================================================

/**
 * Search for learnings similar to a query string.
 * Embeds the query, compares against all stored embeddings.
 * Returns sorted by similarity score, filtered by minScore.
 */
export async function searchSimilar(
  db: Database,
  query: string,
  topK: number = 10,
  minScore: number = 0.3,
): Promise<Array<{ id: string; score: number }>> {
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return [];

  const all = getAllEmbeddings(db);
  const scored = all
    .map(({ id, embedding }) => ({
      id,
      score: cosineSimilarity(queryEmbedding, embedding),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

// =============================================================================
// F-025 T-25.6: Retrieve Relevant Learnings
// =============================================================================

/**
 * Collect all learnings from a config into a flat array with types.
 */
function allLearningsWithType(
  config: SeedConfig,
): Array<{ learning: Learning; type: "pattern" | "insight" | "self_knowledge" }> {
  return [
    ...config.learned.patterns.map((l) => ({ learning: l, type: "pattern" as const })),
    ...config.learned.insights.map((l) => ({ learning: l, type: "insight" as const })),
    ...config.learned.selfKnowledge.map((l) => ({ learning: l, type: "self_knowledge" as const })),
  ];
}

/**
 * Build a context string for retrieval from project/CWD info.
 */
function buildContextQuery(context: { project?: string; cwd?: string }): string {
  const parts: string[] = [];
  if (context.project) parts.push(context.project);
  if (context.cwd) {
    // Extract meaningful path segments
    const segments = context.cwd.split("/").filter(Boolean).slice(-3);
    parts.push(segments.join(" "));
  }
  return parts.join(" ") || "general programming";
}

/**
 * Retrieve the most relevant learnings for a given context.
 *
 * This is the core function F-022 will consume.
 *
 * Strategy:
 * 1. If embeddings available: semantic search with context query
 * 2. If no embeddings: recency fallback (most recently confirmed)
 *
 * Always returns maxResults or fewer items.
 */
export async function retrieveRelevantLearnings(
  config: SeedConfig,
  context: { project?: string; cwd?: string },
  options?: { maxResults?: number; minSimilarity?: number; dbPath?: string },
): Promise<RankedLearning[]> {
  const maxResults = options?.maxResults ?? 5;
  const minSimilarity = options?.minSimilarity ?? 0.2;

  const all = allLearningsWithType(config);
  if (all.length === 0) return [];

  // Try semantic retrieval
  try {
    const db = initEmbeddingsDb(options?.dbPath);
    try {
      const embeddingCount = countEmbeddings(db);

      if (embeddingCount > 0) {
        const contextQuery = buildContextQuery(context);
        const similar = await searchSimilar(db, contextQuery, maxResults, minSimilarity);

        if (similar.length > 0) {
          // Map similarity results to RankedLearnings
          const idToResult = new Map(similar.map((s) => [s.id, s.score]));
          const ranked: RankedLearning[] = [];

          for (const { learning, type } of all) {
            const score = idToResult.get(learning.id);
            if (score !== undefined) {
              ranked.push({ learning, type, score });
            }
          }

          if (ranked.length > 0) {
            return ranked.sort((a, b) => b.score - a.score).slice(0, maxResults);
          }
          // No ID matches — fall through to recency
        }
        // No matches above minSimilarity — fall through to recency
      }
    } finally {
      db.close();
    }
  } catch {
    // DB or model failure — fall through to recency
  }

  // Recency fallback: most recently confirmed learnings
  return recencyFallback(all, maxResults);
}

/**
 * Fallback: return most recently confirmed learnings.
 * Score is set to 0 to indicate "not semantically ranked".
 */
function recencyFallback(
  all: Array<{ learning: Learning; type: "pattern" | "insight" | "self_knowledge" }>,
  maxResults: number,
): RankedLearning[] {
  return [...all]
    .sort((a, b) => {
      const dateA = a.learning.confirmedAt ?? a.learning.extractedAt;
      const dateB = b.learning.confirmedAt ?? b.learning.extractedAt;
      return dateB.localeCompare(dateA);
    })
    .slice(0, maxResults)
    .map(({ learning, type }) => ({ learning, type, score: 0 }));
}
