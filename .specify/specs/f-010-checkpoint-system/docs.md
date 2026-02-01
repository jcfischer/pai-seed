# Documentation Updates: F-010 Checkpoint System

## Files Updated

### API Surface Added

New exports in `src/index.ts`:

**Types:** `CheckpointState`, `CheckpointResult`, `CheckpointOptions`, `IscCriterionSnapshot`
**Schemas:** `checkpointStateSchema`, `iscCriterionSnapshotSchema`
**Functions:** `createCheckpoint`, `loadCheckpoint`, `listCheckpoints`, `detectIncompleteCheckpoint`, `completeCheckpoint`, `cleanupCheckpoints`, `resolveCheckpointsDir`

### New File Locations

- `src/checkpoint.ts` — All checkpoint logic (~280 lines)
- `tests/checkpoint.test.ts` — 23 tests
- `~/.pai/checkpoints/` — Checkpoint storage (created on first checkpoint)
