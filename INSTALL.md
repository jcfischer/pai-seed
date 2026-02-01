# Agent Installation Guide

Instructions for AI agents integrating with pai-seed as a library or implementing extensions.

## Quick Start

```bash
cd ~/work/pai-seed
bun install
bun test              # 510 tests, all green
bun run typecheck     # tsc --noEmit, exit 0
```

All imports come from the barrel:

```typescript
import { loadSeedWithGit, sessionStartHook, logEvent } from "pai-seed";
```

## Project Structure

```
pai-seed/
  src/
    schema.ts          # F-001: Zod schemas, types, CURRENT_MAJOR_VERSION
    validate.ts        # F-001: validateSeed(), ValidationResult
    defaults.ts        # F-001: createDefaultSeed()
    json-schema.ts     # F-001: generateJsonSchema()
    merge.ts           # F-002: deepMerge() for defaults filling
    loader.ts          # F-002: loadSeed(), writeSeed(), resolveSeedPath()
    git.ts             # F-003: Git operations, auto-commit, repair
    setup.ts           # F-004: First-run setup wizard
    session.ts         # F-005: Session context formatting
    extraction.ts      # F-006: Learning signal detection, proposal creation
    confirmation.ts    # F-007: Accept/reject proposals → learnings
    events.ts          # F-008: Append-only JSONL event log
    compaction.ts      # F-009: Event archive with statistical summaries
    checkpoint.ts      # F-010: Seed + events state snapshots
    cli.ts             # F-011: CLI entry point (shebang, exported main())
    acr.ts             # F-012: Export learnings/events for ACR search
    relationships.ts   # F-013: Separate person files with CRUD
    migration.ts       # F-014: Version-aware schema migration
    freshness.ts       # F-015: Learning decay detection, scoring
    redaction.ts       # F-016: Append-only event redaction
    index.ts           # Public API barrel export (all 16 features)
  tests/
    schema.test.ts          # 43 tests
    validate.test.ts        # 23 tests
    defaults.test.ts        # 9 tests
    json-schema.test.ts     # 9 tests
    merge.test.ts           # 17 tests
    loader.test.ts          # 28 tests
    git.test.ts             # 36 tests
    setup.test.ts           # 19 tests
    session.test.ts         # 26 tests
    extraction.test.ts      # 22 tests
    confirmation.test.ts    # 18 tests
    events.test.ts          # 20 tests
    compaction.test.ts      # 59 tests
    checkpoint.test.ts      # 49 tests
    cli.test.ts             # 23 tests
    acr.test.ts             # 14 tests
    relationships.test.ts   # 25 tests
    redaction.test.ts       # 16 tests
    migration.test.ts       # 35 tests
    freshness.test.ts       # 19 tests
  features.json             # Feature registry (16 features, all complete)
  .specify/                 # SpecFlow specs (spec.md, plan.md, tasks.md per feature)
  .specflow/                # SpecFlow database
```

## Core Patterns

### Result Types

Every async operation returns a discriminated union. Functions never throw.

```typescript
type Result =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Usage — always check ok before accessing data
const result = await loadSeed();
if (!result.ok) {
  console.error(result.error.message);
  return;
}
const config = result.config;
```

### Path Resolution

All file operations accept optional path overrides. Defaults:

| Function | Default Path |
|----------|-------------|
| `resolveSeedPath()` | `~/.pai/seed.json` |
| `resolveEventsDir()` | `~/.pai/events/` |
| `resolveRelationshipsDir()` | `~/.pai/relationships/` |
| `resolveCheckpointsDir()` | `~/.pai/checkpoints/` |
| `resolveArchiveDir()` | `~/.pai/events/archive/` |

Tests always pass explicit temp paths — never touch `~/.pai/`.

### Git Integration

F-003 wraps all git operations through `runGit()`. Git failures are non-fatal:

- `writeSeedWithCommit()` — writes even if commit fails
- `loadSeedWithGit()` — full lifecycle: init, load, commit, repair
- `repairFromGit()` — recover from corruption via git history

### Schema Version

- Current: `"1.0.0"` (semver string)
- `CURRENT_MAJOR_VERSION = 1`
- Minor/patch mismatches allowed (forward compatible)
- Major mismatch triggers migration via F-014

## Common Workflows

### 1. Session Lifecycle

```typescript
import { sessionStartHook, extractionHook, logEvent } from "pai-seed";

// Session start — returns formatted context for AI prompt injection
const context = await sessionStartHook();
// context is a string with identity, learnings, proposals, state

// During session — log events
await logEvent("skill_invoked", { skill: "research" }, sessionId);

// Session end — extract learning signals from transcript
const result = await extractionHook(transcript);
// Creates proposals in seed.json for later confirmation
```

### 2. Learning Lifecycle

```typescript
import {
  extractProposals,
  writeProposals,
  getPendingProposals,
  acceptProposal,
  rejectProposal,
  getStaleLearnings,
  reconfirmLearning,
  generateReviewPrompt,
} from "pai-seed";

// Proposals extracted from sessions → written to seed.json
const signals = detectLearningSignals(text);
const proposals = extractProposals(signals);
await writeProposals(proposals);

// Review cycle
const pending = await getPendingProposals();
await acceptProposal(pending.proposals[0].id);  // → becomes a Learning
await rejectProposal(pending.proposals[1].id);   // → marked rejected

// Freshness management (90-day default)
const stale = getStaleLearnings(config);
for (const item of stale) {
  // item.learning, item.category, item.daysSinceConfirmed
  await reconfirmLearning(item.learning.id);  // or forget via CLI
}

// Review prompt for AI to suggest during sessions
const prompt = generateReviewPrompt(config);
// Returns null if nothing is stale
```

### 3. Event Management

```typescript
import {
  logEvent,
  readEvents,
  compactEvents,
  redactEvent,
  isRedacted,
} from "pai-seed";

// Log events (JSONL files at ~/.pai/events/events-YYYY-MM-DD.jsonl)
await logEvent("session_start", { action: "begin" }, sessionId);
await logEvent("learning_extracted", { count: 3 }, sessionId);

// Read with filters
const events = await readEvents({
  type: "session_start",
  since: new Date("2026-01-01"),
  limit: 100,
});
// Redacted events excluded by default

// Read including redacted (audit trail)
const all = await readEvents({ includeRedacted: true });

// Redact sensitive events (append-only, original preserved)
await redactEvent(eventId, "Contains PII");

// Compact old events (>90 days → archive with summaries)
const result = await compactEvents({ cutoffDays: 90 });
```

### 4. Relationship Management

```typescript
import {
  addRelationship,
  loadRelationship,
  addKeyMoment,
  listRelationships,
} from "pai-seed";

// Files stored at ~/.pai/relationships/rel_<slug>.json
await addRelationship("Alice Johnson", "Colleague from project X");
await addKeyMoment("Alice Johnson", "Helped deploy v2.0", ["work"]);

const rel = await loadRelationship("Alice Johnson");
// rel.relationship.keyMoments, rel.relationship.lastInteraction

const list = await listRelationships();
// list.names: ["alice-johnson", "bob-smith"]
```

### 5. ACR Integration

```typescript
import { exportAllForACR } from "pai-seed";

// Export learnings + event summaries for Tier 2 semantic search
const result = await exportAllForACR({ eventWindowDays: 90 });
if (result.ok) {
  for (const doc of result.documents) {
    // doc.sourceId: "seed:learning:p1" or "seed:event:2026-01-15"
    // doc.content: "Pattern: User prefers concise responses"
    // doc.source: "seed" or "seed:events"
    // doc.metadata: { type, confirmed, tags, ... }
  }
}
```

### 6. Schema Migration

```typescript
import { needsMigration, migrateSeed, registerMigration } from "pai-seed";

// Built-in v0→v1 migration runs automatically on loadSeed()
// Register custom migrations for future versions:
registerMigration(1, 2, (config) => {
  // Transform v1 config to v2 format
  return { ...config, version: "2.0.0", newField: "default" };
});

// Manual check
const check = needsMigration(rawConfig);
if (check.needed) {
  const result = await migrateSeed(rawConfig, { seedPath, paiDir });
}
```

## Implementation Rules

1. **Discriminated unions for results.** All result types use `{ ok: true; ... } | { ok: false; error }`.
2. **Never touch `~/.pai/` in tests.** Use temp directories via `mkdtemp`.
3. **Pure formatters.** Functions named `format*` take data in, return string. No I/O.
4. **No new dependencies** without approval. Current: `zod`, `nanoid`, `zod-to-json-schema`.
5. **Strict TypeScript.** `tsc --noEmit` must exit 0. No `any`.
6. **Barrel exports.** All public API in `src/index.ts` with feature section comments.
7. **Atomic writes.** Write to `.tmp` file, then `rename()`.

## CLI Commands

```bash
pai-seed help                      # Usage text
pai-seed show                      # Identity, learnings, proposals summary
pai-seed status                    # Path, version, validity, git status
pai-seed diff                      # Git diff for seed.json
pai-seed learn <type> <content>    # Add learning (pattern|insight|self_knowledge)
pai-seed forget <id>               # Remove learning by ID
pai-seed stale                     # List learnings >90 days old
pai-seed refresh <id>              # Re-confirm (update confirmedAt)
pai-seed rel list                  # List all relationships
pai-seed rel show <name>           # Show relationship details
pai-seed rel add <name> [context]  # Create relationship
pai-seed rel moment <name> <desc>  # Add key moment to relationship
pai-seed redact <id> [reason]      # Redact event (append-only)
pai-seed repair                    # Auto-repair from git history
```

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | ^3.23 | Schema validation |
| `nanoid` | ^5.0 | ID generation |
| `zod-to-json-schema` | ^3.23 | JSON Schema export |
| `typescript` | ^5.5 | Type checking (dev) |
| `@types/bun` | latest | Bun runtime types (dev) |
