---
id: "F-012"
feature: "ACR integration"
status: "draft"
created: "2026-02-01"
---

# Specification: ACR Integration

## Context

> Generated from SpecFlow on 2026-02-01
> Builds on: F-002 (loader), F-008 (events), F-009 (compaction)
> Integrates with: ACR (Autonomous Contextual Recall) Tier 2 semantic search

## Problem Statement

**Core Problem**: Seed.json learnings and event log data are invisible to ACR's semantic search. Users can't ask "what did I learn about X?" and get results from accumulated PAI knowledge.

**Impact if Unsolved**: PAI's accumulated knowledge stays siloed. ACR can't leverage learnings for contextual recall.

## Overview

Export functions that transform seed.json learnings and event summaries into ACR-compatible document format. Each learning and event summary becomes a searchable document with source ID, content, metadata, and freshness signals.

## Functional Requirements

### FR-1: ACR Document Types
Define document format compatible with ACR Tier 2 indexing:
- `sourceId`: Unique identifier (`seed:learning:<id>`, `seed:event:<period>`)
- `content`: Human-readable text for embedding
- `source`: Source tag ("seed" or "seed:events")
- `metadata`: Type, timestamps, tags, freshness

### FR-2: exportLearnings
Transform seed.json learned section into ACR documents:
- Each pattern, insight, selfKnowledge entry → one document
- Content includes type prefix: "Pattern: ...", "Insight: ...", "Self-knowledge: ..."
- Metadata includes confirmed status, extractedAt, tags
- Freshness score based on confirmedAt timestamp

### FR-3: exportEventSummaries
Transform event log into ACR documents:
- Read events from last N days (default 90)
- Group by event type, produce statistical summaries
- Each summary period → one document
- Content: "Period <dates>: N events (X learning_extracted, Y proposal_accepted...)"

### FR-4: exportAllForACR
Combined export function:
- Calls exportLearnings + exportEventSummaries
- Returns unified array of ACR documents
- Used by ACR's indexing pipeline

## Non-Functional Requirements

- Export completes < 500ms for typical seed (100 learnings, 90 days events)
- Graceful degradation: missing event log returns empty array, not error
- No ACR dependency — pai-seed defines the document format, ACR consumes it

## Out of Scope

- ACR-side indexing implementation
- Embedding generation (ACR handles this)
- Real-time sync (batch export only)
