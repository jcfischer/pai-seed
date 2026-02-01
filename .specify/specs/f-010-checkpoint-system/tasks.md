# Implementation Tasks: Checkpoint System (F-010)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-10.1 | ☐ | Zod schemas + types + resolveCheckpointsDir |
| T-10.2 | ☐ | createCheckpoint |
| T-10.3 | ☐ | loadCheckpoint + listCheckpoints |
| T-10.4 | ☐ | detectIncompleteCheckpoint |
| T-10.5 | ☐ | completeCheckpoint |
| T-10.6 | ☐ | cleanupCheckpoints |
| T-10.7 | ☐ | Public API exports |
| T-10.8 | ☐ | Test suite |
| T-10.9 | ☐ | Regression check |

## Group 1: Foundation

### T-10.1: Define schemas, types, and resolveCheckpointsDir [T]

- **File:** `src/checkpoint.ts` (top section)
- **Test:** `tests/checkpoint.test.ts` (schema + resolveCheckpointsDir group)
- **Dependencies:** none
- **FRs:** FR-1, FR-7
- **Description:**
  - Create `src/checkpoint.ts`
  - Define `iscCriterionSnapshotSchema` — Zod object: `id`, `subject`, `status` (enum: pending/in_progress/completed)
  - Define `checkpointStateSchema` — Zod object: `id` (string min 1), `sessionId`, `phase`, `phaseNumber` (1-7), `createdAt` (datetime), `completed` (boolean), `taskSummary`, `iscCriteria` (array), `metadata` (record)
  - Export types: `IscCriterionSnapshot`, `CheckpointState`, `CheckpointResult`, `CheckpointOptions`
  - Implement `resolveCheckpointsDir(dir?)`: default `join(homedir(), ".pai", "checkpoints")`
  - Implement `checkpointFilename(timestamp, phase)`: returns `ckpt-<safe-timestamp>-<phase>.json`

## Group 2: Create + Read

### T-10.2: Implement createCheckpoint [T]

- **File:** `src/checkpoint.ts`
- **Test:** `tests/checkpoint.test.ts` (createCheckpoint group)
- **Dependencies:** T-10.1
- **FRs:** FR-2
- **Description:**
  - Implement `createCheckpoint(phase, phaseNumber, taskSummary, iscCriteria, metadata, options?): Promise<CheckpointResult>`
  - Create `CheckpointState` with nanoid + ISO timestamp + `completed: false`
  - `mkdir(checkpointsDir, { recursive: true })`
  - Atomic write: `writeFile(tmpPath, JSON.stringify(state, null, 2))` then `rename(tmpPath, finalPath)`
  - Update seed.json `state.checkpointRef` via `loadSeed()` + `writeSeed()`
  - Log event via `logEvent("custom", { action: "checkpoint_created", checkpointId, phase })`
  - Return `{ ok: true, checkpointId, file }` or `{ ok: false, error }`
  - Never throws

### T-10.3: Implement loadCheckpoint and listCheckpoints [T]

- **File:** `src/checkpoint.ts`
- **Test:** `tests/checkpoint.test.ts` (read group)
- **Dependencies:** T-10.1
- **FRs:** FR-3
- **Description:**
  - Implement `loadCheckpoint(checkpointId, options?): Promise<CheckpointState | null>`
    - Scan directory for file containing matching ID (read + parse + validate)
    - Return parsed checkpoint or null
  - Implement `listCheckpoints(options?): Promise<CheckpointState[]>`
    - Read all `ckpt-*.json` files
    - Parse and validate each
    - Optional filter: `{ completed?: boolean }`
    - Sort by `createdAt` descending (most recent first)
    - Return empty array if dir doesn't exist

## Group 3: Lifecycle

### T-10.4: Implement detectIncompleteCheckpoint [T]

- **File:** `src/checkpoint.ts`
- **Test:** `tests/checkpoint.test.ts` (detect group)
- **Dependencies:** T-10.3
- **FRs:** FR-4
- **Description:**
  - Implement `detectIncompleteCheckpoint(options?): Promise<CheckpointState | null>`
  - Call `listCheckpoints({ completed: false })`
  - Return first (most recent) or null
  - Used by session start hook

### T-10.5: Implement completeCheckpoint [T]

- **File:** `src/checkpoint.ts`
- **Test:** `tests/checkpoint.test.ts` (complete group)
- **Dependencies:** T-10.2, T-10.3
- **FRs:** FR-5
- **Description:**
  - Implement `completeCheckpoint(checkpointId, options?): Promise<{ ok: true } | { ok: false; error: string }>`
  - Find checkpoint file by ID
  - Read, set `completed: true`, write back (atomic)
  - Clear `seed.json` `state.checkpointRef` (set to undefined)
  - Log `checkpoint_completed` event
  - Return error if checkpoint not found

### T-10.6: Implement cleanupCheckpoints [T]

- **File:** `src/checkpoint.ts`
- **Test:** `tests/checkpoint.test.ts` (cleanup group)
- **Dependencies:** T-10.3
- **FRs:** FR-6
- **Description:**
  - Implement `cleanupCheckpoints(olderThanDays?, options?): Promise<{ deleted: number }>`
  - Default: 30 days
  - List all checkpoints, filter by `createdAt` older than cutoff
  - Delete matching files
  - If deleted checkpoint matches `seed.json` `checkpointRef`, clear the ref
  - Return count

## Group 4: Integration

### T-10.7: Add public API exports [T]

- **File:** `src/index.ts`
- **Dependencies:** T-10.6
- **FRs:** All
- **Description:**
  - Add F-010 section to `src/index.ts`
  - Export types: `CheckpointState`, `CheckpointResult`, `CheckpointOptions`, `IscCriterionSnapshot`
  - Export schemas: `checkpointStateSchema`, `iscCriterionSnapshotSchema`
  - Export functions: `createCheckpoint`, `loadCheckpoint`, `listCheckpoints`, `detectIncompleteCheckpoint`, `completeCheckpoint`, `cleanupCheckpoints`, `resolveCheckpointsDir`

## Group 5: Verification

### T-10.8: Write full test suite [T]

- **File:** `tests/checkpoint.test.ts`
- **Dependencies:** T-10.7
- **Description:**
  - resolveCheckpointsDir (2 tests)
  - createCheckpoint (5 tests): creates file, atomic write, returns result, updates seedRef, logs event
  - loadCheckpoint (3 tests): loads by ID, returns null for missing, validates schema
  - listCheckpoints (4 tests): lists all, filters completed, filters incomplete, empty dir
  - detectIncompleteCheckpoint (3 tests): finds most recent incomplete, returns null when none, ignores completed
  - completeCheckpoint (3 tests): marks completed, clears seedRef, error on missing
  - cleanupCheckpoints (3 tests): deletes old, preserves recent, clears stale seedRef
  - **Total: ~23 tests**

### T-10.9: Regression check

- **Dependencies:** T-10.8
- **Description:** Run `bun test` — all existing tests still pass. `tsc --noEmit` clean.

## Execution Order

```
T-10.1 (schemas — no deps)
  ↓
  ├── T-10.2 (create — needs types)
  └── T-10.3 (read — needs types)
        ↓
  ├── T-10.4 (detect — needs list)
  ├── T-10.5 (complete — needs create + read)
  └── T-10.6 (cleanup — needs list)
        ↓
      T-10.7 (exports)
        ↓
      T-10.8 (tests)
        ↓
      T-10.9 (regression)
```

**Critical path:** T-10.1 → T-10.3 → T-10.4 → T-10.7 → T-10.8 → T-10.9
