# pai-seed

Typed seed file management for PAI (Personal AI Infrastructure). Provides schema validation, git-backed persistence, first-run setup, and session context generation for `seed.json` — the file that stores an AI assistant's identity, learned patterns, and operational state.

## Architecture

pai-seed is built as layered modules, each depending on the one below:

```
F-005  Session Context    ← formats seed data for hook injection
F-004  Setup Wizard       ← first-run identity configuration
F-003  Git Persistence    ← auto-commit, repair from history
F-002  Loader             ← read/write with defaults merging
F-001  Schema             ← Zod types, validation, JSON Schema
```

### seed.json Structure

```json
{
  "version": "1.0.0",
  "identity": {
    "principalName": "Daniel",
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
- Git (for F-003 persistence)

## Install

```bash
bun install
```

## Usage

```typescript
import {
  loadSeedWithGit,
  isFirstRun,
  runSetup,
  sessionStartHook,
  generateSessionContext,
} from "pai-seed";

// Load seed with git integration (auto-creates, auto-repairs)
const result = await loadSeedWithGit();
if (result.ok) {
  console.log(result.config.identity.aiName);
}

// Check if first-run setup is needed
if (await isFirstRun()) {
  const setup = await runSetup({ principalName: "Daniel" });
}

// Generate session context for hook injection
const ctx = await generateSessionContext();
if (ctx.ok) {
  console.log(ctx.context);      // formatted text
  console.log(ctx.proposalCount); // pending proposals count
}

// Hook entry point (thin wrapper, never throws)
const output = await sessionStartHook();
console.log(output);
```

## API

### F-001: Schema & Validation

| Export | Type | Description |
|--------|------|-------------|
| `seedConfigSchema` | Zod schema | Root schema for seed.json |
| `validateSeed(data)` | Function | Validate data against schema, returns `ValidationResult` |
| `createDefaultSeed()` | Function | Create a new SeedConfig with sensible defaults |
| `generateJsonSchema()` | Function | Generate JSON Schema from Zod schema |
| `SeedConfig` | Type | Root config type |
| `IdentityLayer` | Type | Identity section |
| `LearnedLayer` | Type | Learned patterns/insights |
| `StateLayer` | Type | Operational state |
| `Learning` | Type | Single learned item |
| `Proposal` | Type | Pending learning candidate |

### F-002: Loader

| Export | Type | Description |
|--------|------|-------------|
| `loadSeed(path?)` | Function | Load seed.json, create if missing, merge defaults |
| `writeSeed(config, path?)` | Function | Atomic write with validation |
| `resolveSeedPath(path?)` | Function | Resolve to `~/.pai/seed.json` or custom path |
| `LoadResult` | Type | Discriminated union: `{ ok, config, created, merged }` or `{ ok: false, error }` |
| `WriteResult` | Type | `{ ok: true }` or `{ ok: false, error }` |

### F-003: Git Persistence

| Export | Type | Description |
|--------|------|-------------|
| `loadSeedWithGit(path?)` | Function | Load with auto-init, auto-commit, auto-repair |
| `writeSeedWithCommit(config, message, path?)` | Function | Write + git commit |
| `initGitRepo(dir?)` | Function | Initialize git repo in `~/.pai/` |
| `repairFromGit(path?, dir?)` | Function | Recover from corruption via git history |
| `commitSeedChange(message, dir?)` | Function | Stage and commit seed files |
| `isGitRepo(dir?)` | Function | Check if directory is a git repo |
| `getLastCommitMessage(dir?)` | Function | Get most recent commit message |
| `hasUncommittedChanges(dir?)` | Function | Check for uncommitted changes |

### F-004: Setup Wizard

| Export | Type | Description |
|--------|------|-------------|
| `runSetup(answers, path?)` | Function | Run first-run setup, idempotent |
| `isFirstRun(path?)` | Function | Check if setup is needed |
| `buildSeedFromAnswers(answers)` | Function | Pure: build SeedConfig from wizard answers |
| `detectTimezone()` | Function | Detect system timezone via Intl API |
| `setupAnswersSchema` | Zod schema | Validation for setup wizard answers |
| `SetupAnswers` | Type | Setup wizard input |
| `SetupResult` | Type | `{ ok, config, created }` or `{ ok: false, error }` |

### F-005: Session Context

| Export | Type | Description |
|--------|------|-------------|
| `generateSessionContext(path?, options?)` | Function | Generate formatted context from seed |
| `sessionStartHook(path?, options?)` | Function | Hook entry point, never throws |
| `formatIdentitySummary(identity)` | Function | Pure: identity text |
| `formatLearningSummary(learned)` | Function | Pure: learning counts + items |
| `formatProposals(proposals)` | Function | Pure: numbered pending proposals |
| `formatSessionState(state)` | Function | Pure: session state text |
| `SessionContext` | Type | Context generation result |
| `ContextMode` | Type | `"full"` or `"complement"` |

**Context modes:** `"full"` includes identity (standalone use). `"complement"` skips identity (when PAI system already injects it). Auto-detected via `PAI_DIR` env var.

## Development

```bash
bun test              # run all tests (210)
bun run typecheck     # tsc --noEmit
```

All tests use temp directories and never touch `~/.pai/`. All formatter functions are pure (no I/O).

## Roadmap

5 of 16 features implemented. Remaining:

| ID | Feature | Dependencies |
|----|---------|-------------|
| F-006 | Post-session extraction hook | F-002 |
| F-007 | Proposal confirmation flow | F-005, F-006 |
| F-008 | Event log foundation | F-002 |
| F-009 | Event log compaction | F-008 |
| F-010 | Checkpoint system | F-008 |
| F-011 | Seed CLI commands | F-002, F-003 |
| F-012 | ACR integration | F-002, F-008 |
| F-013 | Relationship file system | F-002, F-003 |
| F-014 | Schema migration system | F-001, F-002 |
| F-015 | Learning decay and freshness | F-002, F-007 |
| F-016 | Redaction support | F-008 |

## License

MIT
