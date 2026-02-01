---
id: "F-014"
feature: "Schema migration system"
status: "draft"
created: "2026-02-01"
---

# Specification: Schema Migration System

## Context

> Generated from SpecFlow on 2026-02-01
> Builds on: F-001 (schema — version field, CURRENT_MAJOR_VERSION), F-002 (loader — loadSeed/writeSeed)
> Integrates with: F-003 (git — backup commits before migration)

## Problem Statement

**Core Problem**: When `CURRENT_MAJOR_VERSION` changes (e.g., 1→2), `validate.ts` detects the mismatch and returns `version_mismatch` error, but there is no migration path — the user is stuck with an unusable seed.json file.

**Urgency**: Priority 3 — foundational infrastructure that F-011 CLI (`pai-seed migrate`) and future schema evolution depend on. Must exist before any breaking schema change ships.

**Impact if Unsolved**: Users hit an opaque validation error on upgrade with no recovery path. Manual JSON editing required, which risks data loss and frustration.

## Users & Stakeholders

**Primary User**: PAI system (automated) — detects version mismatch during `loadSeed()` and runs migrations transparently
**Secondary**: User sees migration status in session output ("Migrated seed.json from v1 to v2")

## Current State

**Existing System**:
- `schema.ts` exports `CURRENT_MAJOR_VERSION = 1` and version field validated as semver
- `validate.ts` returns `{ code: "version_mismatch", message: "Schema version X requires migration" }` when major version differs
- `loader.ts` `loadSeed()` merges with defaults then validates — version mismatch returns `LoadError`
- `git.ts` provides `writeSeedWithCommit()` for atomic write + git commit (backup)
- No migration logic exists — version mismatch is a dead end

**Integration Points**:
- `loadSeed()` — migration intercepts between parse and validate
- `git.ts` — backup commit before migration
- `defaults.ts` — new defaults for added fields after migration

## Overview

Version-aware migration pipeline for seed.json schema changes. On load, detect schema version mismatch. Run migration functions sequentially (v1→v2→v3). Back up current file (git commit) before migration. Support forward migrations with a registry of versioned transform functions. Each migration is a pure function: `(oldConfig: unknown) => newConfig`.

## User Scenarios

### Scenario 1: Transparent Migration on Load

**As** a user upgrading pai-seed to a new version
**I want to** have my seed.json automatically migrated when I start a session
**So that** I don't lose my personalization data or hit confusing errors

**Acceptance Criteria:**
- [ ] `loadSeed()` detects version mismatch and runs migration before validation
- [ ] Migration produces valid config that passes `validateSeed()`
- [ ] Original file backed up via git commit before migration
- [ ] User sees "Migrated seed.json from v1.x.x to v2.x.x" in load result
- [ ] All existing user data preserved (identity, learned patterns, state)

### Scenario 2: Sequential Multi-Version Migration

**As** a user who skipped several versions
**I want to** have all intermediate migrations run in order
**So that** I can upgrade from v1 to v3 even though I skipped v2

**Acceptance Criteria:**
- [ ] Migration registry maps each major version to a transform function
- [ ] `migrateSeed(config, fromVersion, toVersion)` runs transforms sequentially
- [ ] Each step produces valid intermediate state (v1→v2, v2→v3)
- [ ] Error in any step aborts migration, original file preserved

### Scenario 3: Migration Failure Recovery

**As** a user whose migration fails
**I want to** keep my original seed.json intact
**So that** I can retry or get help without data loss

**Acceptance Criteria:**
- [ ] Git commit created BEFORE migration attempt
- [ ] On failure, original file is NOT overwritten
- [ ] Error result includes migration step that failed and reason
- [ ] `repairFromGit()` (F-003) can recover the pre-migration state

### Scenario 4: Programmatic Migration API

**As** a developer integrating pai-seed
**I want to** register custom migration functions
**So that** downstream tools can extend the migration pipeline

**Acceptance Criteria:**
- [ ] `registerMigration(fromMajor, toMajor, fn)` adds a migration step
- [ ] Built-in migrations registered at module load time
- [ ] Custom migrations can be added before calling `loadSeed()`
- [ ] Registry validates no duplicate registrations for same version pair

## Functional Requirements

### FR-1: Migration Registry

A registry mapping `(fromMajor, toMajor)` to transform functions:
- Type: `MigrationFn = (config: Record<string, unknown>) => Record<string, unknown>`
- Registry: `Map<string, MigrationFn>` keyed by `"1→2"` format
- `registerMigration(from, to, fn)` — add a migration step
- `getMigrationPath(fromMajor, toMajor)` — return ordered list of steps
- Validate sequential coverage: no gaps allowed (e.g., can't have 1→2 and 3→4 without 2→3)

### FR-2: migrateSeed

Core migration orchestrator:
- Input: raw parsed config (unknown), target version (CURRENT_MAJOR_VERSION)
- Detect source version from config's `version` field
- Get migration path from registry
- Run each migration function sequentially
- Each step updates the `version` field to the new version
- Return `{ ok: true, config, migratedFrom, migratedTo }` or `{ ok: false, error }`

### FR-3: Integration with loadSeed

Modify `loadSeed()` to attempt migration when `validateSeed()` returns `version_mismatch`:
- After JSON parse, before merge+validate
- Check if `version` field has different major version
- If mismatch: back up via git commit, run migration, then continue normal flow
- LoadResult gains optional `migrated?: { from: string; to: string }` field

### FR-4: Backup Before Migration

Before modifying seed.json:
- If git repo exists: create commit with message "Migrate: backup before v{from}→v{to}"
- If no git repo: copy to `seed.json.backup-v{from}` alongside original
- Backup failure is non-fatal (warn, don't abort)

### FR-5: Built-in Migration v0→v1

A reference/bootstrap migration:
- Handles legacy seed files without a `version` field
- Adds `version: "1.0.0"`, wraps bare identity/learned/state if needed
- Serves as the pattern for future migrations

### FR-6: MigrationResult Types

```typescript
type MigrationResult =
  | { ok: true; config: SeedConfig; migratedFrom: string; migratedTo: string }
  | { ok: false; error: string; failedStep?: string };

type MigrationFn = (config: Record<string, unknown>) => Record<string, unknown>;
```

## Non-Functional Requirements

### NFR-1: Safety
- NEVER overwrite seed.json without successful backup
- Migration functions must be pure (no side effects beyond the config transform)
- Atomic write pattern for migrated config (tmp+rename)

### NFR-2: Performance
- Migration should complete < 100ms (transforms are in-memory JSON operations)
- No network calls during migration

### NFR-3: Testability
- Migration functions testable in isolation with plain objects
- No file I/O in transform functions themselves

## Out of Scope

- Rollback migrations (downgrade v2→v1) — complex, deferred
- GUI for migration (deferred to F-011 CLI)
- Schema migration for event logs or checkpoints (only seed.json)
- Automatic version bumping (CURRENT_MAJOR_VERSION is manually set)
