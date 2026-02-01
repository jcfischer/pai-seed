# F-025: Semantic Learning Search (Core Retrieval Engine)

## Problem

pai-seed stores learnings but delegates retrieval to ACR. This creates duplication at session start (both systems inject the same confirmed learnings) and a fragile dependency (if ACR misses learnings in its semantic search, they don't surface at all).

Additionally, pai-seed's CLI search (`pai-seed learnings search`) uses substring matching, which fails for synonyms, related concepts, and fuzzy recall.

**The root issue:** pai-seed owns the data but not the retrieval. By owning both, we eliminate the duplication problem and make pai-seed self-sufficient.

## Solution

Build a local embedding and retrieval engine inside pai-seed that serves two roles:

1. **Session-start retrieval** — `sessionStartHook()` queries the embedding engine to surface the most relevant learnings for the current context
2. **CLI search** — `pai-seed learnings search` uses semantic similarity alongside substring matching

### 1. Local embedding generation

Use a lightweight embedding model to generate vectors for each confirmed learning:
- **Transformers.js** (runs in Bun, no external deps) — preferred
- **Ollama** (local, requires separate install) — fallback

Embeddings are generated:
- When a proposal is accepted (learning confirmed)
- On-demand via `pai-seed learnings embed` (batch)
- Lazy: on first search/retrieval if not yet embedded

### 2. Vector storage

Store embeddings in SQLite at `~/.pai/embeddings.db`:

```sql
CREATE TABLE embeddings (
  learning_id TEXT PRIMARY KEY,
  embedding BLOB,      -- Float32Array serialized
  content_hash TEXT,    -- SHA256 of content, for staleness detection
  model TEXT,           -- embedding model used
  created_at TEXT
);
```

SQLite chosen over ChromaDB to avoid external dependency. Vector similarity computed in-process using cosine similarity.

### 3. Session-start retrieval (NEW — core function)

New exported function: `retrieveRelevantLearnings(context, options)`

Called by `generateSessionContext()` (F-022) to select which learnings to inject:

```typescript
export async function retrieveRelevantLearnings(
  config: SeedConfig,
  context: { project?: string; cwd?: string },
  options?: { maxResults?: number; minSimilarity?: number },
): Promise<RankedLearning[]>
```

At session start, the context is derived from:
- Current working directory / project name
- Active projects from seed state
- Recent session activity

Returns the top N learnings ranked by relevance, each with a similarity score. `sessionStartHook()` injects these instead of dumping all learnings.

**When no embeddings exist** (cold start or model unavailable): falls back to recency-based selection (most recently confirmed learnings), which is better than the current "all of them" approach.

### 4. CLI semantic search

Enhance `pai-seed learnings search <query>`:

```bash
pai-seed learnings search "error handling" --semantic
```

Default search combines substring matches + semantic matches, deduplicated and ranked.

### 5. Relationship to ACR

After F-025, `exportAllForACR()` remains available but becomes **optional**. ACR can still index learnings for cross-project, cross-tool semantic search. But pai-seed no longer depends on ACR to surface its own learnings at session start.

## User Scenarios

### S1: Session start with embeddings available
- `sessionStartHook()` calls `retrieveRelevantLearnings()` with project context
- Returns top 5 learnings ranked by relevance to current project
- Injected as compact, relevant context (not all learnings)

### S2: Session start cold (no embeddings yet)
- `retrieveRelevantLearnings()` finds no embeddings
- Falls back to top 5 most recently confirmed learnings
- Triggers background embedding generation for next time

### S3: CLI semantic search
- `pai-seed learnings search "testing" --semantic`
- Returns semantically similar results sorted by similarity score

### S4: Hybrid CLI search (default)
- `pai-seed learnings search "TypeScript"`
- Substring matches + semantic matches, deduplicated, ranked

### S5: No embedding model available
- Transformers.js fails to load
- Session start: recency-based fallback
- CLI search: substring-only with warning

### S6: New learning confirmed
- User accepts a proposal
- Embedding generated for the new learning
- Available for next retrieval/search

## Functional Requirements

### FR-1: Embedding generation
- **When:** Learning is confirmed or batch embed requested
- **Then:** Generate vector embedding using Transformers.js
- **Store:** In `~/.pai/embeddings.db`
- **Files:** `src/embeddings.ts` (new)

### FR-2: Cosine similarity computation
- **When:** Search or retrieval requested
- **Then:** Compute cosine similarity between query/context embedding and stored embeddings
- **Return:** Sorted by similarity score, configurable threshold (default 0.5)
- **Files:** `src/embeddings.ts`

### FR-3: Session-start retrieval function
- **When:** `generateSessionContext()` needs learnings to inject
- **Then:** `retrieveRelevantLearnings(config, context, options)` returns top N ranked learnings
- **Fallback:** Recency-based selection when embeddings unavailable
- **Files:** `src/embeddings.ts` — exported, called by `src/session.ts`

### FR-4: Hybrid CLI search
- **When:** `pai-seed learnings search <query>`
- **Then:** Run both substring and semantic search, deduplicate, rank
- **Files:** `src/cli.ts` — extend `cmdLearningsSearch()`

### FR-5: Embedding on accept
- **When:** `acceptProposal()` confirms a learning
- **Then:** Generate embedding for the new learning (async, non-blocking)
- **Files:** `src/confirmation.ts` — hook after accept

### FR-6: Batch embed command
- **When:** `pai-seed learnings embed`
- **Then:** Generate embeddings for all learnings missing embeddings
- **Files:** `src/cli.ts` — new command

### FR-7: Graceful fallback
- **When:** Embedding model unavailable
- **Then:** Session start uses recency. CLI search uses substring-only with warning.
- **Files:** `src/embeddings.ts`

## Out of Scope

- External embedding services (OpenAI, Cohere)
- Embedding proposals (only confirmed learnings)
- Semantic search for events or relationships
- Deprecating `exportAllForACR()` — it remains optional

## Dependencies

- `@xenova/transformers` or equivalent Bun-compatible embedding library
- SQLite (Bun built-in `bun:sqlite`)
- F-022 consumes `retrieveRelevantLearnings()` for session-start injection

## Success Criteria

1. `retrieveRelevantLearnings()` returns relevant learnings ranked by similarity
2. Recency fallback works when no embeddings exist
3. `pai-seed learnings search "error" --semantic` returns semantically similar results
4. Cosine similarity computed correctly
5. Embeddings stored in SQLite, not in seed.json
6. Graceful fallback when embedding model unavailable
7. All existing tests pass (589+)
8. New tests cover retrieval, embedding generation, similarity, fallback
