---
feature: "Relationship file system"
feature_id: "F-013"
created: "2026-02-01"
depends_on: ["F-002", "F-003"]
---

# Specification: Relationship File System

## Overview

Separate relationship files stored at `~/.pai/relationships/rel_<name>.json`. Each contains structured data about a person: name, first encountered, last interaction, context, key moments. Seed.json references relationships by name but does not contain them, keeping personal data about others out of the main tracked file.

## Requirements

### R-1: Relationship Schema
- Zod schema for relationship data: name, firstEncountered, lastInteraction, context, keyMoments array
- KeyMoment: date, description, optional tags
- Schema validates on load and save

### R-2: File Management
- Directory: `~/.pai/relationships/`
- File pattern: `rel_<slugified-name>.json`
- Name slugification: lowercase, spaces→hyphens, strip non-alphanum except hyphens
- Atomic writes (temp + rename) via existing pattern

### R-3: CRUD Operations
- `addRelationship(name, context?)` — Create new relationship file
- `loadRelationship(name)` — Load by name (finds slug)
- `updateRelationship(name, updates)` — Partial update
- `removeRelationship(name)` — Delete file
- `listRelationships()` — List all relationship names from directory

### R-4: Key Moments
- `addKeyMoment(name, description, tags?)` — Append to keyMoments array
- Auto-sets date to now
- Updates lastInteraction timestamp

### R-5: Git Integration
- All relationship changes auto-committed via `writeSeedWithCommit` pattern
- Commit messages: "Update: relationship <name>"

### R-6: CLI Commands
- `pai-seed rel list` — List all relationships
- `pai-seed rel show <name>` — Show relationship details
- `pai-seed rel add <name> [context]` — Create new relationship
- `pai-seed rel moment <name> <description>` — Add key moment

## Out of Scope
- Seed.json schema migration to add relationship references (future)
- Full-text search across relationships
- Relationship import/export
- Relationship merging or deduplication

## Architecture

- New file: `src/relationships.ts` — All CRUD operations and schema
- Modified file: `src/cli.ts` — New `rel` subcommand
- New test: `tests/relationships.test.ts`
- Exports added to `src/index.ts`
