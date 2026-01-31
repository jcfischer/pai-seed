---
id: "F-002"
feature: "Seed file loader with defaults"
status: "draft"
created: "2026-01-31"
depends_on: ["F-001"]
---

# Specification: Seed File Loader with Defaults

## Overview

Provide the I/O layer for seed.json. F-001 defined the pure data model (schemas, types, validation). F-002 connects that model to the filesystem: read the file, parse JSON, validate, merge missing fields with defaults, write if needed, and return a guaranteed-valid `SeedConfig`. This is the single entry point all downstream features use to access seed data.

## User Scenarios

### Scenario 1: First run — no seed.json exists

**As a** PAI system starting for the first time
**I want** a valid seed.json created automatically from defaults
**So that** the system works immediately without manual setup

**Acceptance Criteria:**
- [ ] When `~/.pai/seed.json` doesn't exist, create `~/.pai/` directory and write default seed
- [ ] Created file validates against schema
- [ ] Returns valid SeedConfig with default values
- [ ] No error — missing file is a normal path, not an exception

### Scenario 2: Normal startup — valid seed.json exists

**As a** PAI system starting with an existing seed.json
**I want** seed.json loaded, validated, and returned as a typed object
**So that** downstream features have safe access to seed data

**Acceptance Criteria:**
- [ ] Reads file, parses JSON, validates with `validateSeed()`
- [ ] Returns `SeedConfig` typed object
- [ ] Completes in <2s including file I/O
- [ ] Unknown top-level keys produce warnings (forwarded from validateSeed)

### Scenario 3: Partial seed — missing optional or added fields

**As a** PAI system loading a seed.json from an older version or manual edit
**I want** missing fields filled in from defaults without losing existing data
**So that** the system is self-healing and forward-compatible

**Acceptance Criteria:**
- [ ] Deep merge: existing values take precedence over defaults
- [ ] Missing sections (e.g., no `state` key) filled from defaults
- [ ] Missing nested fields (e.g., no `preferences.timezone`) filled from defaults
- [ ] Arrays are NOT merged — existing arrays replace default empty arrays
- [ ] If merge changed the data, write the merged version back to disk
- [ ] Unknown top-level keys are preserved (passthrough)

### Scenario 4: Corrupted or invalid seed.json

**As a** PAI system encountering a corrupted seed file
**I want** clear error reporting with recovery options
**So that** the system can self-heal or inform the user

**Acceptance Criteria:**
- [ ] Invalid JSON (syntax error) → return `LoadError` with parse details
- [ ] Schema validation failure → return `LoadError` with all ValidationErrors
- [ ] Version mismatch → return `LoadError` with migration-needed message
- [ ] Caller decides recovery strategy (F-002 does NOT auto-overwrite invalid files)

### Scenario 5: Writing seed.json changes

**As a** downstream feature that modified the SeedConfig
**I want** to persist changes to disk safely
**So that** modifications survive between sessions

**Acceptance Criteria:**
- [ ] `writeSeed()` validates before writing (never writes invalid data)
- [ ] Atomic write: write to temp file, then rename (no partial writes)
- [ ] Creates parent directory if missing
- [ ] Formatted JSON (2-space indent) for human readability and git diffs

## Functional Requirements

### FR-1: Load Seed from Disk

Provide `loadSeed(seedPath?: string): Promise<LoadResult>` that:

```typescript
type LoadResult =
  | { ok: true; config: SeedConfig; created: boolean; merged: boolean; warnings?: string[] }
  | { ok: false; error: LoadError }

type LoadError = {
  code: "parse_error" | "validation_error" | "read_error" | "permission_error";
  message: string;
  details?: ValidationError[];
}
```

- `seedPath` defaults to `~/.pai/seed.json` (resolved via `$HOME`)
- `created: true` when file didn't exist and defaults were written
- `merged: true` when missing fields were filled from defaults
- `warnings` forwarded from `validateSeed()` (unknown top-level keys)

**Validation:** Unit test with mock filesystem: file exists, file missing, file invalid.

### FR-2: Create Default Seed File

When seed.json doesn't exist:
1. Create `~/.pai/` directory (recursive mkdir)
2. Generate default seed via `createDefaultSeed()` from F-001
3. Write to disk using atomic write
4. Return `{ ok: true, config, created: true, merged: false }`

**Validation:** Unit test: load from non-existent path creates file with correct content.

### FR-3: Deep Merge with Defaults

When seed.json exists but is missing fields:
1. Parse and validate existing data
2. Deep merge with `createDefaultSeed()` — existing values win
3. If merge produced changes, write merged version back
4. Return `{ ok: true, config, created: false, merged: true }`

Merge rules:
- **Objects:** Recursively merge. Existing keys preserved, missing keys filled from defaults.
- **Arrays:** NOT merged. Existing array replaces default. (Merging arrays of learnings would create duplicates.)
- **Primitives:** Existing value wins over default.
- **Unknown keys:** Preserved (passthrough behavior from schema).

**Validation:** Unit test: seed missing `state` section gets it from defaults. Seed with existing learnings keeps them.

### FR-4: Write Seed to Disk

Provide `writeSeed(config: SeedConfig, seedPath?: string): Promise<WriteResult>` that:

```typescript
type WriteResult =
  | { ok: true }
  | { ok: false; error: WriteError }

type WriteError = {
  code: "validation_error" | "write_error" | "permission_error";
  message: string;
  details?: ValidationError[];
}
```

- Validates config before writing (reject invalid data)
- Atomic write: write to `<path>.tmp`, then `rename()` to final path
- JSON formatted with 2-space indentation + trailing newline
- Creates parent directory if missing
- `seedPath` defaults to `~/.pai/seed.json`

**Validation:** Unit test: write valid seed, read back, compare. Write invalid seed returns error.

### FR-5: Path Resolution

Default seed path: `~/.pai/seed.json`
- Resolve `~` to `$HOME` environment variable (or `os.homedir()`)
- All functions accept optional `seedPath` override for testing and non-standard installations
- Path is always absolute after resolution

**Validation:** Unit test: default path resolves correctly. Custom path works.

### FR-6: JSON Schema File Export

Provide `writeJsonSchema(schemaPath?: string): Promise<WriteResult>` that:
- Generates JSON Schema via `generateJsonSchema()` from F-001
- Writes to `~/.pai/seed.schema.json` by default
- Uses atomic write (same as writeSeed)
- Called during default seed creation (FR-2) so schema file exists alongside data file

**Validation:** Unit test: schema file written, content is valid JSON Schema.

## Non-Functional Requirements

- **Performance:** `loadSeed()` completes in <2s including all I/O, parsing, validation, and optional merge/write-back
- **Atomicity:** All writes use temp-file + rename pattern. No partial writes on crash.
- **Idempotency:** `loadSeed()` called twice with no changes returns same result. `writeSeed()` with same data is safe to repeat.
- **No side effects beyond disk:** No network, no environment modification, no global state mutation.
- **Error isolation:** loadSeed never throws. All errors returned as `LoadResult.error`. Callers decide recovery.
- **Testability:** All functions accept path overrides. Tests use temp directories, not `~/.pai/`.

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| SeedConfig | Typed seed data | F-001 (`src/schema.ts`) |
| LoadResult | Discriminated union for load outcomes | New in F-002 |
| LoadError | Structured error with code and details | New in F-002 |
| WriteResult | Discriminated union for write outcomes | New in F-002 |
| WriteError | Structured error with code and details | New in F-002 |
| ValidationError | Per-field error from validation | F-001 (`src/validate.ts`) |

## Success Criteria

- [ ] `loadSeed()` returns valid SeedConfig when file exists and is valid
- [ ] `loadSeed()` creates default seed file when none exists
- [ ] `loadSeed()` deep-merges missing fields with defaults
- [ ] `loadSeed()` returns structured LoadError on invalid file (never throws)
- [ ] `writeSeed()` validates before writing (rejects invalid data)
- [ ] `writeSeed()` uses atomic write (temp file + rename)
- [ ] `writeJsonSchema()` generates and writes JSON Schema file
- [ ] All I/O functions accept path overrides for testability
- [ ] `loadSeed()` completes in <2s
- [ ] `bun test` passes with all loader tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Single process writes seed.json | Concurrent writers (multiple Claude sessions) | F-003 git merge strategy |
| `$HOME` is always set | Container or restricted environment | Fallback to `/tmp` or error |
| Filesystem is writable at `~/.pai/` | Read-only filesystem or permissions | LoadError with permission_error code |
| Bun `fs` API is stable | Breaking Bun update | Pin Bun version in CI |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-001 | `SeedConfig`, `validateSeed()`, `createDefaultSeed()`, `generateJsonSchema()` | Type signatures, validation behavior |
| Bun `fs` | File read/write/mkdir/rename | I/O implementation |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|----|
| F-003 Git persistence | `loadSeed()`, `writeSeed()` | Read seed, write changes, then git commit |
| F-005 Session hook | `loadSeed()` | Load seed at session start |
| F-006 Extraction hook | `loadSeed()`, `writeSeed()` | Read seed, add proposals, write back |
| F-007 Confirmation flow | `loadSeed()`, `writeSeed()` | Read proposals, move to learned, write back |
| F-011 CLI | `loadSeed()`, `writeSeed()` | All CLI commands need to read/write seed |
| F-014 Migration | `loadSeed()` | Detect version, load for migration |

## Out of Scope

- Git operations (commit, auto-repair) — that's F-003
- First-run setup wizard (interactive identity setup) — that's F-004
- File watching / live reload — not needed (load once per session)
- Encryption at rest — not in v1 scope
- Concurrent write handling (locking) — deferred to F-003 git strategy
