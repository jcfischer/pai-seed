# F-025: Plan

## Architecture

### Embedding Engine (`src/embeddings.ts`)

New module with these layers:

1. **Model layer**: Lazy-loaded Transformers.js pipeline (`Xenova/all-MiniLM-L6-v2`, 384 dims). Singleton — loaded once per process. Returns `null` on failure (model not available).

2. **Storage layer**: SQLite at `~/.pai/embeddings.db` via `bun:sqlite`.
   ```sql
   CREATE TABLE IF NOT EXISTS embeddings (
     learning_id TEXT PRIMARY KEY,
     embedding BLOB NOT NULL,
     content_hash TEXT NOT NULL,
     model TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   ```

3. **Similarity layer**: Pure cosine similarity on Float32Arrays. No external deps.

4. **Retrieval layer**: `retrieveRelevantLearnings()` — the core function F-022 consumes. Builds a context string from project/CWD, embeds it, compares against all stored learning embeddings, returns top N with scores. Falls back to recency-based selection when embeddings unavailable.

### Key Design Decisions

- **No Transformers.js in unit tests**: Mock embeddings (Float32Array) for pure function tests. Real model only in integration tests behind `PAI_TEST_EMBEDDINGS=1`.
- **Embedding on accept is sync-optional**: `acceptProposal()` calls embedding after confirm. If model unavailable, silently skips — embedding happens on next `learnings embed` or search.
- **DB path**: `~/.pai/embeddings.db` (same dir as seed.json). Configurable via `PAI_EMBEDDINGS_DB` env var for testing.
- **Content hash**: SHA-256 of learning content. If content changes, re-embed on next access.

### Files Modified

| File | Change |
|------|--------|
| `src/embeddings.ts` | NEW — full embedding engine |
| `src/confirmation.ts` | Add embedding hook after accept |
| `src/cli.ts` | Add `--semantic` to search, add `learnings embed` command |
| `src/index.ts` | Export new public API |
| `tests/embeddings.test.ts` | NEW — unit + integration tests |

### API Contracts

```typescript
// Core types
type RankedLearning = {
  learning: Learning;
  type: "pattern" | "insight" | "self_knowledge";
  score: number;
};

// Public functions
function cosineSimilarity(a: Float32Array, b: Float32Array): number;
function initEmbeddingsDb(dbPath?: string): Database;
function generateEmbedding(text: string): Promise<Float32Array | null>;
function storeEmbedding(db: Database, learningId: string, embedding: Float32Array, contentHash: string): void;
function getStoredEmbedding(db: Database, learningId: string): { embedding: Float32Array; contentHash: string } | null;
function embedLearning(db: Database, learningId: string, content: string): Promise<boolean>;
function embedAllMissing(config: SeedConfig, dbPath?: string): Promise<{ embedded: number; skipped: number; failed: number }>;
function searchSimilar(db: Database, query: string, topK?: number, minScore?: number): Promise<{ id: string; score: number }[]>;
function retrieveRelevantLearnings(config: SeedConfig, context: { project?: string; cwd?: string }, options?: { maxResults?: number; minSimilarity?: number; dbPath?: string }): Promise<RankedLearning[]>;
function resolveEmbeddingsDbPath(): string;
```
