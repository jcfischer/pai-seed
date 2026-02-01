# Documentation Updates: F-014 Schema Migration System

## Files Updated

### API Surface Added

New exports in `src/index.ts`:

**Types:** `MigrationResult`, `MigrationFn`, `MigrationOptions`, `NeedsMigrationResult`
**Functions:** `registerMigration`, `getMigrationPath`, `migrateSeed`, `needsMigration`, `clearMigrations`

### Modified Files

- `src/loader.ts` — Added migration intercept in `loadSeed()`. LoadResult type gains `migrated?: { from: string; to: string }` field.

### New File Locations

- `src/migration.ts` — All migration logic (~220 lines)
- `tests/migration.test.ts` — 35 tests
