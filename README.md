# pai-seed

## Why pai-seed exists

Most AI assistants suffer from session amnesia. Every conversation starts cold — the AI doesn't know what happened yesterday, repeats mistakes, loses learned patterns, and has no continuity with people or projects. Tools like ChatGPT, Claude, and Gemini answer your question, then forget everything. Next session starts fresh.

pai-seed addresses this by implementing an idea from Arbor: **"the subconscious proposes, the conscious decides."** After each session, the system automatically extracts learning candidates from the interaction — patterns it noticed, insights it formed, things it learned about itself. These become *proposals*, stored quietly until the next session. At session start, they're presented for review. The user confirms what's accurate, rejects what isn't. Confirmed learnings persist and shape future behavior. Over time, the AI accumulates genuine understanding rather than static instructions.

This is the core loop that makes `seed.json` different from a configuration file. A config file is written once and read forever. A seed file *grows*. It captures who the AI is becoming through lived interaction — identity, learned patterns, operational state — all versioned in git so you can see the AI's evolution over time.

pai-seed provides the typed infrastructure for this lifecycle: schema validation, git-backed persistence, session hooks, event logging, learning decay, and the full propose-confirm-persist pipeline that turns transient sessions into durable intelligence.

**589 tests | 21 features | 0 failures**

## The Learning Lifecycle

pai-seed implements a closed-loop learning system with two input channels, quality filtering, human review, and feedback monitoring.

```
                           TWO INPUT CHANNELS
                    ┌──────────────────────────────┐
                    │                              │
            Deliberate                      Automatic
     pai-seed capture <type>          Post-session extraction
       "I want to remember"          "AI noticed something"
                    │                              │
                    │                     ┌────────┴────────┐
                    │                     │                  │
                    │              ACR Semantic         Regex Fallback
                    │              (confidence ≥0.7)    (ACR unavailable)
                    │                     │                  │
                    │                     └────────┬────────┘
                    │                              │
                    │                     Pre-filter transcript
                    │                     (strip code blocks, JSON,
                    │                      tool output, line numbers)
                    │                              │
                    │                     Truncate to 200 chars
                    │                              │
                    └──────────┬───────────────────┘
                               │
                          PROPOSALS
                     (pending in seed.json)
                               │
                    ┌──────────┴──────────┐
                    │    SESSION START    │
                    │  Top 5 by recency  │
                    │  shown as context  │
                    └──────────┬──────────┘
                               │
                          HUMAN REVIEW
                    pai-seed proposals review
                    (or AI-assisted in session)
                               │
                    ┌──────────┴──────────┐
                    │                      │
               ACCEPTED                REJECTED
          → confirmed learning      → marked rejected
          → routed by type          → cleaned on demand
          → persists in seed        → stats tracked
                    │                      │
                    └──────────┬───────────┘
                               │
                        FEEDBACK LOOP
                    pai-seed status shows:
                    - acceptance rate
                    - per-type breakdown
                    - confidence averages
                    - threshold alerts
```

### Two Channels

**Deliberate capture** (`pai-seed capture <type> <content>`): You explicitly tell the system what to remember. This bypasses extraction entirely — the learning is confirmed immediately.

**Automatic extraction** (post-session hook): After each AI session, the transcript is processed through the extraction pipeline. ACR semantic extraction runs first (confidence threshold 0.7). If ACR is unavailable, regex pattern matching serves as fallback. The transcript is pre-filtered to strip code blocks, JSON objects, tool output, and line-number prefixed content before extraction.

### Quality Pipeline (F-019)

Raw transcripts contain code, API responses, and conversation scaffolding that produce garbage proposals. The extraction pipeline applies four quality layers:

1. **Pre-filter**: `stripStructuredContent()` removes fenced code blocks, tool XML blocks, line-number prefixed lines, and large JSON objects before extraction runs
2. **ACR-first with silence on empty**: When ACR succeeds but finds nothing above the confidence threshold, the system accepts silence rather than falling back to regex
3. **Content truncation**: All proposal content capped at 200 characters
4. **Surfacing cap**: Session start context shows top 5 proposals by recency, not all pending

### Feedback Loop (F-021)

Every accept/reject decision increments cumulative extraction stats stored in `state.extractionStats`. The `pai-seed status` command displays extraction health:

```
Extraction health:
  Proposals: 48 total (5 accepted, 3 rejected, 40 pending)
  Acceptance rate: 62.5% (5/8 decided)
  By type: patterns 3/4 (75%), insights 2/3 (67%), self_knowledge 0/1 (0%)
  Avg confidence: accepted=0.82, rejected=0.51
```

Threshold alerts fire with 10+ decisions:
- **>90% accepted**: "Extraction filter may be too loose"
- **<10% accepted**: "Extraction producing mostly noise"

## Architecture

```
Layer 5: Quality & Feedback
  F-021  Feedback Loop    ← extraction stats, acceptance rate, threshold alerts
  F-020  Deliberate Capture ← explicit capture command, two-channel model
  F-019  Extraction Quality ← pre-filter, truncation, surfacing cap

Layer 4: Intelligence
  F-018  Proposals CLI    ← list, accept, reject, review, bulk operations
  F-017  ACR Extraction   ← semantic extraction via ACR with confidence scoring
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
    "activeProjects": [],
    "extractionStats": {
      "accepted": 0,
      "rejected": 0,
      "byType": { "pattern": {}, "insight": {}, "self_knowledge": {} },
      "confidenceSum": { "accepted": 0, "rejected": 0 },
      "confidenceCount": { "accepted": 0, "rejected": 0 }
    }
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
const extraction = await extractionHook(transcript, sessionId);

// Log events
await logEvent("session_start", { action: "begin" });

// Check learning freshness
const stale = getStaleLearnings(result.config);

// Export for ACR semantic search
const acr = await exportAllForACR();
```

## CLI

```bash
# Core
pai-seed show [--json]             # Seed summary (JSON for machine consumption)
pai-seed status                    # Health check + extraction stats
pai-seed diff                      # Git diff for seed.json

# Learning — two channels
pai-seed capture <type> <content>  # Deliberate: you decide what to save
pai-seed learn <type> <content>    # Alias for capture

# Proposals — review extracted candidates
pai-seed proposals list [--verbose]   # List pending proposals
pai-seed proposals accept <id>        # Accept by ID prefix
pai-seed proposals reject <id>        # Reject by ID prefix
pai-seed proposals review             # Interactive review (a/r/s/q)
pai-seed proposals accept-all         # Bulk accept
pai-seed proposals reject-all         # Bulk reject
pai-seed proposals clean              # Remove rejected from state

# Learnings — browse confirmed knowledge
pai-seed learnings list [--type=X] [--verbose]   # List learnings
pai-seed learnings show <id>                     # Full detail
pai-seed learnings search <query> [--type=X]     # Search content

# Maintenance
pai-seed forget <id>               # Remove learning
pai-seed stale                     # List stale learnings (>90 days)
pai-seed refresh <id>              # Re-confirm learning
pai-seed redact <id> [reason]      # Redact event from log
pai-seed repair                    # Auto-repair from git history

# Relationships
pai-seed rel list                  # List relationships
pai-seed rel add <name> [context]  # Add relationship
pai-seed rel show <name>           # Show relationship
pai-seed rel moment <name> <desc>  # Add key moment
```

Types: `pattern`, `insight`, `self_knowledge`

## API

### F-001: Schema & Validation

| Export | Description |
|--------|-------------|
| `seedConfigSchema` | Root Zod schema |
| `validateSeed(data)` | Validate against schema |
| `createDefaultSeed()` | New SeedConfig with defaults |
| `generateJsonSchema()` | Generate JSON Schema |
| `SeedConfig`, `Learning`, `Proposal`, `ExtractionStats` | Core types |

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
| `extractionHook(transcript, sessionId?, path?)` | Hook entry point (ACR-first with regex fallback) |
| `detectLearningSignals(text)` | Find learning patterns in text |
| `extractProposals(transcript, sessionId?)` | Convert signals to proposals |
| `stripStructuredContent(text)` | Pre-filter code blocks, JSON, tool output |
| `callAcrExtraction(transcript, opts?)` | ACR semantic extraction |

### F-007: Proposal Confirmation

| Export | Description |
|--------|-------------|
| `acceptProposal(id, path?)` | Accept -> learning (tracks stats) |
| `rejectProposal(id, path?)` | Reject proposal (tracks stats) |
| `getPendingProposals(path?)` | List pending proposals |
| `acceptAllProposals(path?)` | Bulk accept (tracks stats) |
| `rejectAllProposals(path?)` | Bulk reject (tracks stats) |
| `cleanRejected(path?)` | Remove rejected from state |
| `initExtractionStats()` | Zero-valued stats object |
| `updateExtractionStats(stats, type, action, confidence?)` | Increment counters |

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

Binary: `pai-seed` (via `src/cli.ts`). Exported `main(argv?)` and `computeExtractionHealth(config)` for programmatic use.

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

### F-017: ACR Semantic Extraction

| Export | Description |
|--------|-------------|
| `callAcrExtraction(transcript, opts?)` | CLI interface to ACR binary |
| `AcrExtractionResult`, `AcrExtractionOptions` | Types |

### F-018: Proposals & Learnings CLI

Full proposals management (`list`, `accept`, `reject`, `review`, `accept-all`, `reject-all`, `clean`) and learnings browsing (`list`, `show`, `search`) with ID prefix resolution, type filtering, verbose/compact output, and search highlighting.

### F-019: Extraction Quality

| Export | Description |
|--------|-------------|
| `stripStructuredContent(text)` | Remove code blocks, JSON, tool XML, line numbers |
| `MAX_PROPOSAL_CONTENT_LENGTH` | Content truncation limit (200) |

### F-020: Deliberate Capture

`capture` command alias for `learn` with "captured" commit verb. Review suggestion appended to `formatProposals()` output. Help text documents two-channel learning model.

### F-021: Feedback Loop

| Export | Description |
|--------|-------------|
| `computeExtractionHealth(config)` | Stats + alerts string (or null) |
| `initExtractionStats()` | Zero-valued stats object |
| `updateExtractionStats(stats, type, action, confidence?)` | Increment counters |

Proposal schema extended with optional `confidence` (ACR score) and `decidedAt` (ISO timestamp). Cumulative stats tracked in `state.extractionStats`.

## Development

```bash
bun test              # 589 tests across 22 files
bun run typecheck     # tsc --noEmit
```

All tests use temp directories and never touch `~/.pai/`.

## License

MIT
