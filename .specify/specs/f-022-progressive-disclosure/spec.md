# F-022: Progressive Disclosure

## Problem

pai-seed's `sessionStartHook()` injects full content for ALL learnings and proposals at session start. This creates two problems:

### 1. Context Window Waste

`formatLearningSummary()` dumps up to 5 items per category (patterns, insights, self_knowledge) with full content. `formatProposals()` dumps top 5 proposals with full content, type, and source. For a mature seed with 15 learnings and 5 proposals, this consumes ~800-1200 tokens before the session begins.

### 2. Duplication with ACR Memory Injection

The injection pipeline at session start has TWO independent sources:

**Source A — pai-seed `sessionStartHook()` (src/session.ts:193-263):**
- `formatLearningSummary()` injects confirmed learnings — top 5 per category with full content
- `formatProposals()` injects pending proposals — top 5 by recency with full content

**Source B — ACR semantic search (external PAI system):**
- `exportAllForACR()` (src/acr.ts:154-173) exports confirmed learnings as AcrDocuments
- ACR indexes these and performs semantic search at session start
- Returns matches like `[67%] session: Prefers TypeScript strict mode`

**The overlap:** Confirmed learnings appear in BOTH streams. The same pattern shows up as:
- pai-seed context: `"  - Prefers TypeScript strict mode"`
- ACR context: `"[67%] session: Pattern: Prefers TypeScript strict mode"`

**The gap:** ACR's session-start search is query-dependent and may return unrelated session fragments instead of pai-seed learnings. With the counts-only approach, neither system reliably surfaces learning content.

## Solution

Redesign `generateSessionContext()` to use pai-seed's own retrieval engine (F-025) for learning injection, and compact formatting for proposals.

### 1. Semantic learning retrieval (replaces dump)

Instead of dumping all learnings or showing useless counts, `generateSessionContext()` calls `retrieveRelevantLearnings()` from F-025's embedding engine. This returns the top N learnings ranked by relevance to the current context (project, CWD).

**Current (dump all):**
```
Confirmed patterns:
  - Prefers explicit error handling over silent failures
  - Uses Zod for all schema validation
  - Tests use temp dirs, never touch ~/.pai
  - Always uses TypeScript strict mode
  - Prefers Commander.js for CLIs
```

**New (semantic selection):**
```
Relevant learnings (3/15, ~120 tokens):
  [0.89] pattern: Prefers explicit error handling over silent failures
  [0.84] pattern: Uses Zod for all schema validation
  [0.76] insight: ACR confidence threshold 0.7 balances recall/precision
```

Only learnings relevant to the current context are injected. Each shows a relevance score. The AI knows exactly how many exist vs how many were selected.

**Fallback (no embeddings):** Top 5 most recently confirmed learnings. Better than all-or-nothing.

### 2. Compact proposal index

Replace full proposal content with a compact index:

**Current (full dump):**
```
Pending proposals (5):
  1. [pattern] "Prefers explicit error handling over silent failures when writing TypeScript..." (from session-abc)
```

**New (compact index):**
```
Pending proposals (5):
  abc12 pattern  "Prefers explicit error handling..." (0.82)
  def45 insight  "TypeScript strict mode catches..." (0.71)
  ...
Review: `pai-seed proposals review`
```

ID prefix (5 chars), type, truncated content (40 chars), confidence score.

### 3. Delineation of Responsibilities (post-F-025)

| Concern | Owner | How |
|---------|-------|-----|
| Identity | pai-seed | Always injected |
| Relevant learnings | pai-seed (F-025) | Semantic retrieval from own embeddings |
| Pending proposals | pai-seed | Compact index |
| Session state | pai-seed | Always injected |
| Cross-project context | ACR (optional) | Semantic search across all indexed data |
| Event history | ACR (optional) | On-demand |

pai-seed is self-sufficient for its own learnings. ACR becomes a complementary system for broader context, not a required dependency.

## User Scenarios

### S1: Session start with embeddings available
- `generateSessionContext()` calls `retrieveRelevantLearnings()` with project context
- Returns top 3-5 learnings ranked by relevance
- Injected with similarity scores and token estimate
- ACR may also inject cross-project context (no duplication — different data)

### S2: Session start cold (no embeddings)
- `retrieveRelevantLearnings()` finds no embeddings
- Falls back to top 5 most recently confirmed learnings
- Still better than dumping all 15

### S3: Session start with zero learnings
- "No confirmed learnings yet."
- Proposals shown if any pending

### S4: AI wants to see a specific proposal
- Sees compact index with ID prefix
- Runs `pai-seed proposals show abc12` for full detail
- Progressive disclosure: index first, detail on demand

### S5: Standalone mode (no ACR)
- Works identically — pai-seed owns its own retrieval
- No dependency on external systems

## Functional Requirements

### FR-1: Semantic learning injection
- **When:** `generateSessionContext()` builds the learnings section
- **Then:** Call `retrieveRelevantLearnings()` (from F-025) with project/CWD context
- **Output:** `"Relevant learnings (N/total, ~T tokens):"` with scored items
- **Fallback:** Recency-based top 5 when embeddings unavailable
- **Files:** `src/session.ts` — replace `formatLearningSummary()` call

### FR-2: Compact proposal index
- **When:** Formatting proposals for session context
- **Then:** Show ID prefix (5 chars), type, truncated content (40 chars), confidence
- **Files:** `src/session.ts` — rewrite `formatProposals()`

### FR-3: Token estimate in context output
- **When:** Generating session context
- **Then:** Append approximate token count: `"~N tokens"`
- **Files:** `src/session.ts` — in `generateSessionContext()`

### FR-4: Context metadata in return type
- **When:** `generateSessionContext()` returns
- **Then:** Include `tokenEstimate`, `learningsShown`, `learningsTotal` in result
- **Files:** `src/session.ts` — extend `SessionContext` type

## Dependencies

- **F-025** provides `retrieveRelevantLearnings()` — must be implemented first
- F-023 (Token Budget) can optionally constrain the output further

## Out of Scope

- ACR changes — `exportAllForACR()` remains as-is
- Token budget enforcement (F-023)
- Per-project filtering (F-024 — F-025 retrieval handles relevance)

## Success Criteria

1. Session context uses `retrieveRelevantLearnings()` for learning injection
2. Recency fallback works when no embeddings exist
3. Proposal index shows ID prefix, type, truncated content, confidence
4. Context output includes token estimate and selection metadata
5. No duplication between pai-seed and ACR — pai-seed handles its own learnings
6. All existing tests pass (589+)
7. New tests cover semantic injection, fallback, and compact proposal format
