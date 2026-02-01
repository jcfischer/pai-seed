---
feature: "Schema migration system"
feature_id: "F-014"
created: "2026-02-01"
---

# Implementation Tasks: Schema Migration System

## Task Groups

### Group 1: Core Types + Registry

#### T-14.1: Zod Schemas and Types
**File**: `src/migration.ts`
**Test**: `tests/migration.test.ts`

Define schemas and types:
- `MigrationFn` type: `(config: Record<string, unknown>) => Record<string, unknown>`
- `MigrationResult` discriminated union (ok/error)
- `MigrationOptions` type (seedPath, paiDir, eventsDir)
- `MigrationStep` type: `{ fromMajor: number; toMajor: number; fn: MigrationFn }`

Tests:
- [ ] MigrationResult type works with both success and error variants
- [ ] Types compile correctly (type-level tests)

#### T-14.2: Migration Registry
**File**: `src/migration.ts`
**Test**: `tests/migration.test.ts`

Implement registry:
- Internal `Map<string, MigrationFn>` keyed by `"N→M"` format
- `registerMigration(fromMajor, toMajor, fn)` — add to registry, throw on duplicate
- `getMigrationPath(fromMajor, toMajor)` — return ordered array of MigrationFn
- `clearMigrations()` — test helper to reset registry
- Validate sequential: `toMajor === fromMajor + 1`

Tests:
- [ ] registerMigration adds function to registry
- [ ] registerMigration throws on duplicate key
- [ ] registerMigration throws if toMajor !== fromMajor + 1
- [ ] getMigrationPath returns correct sequence for 1→3 (via 1→2, 2→3)
- [ ] getMigrationPath returns empty array when from === to
- [ ] getMigrationPath throws when gap exists in path
- [ ] clearMigrations resets registry

### Group 2: Detection + Built-in Migrations

#### T-14.3: needsMigration Detection
**File**: `src/migration.ts`
**Test**: `tests/migration.test.ts`

Pure function:
- Parse `version` field from raw config
- Extract major version number
- Compare to `CURRENT_MAJOR_VERSION`
- Return `{ needed: boolean; fromMajor?: number; toMajor?: number; fromVersion?: string }`
- Handle missing/invalid version field (treat as version 0)

Tests:
- [ ] Returns needed: false for current version
- [ ] Returns needed: true with correct versions for older major
- [ ] Returns needed: true for future major version (downgrade not supported, but detected)
- [ ] Treats missing version field as major version 0
- [ ] Treats non-string version as major version 0
- [ ] Treats invalid semver as major version 0

#### T-14.4: Built-in v0→v1 Migration
**File**: `src/migration.ts`
**Test**: `tests/migration.test.ts`

Reference migration for versionless → v1 configs:
- Add `version: "1.0.0"` if missing
- Ensure `identity`, `learned`, `state` top-level keys exist
- Preserve any existing user data
- Registered automatically at module load

Tests:
- [ ] Adds version field to bare config
- [ ] Preserves existing identity data
- [ ] Adds missing top-level sections with empty defaults
- [ ] Handles completely empty object
- [ ] Idempotent: running on already-v1 config returns same structure

### Group 3: Orchestrator

#### T-14.5: migrateSeed Orchestrator
**File**: `src/migration.ts`
**Test**: `tests/migration.test.ts`

Core pipeline:
- Extract source version from config
- Get migration path from registry
- Run each transform sequentially
- After each step, verify version field was bumped
- Validate final result against `validateSeed()`
- Return MigrationResult

Tests:
- [ ] Successfully migrates v0→v1 config
- [ ] Runs sequential migrations (v0→v1→v2 with mock v1→v2)
- [ ] Aborts on transform error, returns error result
- [ ] Aborts if transform doesn't bump version
- [ ] Validates final config against schema
- [ ] Returns error if final config fails validation

#### T-14.6: Backup Before Migration
**File**: `src/migration.ts`
**Test**: `tests/migration.test.ts`

Backup strategy:
- `backupSeed(seedPath, paiDir, fromVersion)` internal function
- If git repo: `commitSeedChange("Migrate: backup before v{from}→v{to}")` via F-003
- If no git: copy to `seed.json.backup-v{majorVersion}` in same directory
- Return `{ ok: true, method: "git"|"file" }` or `{ ok: false, error }`
- Backup failure is non-fatal (logged as warning)

Tests:
- [ ] Creates file backup when no git repo
- [ ] Backup file contains original content
- [ ] Returns ok: true with method "file"
- [ ] Returns ok: false on write failure (non-fatal)

### Group 4: Integration

#### T-14.7: loadSeed Integration
**File**: `src/loader.ts`
**Test**: `tests/migration.test.ts`

Modify `loadSeed()`:
- After JSON parse, call `needsMigration(parsed)`
- If needed: call `migrateSeed()` with parsed config
- If migration succeeds: continue normal merge+validate flow with migrated config
- If migration fails: return LoadError with migration details
- Add `migrated?: { from: string; to: string }` to successful LoadResult
- Use dynamic import to avoid circular dependency

Tests:
- [ ] loadSeed transparently migrates v0 config
- [ ] loadSeed returns migrated field in result
- [ ] loadSeed returns error when migration fails
- [ ] loadSeed with current version skips migration (no perf impact)
- [ ] Existing loadSeed tests still pass (regression)

#### T-14.8: Exports and Event Logging
**File**: `src/index.ts`, `src/migration.ts`
**Test**: `tests/migration.test.ts`

Add exports to barrel:
- Types: `MigrationResult`, `MigrationFn`, `MigrationOptions`
- Functions: `registerMigration`, `getMigrationPath`, `migrateSeed`, `needsMigration`, `clearMigrations`
- Log `migration_completed` event via F-008 on successful migration

Tests:
- [ ] All types and functions importable from index
- [ ] Migration event logged on success

## Task Summary

| Task | Description | Tests |
|------|-------------|-------|
| T-14.1 | Schemas and types | 2 |
| T-14.2 | Migration registry | 7 |
| T-14.3 | needsMigration detection | 6 |
| T-14.4 | Built-in v0→v1 migration | 5 |
| T-14.5 | migrateSeed orchestrator | 6 |
| T-14.6 | Backup before migration | 4 |
| T-14.7 | loadSeed integration | 5 |
| T-14.8 | Exports and event logging | 2 |
| **Total** | | **37** |

## Execution Order

1. T-14.1 → T-14.2 (types first, then registry)
2. T-14.3 → T-14.4 (detection, then built-in migration)
3. T-14.5 → T-14.6 (orchestrator, then backup)
4. T-14.7 → T-14.8 (integration, then exports)

## Dependencies

- T-14.5 depends on T-14.2 (registry) and T-14.3 (detection)
- T-14.7 depends on T-14.5 (orchestrator)
- All others are independent within their group
