---
feature: "Checkpoint system"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Checkpoint System

## Architecture Overview

```
Algorithm Phase         checkpoint.ts                    File System
┌──────────────┐  createCheckpoint()  ┌──────────────┐  write   ┌──────────────────────────┐
│ OBSERVE      │─────────────────────▶│              │─────────▶│ ~/.pai/checkpoints/      │
│ THINK        │                      │  Checkpoint  │          │  ckpt-2026-02-01T10-obs  │
│ PLAN         │  completeCheckpoint()│   Module     │  read    │  .json                   │
│ BUILD        │─────────────────────▶│              │◀─────────│  ckpt-2026-02-01T10-ver  │
│ ...          │                      └──────────────┘          │  .json                   │
└──────────────┘                             │                  └──────────────────────────┘
                                             │
Session Start Hook                           │ update
┌──────────────┐  detectIncomplete()         │
│ F-005        │◀────────────────────────────┤
│ session.ts   │                             │
└──────────────┘                             ▼
                                      ┌──────────────┐
                                      │  seed.json   │
                                      │  state.      │
                                      │  checkpointRef│
                                      └──────────────┘

Flow:
  createCheckpoint(phase, taskSummary, iscCriteria, metadata, options?)
    → creates CheckpointState (nanoid + ISO timestamp)
    → writes JSON to ~/.pai/checkpoints/ckpt-<ts>-<phase>.json
    → updates seed.json state.checkpointRef
    → logs event via F-008
    → returns { ok: true, checkpointId, file }

  detectIncompleteCheckpoint(options?)
    → scans checkpoints dir for completed: false
    → returns most recent incomplete or null

  completeCheckpoint(checkpointId, options?)
    → reads checkpoint, sets completed: true, writes back
    → clears seed.json state.checkpointRef
    → logs completion event
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Validation | Zod | Project pattern. Checkpoint schema validated before write |
| IDs | nanoid | Already in package.json |
| File I/O | node:fs/promises | writeFile, readFile, readdir, rm, rename, access |
| Testing | bun:test | Project standard. Temp directories |
| New deps | **None** | All dependencies already present |

## Data Model

```typescript
import { z } from "zod";

export const iscCriterionSnapshotSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const checkpointStateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  phase: z.string().min(1),
  phaseNumber: z.number().min(1).max(7),
  createdAt: z.string().datetime(),
  completed: z.boolean(),
  taskSummary: z.string(),
  iscCriteria: z.array(iscCriterionSnapshotSchema),
  metadata: z.record(z.unknown()),
});

export type IscCriterionSnapshot = z.infer<typeof iscCriterionSnapshotSchema>;
export type CheckpointState = z.infer<typeof checkpointStateSchema>;

export type CheckpointResult =
  | { ok: true; checkpointId: string; file: string }
  | { ok: false; error: string };

export type CheckpointOptions = {
  checkpointsDir?: string;
  seedPath?: string;
};
```

### File Format

```
~/.pai/checkpoints/
├── ckpt-2026-02-01T10-30-00-observe.json
├── ckpt-2026-02-01T10-35-00-build.json
└── ckpt-2026-02-01T11-00-00-verify.json
```

Each file is a JSON-serialized `CheckpointState`.

## API Contracts

### FR-7: `resolveCheckpointsDir(dir?)`
Pure function. Default: `~/.pai/checkpoints/`.

### FR-2: `createCheckpoint(phase, phaseNumber, taskSummary, iscCriteria, metadata, options?)`
Creates checkpoint file + updates seed.json + logs event. Atomic write via temp+rename. Never throws.

### FR-3: `loadCheckpoint(checkpointId, options?)`
Reads single checkpoint by ID. Returns `CheckpointState | null`.

### FR-3: `listCheckpoints(options?)`
Lists all checkpoints. Optional filter: `{ completed?: boolean }`. Returns sorted by createdAt desc.

### FR-4: `detectIncompleteCheckpoint(options?)`
Returns most recent incomplete checkpoint or `null`.

### FR-5: `completeCheckpoint(checkpointId, options?)`
Sets `completed: true`, clears seed.json `checkpointRef`. Returns `{ ok: true } | { ok: false, error }`.

### FR-6: `cleanupCheckpoints(olderThanDays?, options?)`
Deletes old checkpoints. Default 30 days. Returns `{ deleted: number }`.

## Implementation Phases

### Phase 1: Schema, Types, Pure Functions
- Define Zod schemas and types
- `resolveCheckpointsDir()`
- `checkpointFilename()` helper

### Phase 2: Checkpoint Creation
- `createCheckpoint()` with atomic write
- Seed.json `checkpointRef` update via `writeSeedWithCommit()`

### Phase 3: Checkpoint Reading
- `loadCheckpoint()`, `listCheckpoints()`
- `detectIncompleteCheckpoint()`

### Phase 4: Checkpoint Lifecycle
- `completeCheckpoint()`
- `cleanupCheckpoints()`

### Phase 5: Public API + Tests

## File Structure

```
src/
├── checkpoint.ts      # NEW — All F-010 logic
└── index.ts           # MODIFIED — Add F-010 exports

tests/
├── checkpoint.test.ts # NEW — F-010 tests
```

## Dependencies

### Upstream
| Module | What | Why |
|--------|------|-----|
| events.ts | `logEvent()` | Log checkpoint events |
| loader.ts | `loadSeed()`, `writeSeed()` | Read/write checkpointRef |
| schema.ts | `SeedConfig` | Type for seed manipulation |

### Downstream
| Feature | What They Import | Status |
|---------|-----------------|--------|
| F-005 | `detectIncompleteCheckpoint()` | Integration point |
| F-011 CLI | Checkpoint management commands | Future |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Stale checkpointRef in seed.json | Low | Low | completeCheckpoint clears ref; cleanup clears ref |
| Concurrent checkpoint writes | Low | Very Low | Single-session, sequential phases |
| Checkpoint file corruption | Low | Very Low | Atomic temp+rename writes |
| Large metadata payloads | Low | Low | Caller responsibility; no size limit in v1 |
