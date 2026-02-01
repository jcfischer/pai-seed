---
id: "F-009"
feature: "Event log compaction"
status: "draft"
created: "2026-02-01"
---

# Specification: Event Log Compaction

## Context

> Generated from SpecFlow Interview conducted on 2026-02-01
> Builds on: F-008 (Event log foundation)

## Problem Statement

**Core Problem**: The F-008 event log is append-only JSONL with no size management. Both disk usage and query performance degrade as the log grows unbounded.

**Urgency**: Priority ordering — F-009 is next in the queue after F-008 completion.

**Impact if Unsolved**: Over months of PAI usage, `readEvents()` slows as it scans all JSONL files, and `~/.pai/events/` consumes ever-growing disk space with no ceiling.

## Users & Stakeholders

**Primary User**: PAI system (automated) — compaction runs at session end via hook
**Secondary**: User observes compaction output when changes occur (verbose-on-change)

## Current State

**Existing System**: F-008 provides:
- Append-only JSONL at `~/.pai/events/events-YYYY-MM-DD.jsonl`
- `readEvents()` with type/session/date filters — scans all files sequentially
- `appendEvent()`, `logEvent()`, `countEvents()` — write/read/count API
- No SQLite index (pure JSONL scan)
- No archive directory
- No size management

**Integration Points**: F-010 (Checkpoint), F-012 (ACR), F-016 (Redaction) all consume events

## Overview

Monthly compaction of the event log. Events older than 90 days are summarized into statistical period summaries, raw JSONL is archived to `~/.pai/archive/`, and a new SQLite index accelerates active-window queries. Compaction is idempotent — safe to re-run on the same data.

## User Scenarios

### Scenario 1: Automatic Session-End Compaction

**As** the PAI system
**I want to** compact old events at session end
**So that** the active event store stays bounded and queries remain fast

**Acceptance Criteria:**
- [ ] Compaction runs at session end via hook
- [ ] Events older than 90 days are identified and processed
- [ ] Period summaries are generated with full statistics
- [ ] Raw JSONL files are moved to `~/.pai/archive/`
- [ ] SQLite index is updated (old rows removed, summaries inserted)
- [ ] One-line output shown only when compaction does something: "Compacted 142 events from Jan 2026 -> archive"

### Scenario 2: Idempotent Re-run

**As** the PAI system
**I want to** safely re-run compaction after a partial failure
**So that** no data is lost or duplicated

**Acceptance Criteria:**
- [ ] Running compaction twice on same data produces identical results
- [ ] Already-archived periods are detected and skipped
- [ ] No duplicate summaries created on re-run
- [ ] Failed compaction leaves source data intact for retry

### Scenario 3: Summary Querying

**As** the PAI system
**I want to** query period summaries alongside active events
**So that** historical statistics are available without reading archives

**Acceptance Criteria:**
- [ ] Period summaries stored in queryable format
- [ ] `readEvents()` continues to work for active window (< 90 days)
- [ ] Summary data includes counts, patterns, time distributions, session stats

## Functional Requirements

### FR-1: Period Detection

Identify which monthly periods are eligible for compaction (all events in month are > 90 days old).

**Validation:** Given events from Oct 2025 through Feb 2026, compaction on 2026-02-01 identifies Oct and Nov 2025 as eligible (all events > 90 days old).

### FR-2: Summary Generation

Generate full statistical summaries per compacted period:
- Event type counts (e.g., `{ "skill_invoked": 47, "session_start": 12 }`)
- Top-N most frequent data patterns (top skills, sessions, error types)
- Time distribution (events per day-of-week, per hour)
- Session statistics (count, avg events per session)
- Anomaly flags (days with zero events, unusually high counts)

**Validation:** Summary for a month with 200 events across 5 types contains all statistical fields with accurate counts.

### FR-3: Archive Management

Move compacted JSONL files to `~/.pai/archive/`:
- Directory structure: `~/.pai/archive/YYYY/events-YYYY-MM-DD.jsonl`
- Archive preserves original files unmodified
- Source files removed from `~/.pai/events/` after successful archive

**Validation:** After compaction, archived files exist at correct paths, original files are gone, file contents are byte-identical.

### FR-4: SQLite Index

Add SQLite index for active-window queries:
- Database at `~/.pai/events/index.db`
- Index contains: event id, timestamp, sessionId, type (not full data payload)
- Compaction removes old rows and inserts summary rows
- `readEvents()` can optionally use index for type/session/date filtering

**Validation:** Query by type using SQLite index returns same results as JSONL scan, but faster.

### FR-5: Idempotent Operation

Compaction is safe to re-run:
- Check if archive already exists for a period before processing
- Use temp files + atomic rename for archive writes
- Summary generation checks for existing summaries before creating

**Validation:** Run compaction 3x in sequence — same final state, no errors, no duplicates.

### FR-6: Incremental Compaction

Compaction processes only what's needed, not the entire log:
- Skip periods already archived
- Process at most N periods per run (avoid long session-end delays)
- Next run picks up remaining periods

**Validation:** With 6 eligible months, compaction processes a bounded number per run, completing all within a few sessions.

## Non-Functional Requirements

- **Performance:** Fast at session end. Partial compaction is acceptable — process a subset of eligible periods per run to stay responsive. No hard timeout, but design for incremental work.
- **Storage:** ~50MB soft guideline for active store (JSONL in `events/`). Log a warning if exceeded but don't enforce. SQLite index size is separate and uncapped.
- **Reliability:** Idempotent retry on failure. Never lose events — source data untouched until archive confirmed.
- **Failure Behavior:**
  - On disk full: Return error result, leave source intact, retry next session
  - On permission error: Return error result, log warning
  - On malformed JSONL line: Skip line in summary, archive file as-is
  - On SQLite corruption: Rebuild index from JSONL files

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| PeriodSummary | Statistical summary of a compacted month | period (YYYY-MM), eventCounts, topPatterns, timeDistribution, sessionStats, anomalies |
| CompactionResult | Outcome of a compaction run | periodsProcessed, periodsSkipped, eventsArchived, summariesCreated, errors |
| ArchiveEntry | Metadata for an archived period | period, archivedAt, sourceFiles, summaryId |

## Success Criteria

- [ ] Full round-trip verified: compact -> archive -> summary generation -> SQLite index updated
- [ ] Events > 90 days old are moved to archive with summaries generated
- [ ] SQLite index contains active window events + period summaries
- [ ] Idempotent: re-running compaction produces identical state
- [ ] No data loss: archived JSONL + summaries = complete audit trail
- [ ] `readEvents()` works unchanged for active window queries
- [ ] Session-end hook integration works with verbose-on-change output

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Event volume is moderate (< 1000/day) | Heavy automation generating 10k+ events/day | Monitor archive sizes |
| 90-day window is sufficient for active queries | User needs 6+ months of queryable data | Feature request for configurable retention |
| Monthly granularity is right for summaries | Need weekly or daily summaries | Feedback from F-012 ACR integration |
| Single-user, no concurrent compaction | Multi-device PAI with shared ~/.pai/ | Git conflicts on archive operations |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes | Version/Contract |
|--------|-------------|---------------------------|------------------|
| F-008 Event Log | JSONL files, readEvents(), appendEvent() | File format change breaks parser | SystemEvent schema v1 |
| F-003 Git Persistence | Auto-commit on changes | Git operations during compaction may conflict | Non-fatal git failures |

### Downstream Consumers

| System | What They Expect | Breaking Change Threshold |
|--------|-----------------|--------------------------|
| F-010 Checkpoint | Events queryable for resume detection | Active window must include recent events |
| F-012 ACR | Event summaries for semantic indexing | Summary format change requires ACR update |
| F-016 Redaction | Event IDs remain stable in archive | Changing event IDs in archive breaks redaction |

### Adjacent Systems (Implicit Coupling)

| System | Implicit Dependency | Risk |
|--------|---------------------|------|
| F-008 readEvents() | May need modification for SQLite-backed queries | Low — additive change |
| Session hooks | Hook must trigger compaction without blocking | Low — async/incremental design |

## Out of Scope

- **Configurable retention** — 90-day window is hardcoded for F-009. User-adjustable retention is a future enhancement.
- **Compression** — Archived JSONL stays plain text. gzip/zstd compression is a future optimization.
- **Archive querying** — Reading directly from `~/.pai/archive/` is not part of F-009. Archives are for audit/backup only.
- **CLI exposure** — No `pai-seed compact` command. Manual compaction CLI belongs to F-011.

---

*Interview conducted: 2026-02-01*
*Phases completed: 8/8*
