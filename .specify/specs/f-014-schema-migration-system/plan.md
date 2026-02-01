---
feature: "Schema migration system"
feature_id: "F-014"
created: "2026-02-01"
---

# Technical Plan: Schema Migration System

## Architecture Overview

Single module (`src/migration.ts`) containing the migration registry, orchestrator, and built-in migrations. Integrates with `loadSeed()` via a pre-validation migration step.

## Design Decisions

### D-1: Registry Pattern (Map-based)
**Choice**: In-memory Map keyed by `"fromMajor→toMajor"` storing transform functions.
**Rationale**: Simple, testable, no file I/O. Migrations are registered at module load time. Downstream consumers can add custom migrations via `registerMigration()`.

### D-2: Transform Functions are Pure
**Choice**: Migration functions take a plain object and return a plain object. No file I/O, no side effects.
**Rationale**: Enables isolated unit testing with plain JSON objects. The orchestrator handles backup, write, and validation.

### D-3: Backup via Git (with file fallback)
**Choice**: Before migration, create a git commit if repo exists, otherwise copy to `seed.json.backup-vN`.
**Rationale**: Leverages existing F-003 infrastructure. File fallback for non-git environments.

### D-4: Integration Point in loadSeed
**Choice**: After JSON parse, before `deepMerge` + `validateSeed`, check major version. If mismatch, run migration pipeline.
**Rationale**: Migration must happen before validation (which rejects mismatched versions). After migration, normal merge+validate flow continues.

### D-5: Version Bump in Transform
**Choice**: Each migration function is responsible for setting the new `version` field.
**Rationale**: Keeps version semantics explicit in each migration. The orchestrator validates that version was correctly bumped after each step.

## Data Model

### MigrationFn
```typescript
type MigrationFn = (config: Record<string, unknown>) => Record<string, unknown>;
```

### MigrationResult
```typescript
type MigrationResult =
  | { ok: true; config: SeedConfig; migratedFrom: string; migratedTo: string }
  | { ok: false; error: string; failedStep?: string };
```

### MigrationOptions
```typescript
type MigrationOptions = {
  seedPath?: string;
  paiDir?: string;    // for git operations
  eventsDir?: string; // for event logging
};
```

## API Contract

### registerMigration(fromMajor: number, toMajor: number, fn: MigrationFn): void
- Adds transform to registry
- Throws if duplicate key `"fromMajor→toMajor"` already registered
- Validates `toMajor === fromMajor + 1` (sequential only)

### getMigrationPath(fromMajor: number, toMajor: number): MigrationFn[]
- Returns ordered array of transforms for the version range
- Throws if no path exists (gap in registry)
- Empty array if versions are equal

### migrateSeed(rawConfig: Record<string, unknown>, options?: MigrationOptions): Promise<MigrationResult>
- Core orchestrator: detect version, get path, backup, run transforms, validate, write
- Backup before first transform
- Validate final result against `validateSeed()`
- Write migrated config back to disk
- Log migration event via F-008

### needsMigration(rawConfig: Record<string, unknown>): { needed: boolean; from?: number; to?: number }
- Pure detection function
- Parses version from config, compares to CURRENT_MAJOR_VERSION
- Returns version info if migration needed

## Integration Changes

### loadSeed() Modification (loader.ts)
After JSON parse, before merge+validate:
```
parsed = JSON.parse(rawText)
→ NEW: if needsMigration(parsed) → migrateSeed(parsed) → use migrated config
→ existing: deepMerge(config, defaults) → validateSeed(merged)
```

LoadResult type gains: `migrated?: { from: string; to: string }`

## Implementation Phases

### Phase 1: Core Types + Registry (T-14.1, T-14.2)
Schema, types, registry Map, register/get functions.

### Phase 2: Detection + Transforms (T-14.3, T-14.4)
needsMigration(), built-in v0→v1 migration, migration path resolution.

### Phase 3: Orchestrator (T-14.5, T-14.6)
migrateSeed() — backup, run transforms, validate, write. Backup logic.

### Phase 4: Integration (T-14.7, T-14.8)
Modify loadSeed() to call migration pipeline. Update LoadResult type. Event logging.

## File Changes

| File | Change |
|------|--------|
| `src/migration.ts` | NEW — all migration logic (~200 lines) |
| `src/loader.ts` | MODIFY — add migration intercept in `loadSeed()` |
| `src/index.ts` | MODIFY — add F-014 exports |
| `tests/migration.test.ts` | NEW — migration tests |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Migration corrupts seed.json | Git backup + atomic writes + validation after migration |
| No migration path for version gap | getMigrationPath throws clear error, original file untouched |
| loadSeed() changes break existing tests | Migration only triggers on version_mismatch, current v1 files pass through unchanged |
| Circular dependency with loader.ts | migration.ts imports from loader.ts for writeSeed; loadSeed imports migration. Use lazy import or pass functions as parameters |

## Dependency Resolution

**Circular import risk**: `migration.ts` needs `writeSeed()` from loader.ts, and `loader.ts` needs `migrateSeed()` from migration.ts.
**Solution**: `loadSeed()` dynamically imports migration functions only when needed (lazy import), or migration functions are passed write/backup capabilities via options rather than importing directly.
