---
id: "F-010"
feature: "Checkpoint system"
status: "draft"
created: "2026-02-01"
---

# Specification: Checkpoint System

## Context

> Generated from SpecFlow Interview conducted on 2026-02-01
> Builds on: F-008 (Event log foundation)
> Integrates with: F-001 (schema — `checkpointRef`), F-005 (session — displays checkpoint)

## Problem Statement

**Core Problem**: When a PAI session is interrupted (crash, timeout, user stops), all algorithm phase state is lost. The user must restart from scratch with no memory of in-progress work.

**Urgency**: Priority 4 — completes the session lifecycle alongside F-009 compaction.

**Impact if Unsolved**: Users lose context on interrupted multi-phase work. Repeated effort. No resume capability.

## Users & Stakeholders

**Primary User**: PAI system (automated) — creates checkpoints at algorithm phase transitions
**Secondary**: User sees "Resume from Phase N?" prompt at session start when incomplete checkpoint exists

## Current State

**Existing System**:
- `seed.json` has `state.checkpointRef` field (F-001, optional string)
- `session.ts` displays `Checkpoint: <ref>` when `checkpointRef` is defined (F-005)
- F-008 provides event logging for checkpoint events
- No checkpoint creation, loading, resume, or cleanup logic exists

**Integration Points**:
- F-005 session start hook (detect + offer resume)
- F-008 event log (log checkpoint events)
- seed.json state layer (store latest checkpoint reference)

## Overview

JSON state snapshots at algorithm phase transitions, stored in `~/.pai/checkpoints/`. On session start, detect incomplete checkpoints and offer "Resume from Phase N?" via session context. Auto-cleanup checkpoints older than 30 days.

## User Scenarios

### Scenario 1: Checkpoint Creation at Phase Transition

**As** the PAI system
**I want to** save a state snapshot when transitioning between algorithm phases
**So that** the current work state can be recovered if the session is interrupted

**Acceptance Criteria:**
- [ ] `createCheckpoint(phase, state)` saves JSON snapshot to `~/.pai/checkpoints/`
- [ ] Checkpoint filename includes timestamp and phase: `ckpt-<timestamp>-<phase>.json`
- [ ] Checkpoint contains: phase, sessionId, task context, timestamp, metadata
- [ ] `seed.json` `state.checkpointRef` updated with new checkpoint reference
- [ ] Checkpoint event logged via F-008

### Scenario 2: Resume Detection at Session Start

**As** a user starting a new session
**I want to** see if there's incomplete work to resume
**So that** I can continue where I left off

**Acceptance Criteria:**
- [ ] `detectIncompleteCheckpoint()` scans checkpoints for non-final phases
- [ ] Returns checkpoint with phase info and task context if found
- [ ] Session context includes: "Checkpoint: Resume from Phase N? (<task summary>)"
- [ ] No output if no incomplete checkpoint exists (silent when nothing to show)

### Scenario 3: Checkpoint Cleanup

**As** the PAI system
**I want to** remove old checkpoints automatically
**So that** disk space doesn't grow unbounded

**Acceptance Criteria:**
- [ ] `cleanupCheckpoints(olderThanDays)` removes checkpoints older than 30 days
- [ ] Cleanup runs during compaction or session end
- [ ] Final-phase checkpoints (completed work) are cleaned first
- [ ] `seed.json` `checkpointRef` cleared if referenced checkpoint is deleted

### Scenario 4: Explicit Checkpoint Completion

**As** the PAI system
**I want to** mark a checkpoint as completed when the algorithm finishes
**So that** it won't be offered for resume

**Acceptance Criteria:**
- [ ] `completeCheckpoint(checkpointId)` marks checkpoint as finished
- [ ] Completed checkpoints are not offered for resume
- [ ] `seed.json` `checkpointRef` cleared on completion

## Functional Requirements

### FR-1: Checkpoint Schema

Define `CheckpointState` schema with Zod:
- `id`: string (nanoid)
- `sessionId`: string
- `phase`: string (algorithm phase name)
- `phaseNumber`: number (1-7)
- `createdAt`: string (ISO 8601)
- `completed`: boolean
- `taskSummary`: string (8-word task description)
- `iscCriteria`: array of `{ id: string, subject: string, status: string }`
- `metadata`: Record<string, unknown> (phase-specific state)

### FR-2: createCheckpoint

Create and persist a checkpoint snapshot.
- Input: phase info, task summary, ISC criteria, metadata
- Write JSON to `~/.pai/checkpoints/ckpt-<timestamp>-<phase>.json`
- Update `seed.json` `state.checkpointRef` with checkpoint ID
- Log `checkpoint_created` event via F-008
- Return `{ ok: true, checkpointId, file }` or `{ ok: false, error }`

### FR-3: loadCheckpoint / listCheckpoints

Read checkpoint(s) from disk.
- `loadCheckpoint(id)`: Read specific checkpoint by ID
- `listCheckpoints(options?)`: List all checkpoints, filter by completed/incomplete
- Parse and validate against schema
- Skip invalid files silently

### FR-4: detectIncompleteCheckpoint

Find the most recent incomplete checkpoint.
- Scan `~/.pai/checkpoints/` for `completed: false`
- Return most recent by `createdAt`
- Return `null` if none found
- Used by session start hook to offer resume

### FR-5: completeCheckpoint

Mark a checkpoint as finished.
- Read checkpoint file, set `completed: true`, write back
- Clear `seed.json` `state.checkpointRef`
- Log `checkpoint_completed` event

### FR-6: cleanupCheckpoints

Remove old checkpoint files.
- Delete checkpoints older than N days (default 30)
- Clear `checkpointRef` if referenced checkpoint is deleted
- Return count of deleted checkpoints

### FR-7: resolveCheckpointsDir

Pure function for directory resolution.
- Default: `~/.pai/checkpoints/`
- Accept override for testing

## Non-Functional Requirements

### NFR-1: Performance
- Checkpoint creation < 50ms (single JSON write)
- Detection at session start < 100ms (directory scan)

### NFR-2: Durability
- Checkpoint writes use atomic temp+rename pattern
- Never corrupt existing checkpoint on write failure

### NFR-3: Compatibility
- Uses existing `checkpointRef` field in seed.json (no schema changes)
- Does not modify F-008 events.ts

## Out of Scope

- Phase-specific state serialization (callers decide what metadata to include)
- CLI commands for checkpoint management (deferred to F-011)
- Automatic resume without user confirmation
- Multi-device checkpoint sync
