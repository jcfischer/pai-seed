# Agent Installation Guide

Instructions for AI agents implementing features or integrating with pai-seed.

## Setup

```bash
cd ~/work/pai-seed
bun install
```

Verify the environment:

```bash
bun test              # 210 tests, all green
bun run typecheck     # tsc --noEmit, exit 0
```

## Project Structure

```
pai-seed/
  src/
    schema.ts       # F-001: Zod schemas, types, constants
    validate.ts     # F-001: validateSeed(), ValidationResult
    defaults.ts     # F-001: createDefaultSeed()
    json-schema.ts  # F-001: generateJsonSchema()
    merge.ts        # F-002: deepMerge() for defaults filling
    loader.ts       # F-002: loadSeed(), writeSeed(), resolveSeedPath()
    git.ts          # F-003: Git operations, auto-commit, repair
    setup.ts        # F-004: First-run setup wizard
    session.ts      # F-005: Session context formatting
    index.ts        # Public API barrel export
  tests/
    schema.test.ts       # 43 tests
    validate.test.ts     # 23 tests
    defaults.test.ts     # 9 tests
    json-schema.test.ts  # 9 tests
    merge.test.ts        # 17 tests
    loader.test.ts       # 28 tests
    git.test.ts          # 36 tests
    setup.test.ts        # 19 tests
    session.test.ts      # 26 tests
  features.json          # Feature registry (16 features)
  .specify/              # SpecFlow specs for completed features
  .specflow/             # SpecFlow configuration
```

## Implementation Rules

1. **TDD required.** Write tests first, verify they fail, then implement.
2. **Never touch `~/.pai/`.** All tests must use temp directories via `mkdtemp`.
3. **Discriminated unions for results.** All result types use `{ ok: true; ... } | { ok: false; error: string }`.
4. **Pure formatters.** Functions named `format*` take data in, return string out. No I/O.
5. **No new dependencies** without explicit approval. Current deps: `zod`, `nanoid`, `zod-to-json-schema`.
6. **Strict TypeScript.** `tsc --noEmit` must exit 0. No `any` types.
7. **Barrel exports.** All public types and functions must be exported from `src/index.ts` with feature section comments.

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
bun test                    # all tests green
bun run typecheck           # no type errors
yes Y | specflow complete F-NNN   # Doctorow Gate
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

All file operations accept an optional `seedPath` parameter. When omitted, they default to `~/.pai/seed.json`. Tests always pass explicit temp paths.

### Git Integration

F-003 wraps all git operations through an internal `runGit()` helper. Git failures are non-fatal — `writeSeedWithCommit` succeeds even if the commit fails. The `loadSeedWithGit` function handles the full lifecycle: init repo, load seed, auto-commit on create/merge, auto-repair on corruption.

### Session Context Modes

F-005 supports two modes:
- **`"full"`**: All sections (identity + learnings + proposals + state). For standalone use.
- **`"complement"`**: Skip identity (learnings + proposals + state). For use within PAI system where identity is already injected.
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
       ├─ F-013 (Relationships)
       └─ F-014 (Migration) ← also depends on F-001
```

## Completed Features

| ID | Name | Tests | Commit |
|----|------|-------|--------|
| F-001 | Seed.json schema and validation | 84 | `af18ec4` |
| F-002 | Seed file loader with defaults | 45 | `43b11ad` |
| F-003 | Git-backed persistence | 36 | `81442ba` |
| F-004 | First-run setup wizard | 19 | `739c379` |
| F-005 | Session start hook | 26 | `531b0b4` |

Total: 210 tests, 536 expect() calls, 0 failures.
