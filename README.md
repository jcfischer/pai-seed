# pai-seed

## Why pai-seed exists

Most AI assistants suffer from session amnesia. Every conversation starts cold — the AI doesn't know what happened yesterday, repeats mistakes, loses learned patterns, and has no continuity with people or projects. Tools like ChatGPT, Claude, and Gemini answer your question, then forget everything. Next session starts fresh.

pai-seed addresses this by implementing an idea from Arbor: **"the subconscious proposes, the conscious decides."** After each session, the system automatically extracts learning candidates from the interaction — patterns it noticed, insights it formed, things it learned about itself. These become *proposals*, stored quietly until the next session. At session start, they're presented for review. The user confirms what's accurate, rejects what isn't. Confirmed learnings persist and shape future behavior. Over time, the AI accumulates genuine understanding rather than static instructions.

This is the core loop that makes `seed.json` different from a configuration file. A config file is written once and read forever. A seed file *grows*. It captures who the AI is becoming through lived interaction — identity, learned patterns, operational state — all versioned in git so you can see the AI's evolution over time.

pai-seed provides the typed infrastructure for this lifecycle: schema validation, git-backed persistence, session hooks, event logging, learning decay, and the full propose-confirm-persist pipeline that turns transient sessions into durable intelligence.

**510 tests | 16 features | 0 failures**

## Architecture

```
Layer 4: Intelligence
  F-015  Freshness        ← learning decay detection, review prompts
  F-012  ACR Integration  ← export learnings/events for semantic search
  F-006  Extraction       ← detect learning signals from sessions
  F-007  Confirmation     ← accept/reject proposed learnings

Layer 3: Lifecycle
  F-009  Compaction       ← archive old event logs with summaries
  F-010  Checkpoints      ← snapshot seed state for recovery
  F-016  Redaction        ← append-only event redaction with audit trail
  F-013  Relationships    ← separate person files linked from seed
  F-014  Migration        ← version-aware schema migration on load

Layer 2: Infrastructure
  F-008  Event Log        ← append-only JSONL event recording
  F-005  Session Hook     ← format seed data for hook injection
  F-004  Setup Wizard     ← first-run identity configuration
  F-011  CLI              ← command-line interface for all operations

Layer 1: Foundation
  F-003  Git Persistence  ← auto-commit, repair from history
  F-002  Loader           ← read/write with defaults merging, migration
  F-001  Schema           ← Zod types, validation, JSON Schema
```

### seed.json Structure

```json
{
  "version": "1.0.0",
  "identity": {
    "principalName": "Jens-Christian",
    "aiName": "Ivy",
    "catchphrase": "Ivy here, ready to go.",
    "voiceId": "",
    "preferences": {
      "responseStyle": "adaptive",
      "timezone": "Europe/Zurich",
      "locale": "en-US"
    }
  },
  "learned": {
    "patterns": [],
    "insights": [],
    "selfKnowledge": []
  },
  "state": {
    "proposals": [],
    "activeProjects": []
  }
}
```

## Requirements

- [Bun](https://bun.sh) >= 1.0
- Git (for persistence layer)

## Install

```bash
bun install
```

## Usage

```typescript
import {
  loadSeedWithGit,
  sessionStartHook,
  extractionHook,
  logEvent,
  getStaleLearnings,
  exportAllForACR,
} from "pai-seed";

// Load seed with git integration (auto-creates, auto-repairs)
const result = await loadSeedWithGit();
if (result.ok) {
  console.log(result.config.identity.aiName);
}

// Session start — inject context into AI prompt
const output = await sessionStartHook();

// Post-session — extract learning signals
const extraction = await extractionHook(transcript, seedPath);

// Log events
await logEvent("session_start", { action: "begin" });

// Check learning freshness
const stale = getStaleLearnings(result.config);

// Export for ACR semantic search
const acr = await exportAllForACR();
```

## CLI

```bash
pai-seed show                      # Seed summary
pai-seed status                    # Health check
pai-seed diff                      # Git diff
pai-seed learn <type> <content>    # Add learning
pai-seed forget <id>               # Remove learning
pai-seed stale                     # List stale learnings
pai-seed refresh <id>              # Re-confirm learning
pai-seed rel list                  # List relationships
pai-seed rel add <name> [context]  # Add relationship
pai-seed rel show <name>           # Show relationship
pai-seed rel moment <name> <desc>  # Add key moment
pai-seed redact <id> [reason]      # Redact event
pai-seed repair                    # Auto-repair from git
```

## API

### F-001: Schema & Validation

| Export | Description |
|--------|-------------|
| `seedConfigSchema` | Root Zod schema |
| `validateSeed(data)` | Validate against schema |
| `createDefaultSeed()` | New SeedConfig with defaults |
| `generateJsonSchema()` | Generate JSON Schema |
| `SeedConfig`, `Learning`, `Proposal` | Core types |

### F-002: Loader

| Export | Description |
|--------|-------------|
| `loadSeed(path?)` | Load, create if missing, merge defaults |
| `writeSeed(config, path?)` | Atomic write with validation |
| `resolveSeedPath(path?)` | Default `~/.pai/seed.json` |

### F-003: Git Persistence

| Export | Description |
|--------|-------------|
| `loadSeedWithGit(path?)` | Load + auto-init + auto-commit + repair |
| `writeSeedWithCommit(config, msg, path?)` | Write + git commit |
| `repairFromGit(path?)` | Recover from corruption |
| `initGitRepo(dir?)` | Initialize git in `~/.pai/` |

### F-004: Setup Wizard

| Export | Description |
|--------|-------------|
| `runSetup(answers, path?)` | First-run setup, idempotent |
| `isFirstRun(path?)` | Check if setup needed |
| `buildSeedFromAnswers(answers)` | Pure: answers to SeedConfig |

### F-005: Session Context

| Export | Description |
|--------|-------------|
| `sessionStartHook(path?)` | Hook entry point, never throws |
| `generateSessionContext(path?, opts?)` | Full context generation |
| `formatIdentitySummary(identity)` | Pure formatter |

### F-006: Post-Session Extraction

| Export | Description |
|--------|-------------|
| `extractionHook(transcript, path?)` | Hook entry point |
| `detectLearningSignals(text)` | Find learning patterns in text |
| `extractProposals(signals)` | Convert signals to proposals |

### F-007: Proposal Confirmation

| Export | Description |
|--------|-------------|
| `acceptProposal(id, path?)` | Accept → learning |
| `rejectProposal(id, path?)` | Reject proposal |
| `getPendingProposals(path?)` | List pending proposals |
| `acceptAllProposals(path?)` | Bulk accept |

### F-008: Event Log

| Export | Description |
|--------|-------------|
| `logEvent(type, data, sessionId?, dir?)` | Convenience event logger |
| `readEvents(options?)` | Read with filters (type, date, session) |
| `appendEvent(event, dir?)` | Low-level append |
| `countEvents(options?)` | Count by type |

### F-009: Event Compaction

| Export | Description |
|--------|-------------|
| `compactEvents(options?)` | Archive old events with summaries |
| `generatePeriodSummary(events)` | Generate statistical summary |
| `findEligiblePeriods(options?)` | Find periods ready for compaction |

### F-010: Checkpoint System

| Export | Description |
|--------|-------------|
| `createCheckpoint(options?)` | Snapshot seed + events state |
| `loadCheckpoint(id, dir?)` | Restore checkpoint |
| `listCheckpoints(dir?)` | List all checkpoints |
| `detectIncompleteCheckpoint(dir?)` | Find interrupted checkpoints |

### F-011: CLI

Binary: `pai-seed` (via `src/cli.ts`). Exported `main(argv?)` function for programmatic use.

### F-012: ACR Integration

| Export | Description |
|--------|-------------|
| `exportAllForACR(options?)` | Combined learnings + events export |
| `exportLearnings(options?)` | Learnings as ACR documents |
| `exportEventSummaries(options?)` | Events grouped by day |

### F-013: Relationship File System

| Export | Description |
|--------|-------------|
| `addRelationship(name, ctx?, opts?)` | Create relationship file |
| `loadRelationship(name, opts?)` | Read relationship |
| `listRelationships(opts?)` | List all relationship slugs |
| `addKeyMoment(name, desc, tags?, opts?)` | Append key moment |
| `removeRelationship(name, opts?)` | Delete relationship |

### F-014: Schema Migration

| Export | Description |
|--------|-------------|
| `migrateSeed(config, options?)` | Run migration chain |
| `needsMigration(config)` | Check if migration needed |
| `registerMigration(from, to, fn)` | Register migration function |

### F-015: Learning Freshness

| Export | Description |
|--------|-------------|
| `isStale(learning, days?)` | Boolean staleness check |
| `getStaleLearnings(seed, days?)` | All stale learnings |
| `freshnessScore(learning, days?)` | 0.0-1.0 linear score |
| `reconfirmLearning(id, path?)` | Update confirmedAt |
| `generateReviewPrompt(seed, days?)` | Review prompt or null |

### F-016: Redaction

| Export | Description |
|--------|-------------|
| `redactEvent(id, reason?, opts?)` | Append redaction marker |
| `isRedacted(id, opts?)` | Check if event redacted |
| `getRedactedIds(opts?)` | Set of all redacted IDs |

## Development

```bash
bun test              # 510 tests across 20 files
bun run typecheck     # tsc --noEmit
```

All tests use temp directories and never touch `~/.pai/`.

## License

MIT
