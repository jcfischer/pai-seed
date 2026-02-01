# Agent Development Guide

Instructions for AI agents implementing features or extending pai-seed.

For integration/library usage, see [INSTALL.md](./INSTALL.md).

## Setup

```bash
cd ~/work/pai-seed
bun install
bun test              # 510 tests, all green
bun run typecheck     # tsc --noEmit, exit 0
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

## Implementation Rules

1. **Discriminated unions for results.** All result types use `{ ok: true; ... } | { ok: false; error }`.
2. **Never touch `~/.pai/` in tests.** Use temp directories via `mkdtemp`.
3. **Pure formatters.** Functions named `format*` take data in, return string. No I/O.
4. **No new dependencies** without approval. Current: `zod`, `nanoid`, `zod-to-json-schema`.
5. **Strict TypeScript.** `tsc --noEmit` must exit 0. No `any`.
6. **Barrel exports.** All public API in `src/index.ts` with feature section comments.
7. **Atomic writes.** Write to `.tmp` file, then `rename()`.

## Feature Development Workflow

Using SpecFlow (`~/bin/specflow`):

```bash
# 1. Write spec
specflow specify F-NNN

# 2. Generate plan
specflow plan F-NNN

# 3. Generate tasks
specflow tasks F-NNN

# 4. Implement (TDD)
# Write tests -> verify fail -> implement -> verify pass

# 5. Verify and complete
bun test                         # all tests green
bun run typecheck                # no type errors
yes Y | specflow complete F-NNN  # Doctorow Gate
```

## Adding a New Feature

1. **Read `features.json`** to find the feature ID, dependencies, and description.
2. **Read dependency specs** in `.specify/specs/` to understand upstream APIs.
3. **Create source file** at `src/{feature-name}.ts`.
4. **Create test file** at `tests/{feature-name}.test.ts`.
5. **Add exports** to `src/index.ts` following the section pattern:

```typescript
// =============================================================================
// F-NNN: Feature Name
// =============================================================================

// Types
export type { MyType } from "./feature-name";

// Schemas
export { mySchema } from "./feature-name";

// Functions
export { myFunction } from "./feature-name";
```

6. **Run full test suite** to verify no regressions: `bun test`.

## Key Patterns

### Result Types

Every async operation returns a discriminated union:

```typescript
type Result =
  | { ok: true; data: T }
  | { ok: false; error: string };
```

Check `ok` before accessing data. Functions never throw; errors are wrapped in the result.

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

### Session Context Modes

F-005 supports two modes:
- **`"full"`**: All sections (identity + learnings + proposals + state). For standalone use.
- **`"complement"`**: Skip identity (learnings + proposals + state). For use within PAI system.
- **Auto-detect**: If `PAI_DIR` env var is set, defaults to `"complement"`. Otherwise `"full"`.

## Dependencies Between Features

```
F-001 (Schema)
  └─ F-002 (Loader)
       ├─ F-003 (Git)
       │    ├─ F-004 (Setup) ← also depends on F-002
       │    └─ F-011 (CLI)
       ├─ F-005 (Session) ← also depends on F-003, F-004
       ├─ F-006 (Extraction)
       │    └─ F-007 (Confirmation) ← also depends on F-005
       ├─ F-008 (Event Log)
       │    ├─ F-009 (Compaction)
       │    ├─ F-010 (Checkpoint)
       │    └─ F-016 (Redaction)
       ├─ F-012 (ACR) ← also depends on F-008
       ├─ F-013 (Relationships)
       ├─ F-014 (Migration) ← also depends on F-001
       └─ F-015 (Freshness)
```

## All Features (Complete)

| ID | Name | Source | Tests |
|----|------|--------|-------|
| F-001 | Seed.json schema and validation | schema.ts, validate.ts, defaults.ts, json-schema.ts | 84 |
| F-002 | Seed file loader with defaults | loader.ts, merge.ts | 45 |
| F-003 | Git-backed persistence | git.ts | 36 |
| F-004 | First-run setup wizard | setup.ts | 19 |
| F-005 | Session start hook | session.ts | 26 |
| F-006 | Post-session extraction | extraction.ts | 22 |
| F-007 | Proposal confirmation flow | confirmation.ts | 18 |
| F-008 | Event log foundation | events.ts | 20 |
| F-009 | Event log compaction | compaction.ts | 59 |
| F-010 | Checkpoint system | checkpoint.ts | 49 |
| F-011 | CLI interface | cli.ts | 23 |
| F-012 | ACR integration | acr.ts | 14 |
| F-013 | Relationship file system | relationships.ts | 25 |
| F-014 | Schema migration | migration.ts | 35 |
| F-015 | Learning decay and freshness | freshness.ts | 19 |
| F-016 | Redaction support | redaction.ts | 16 |

**Total: 510 tests, 0 failures.**
