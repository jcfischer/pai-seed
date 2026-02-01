---
feature: "Relationship file system"
feature_id: "F-013"
created: "2026-02-01"
---

# Implementation Tasks: Relationship File System

## Task Groups

### Group 1: Schema + Types

#### T-13.1: Relationship Schema
**File**: `src/relationships.ts`
**Test**: `tests/relationships.test.ts`

Define Zod schemas and types:
- `keyMomentSchema`: date, description, tags?
- `relationshipSchema`: name, firstEncountered, lastInteraction, context, keyMoments
- Result types: RelationshipResult, ListResult

Tests:
- [ ] Schema validates correct relationship
- [ ] Schema rejects missing required fields
- [ ] KeyMoment schema validates correctly

### Group 2: File Operations

#### T-13.2: Path Resolution and Slugification
**File**: `src/relationships.ts`
**Test**: `tests/relationships.test.ts`

- `resolveRelationshipsDir(paiDir?)` — Returns ~/.pai/relationships/
- `slugifyName(name)` — Converts name to filename-safe slug

Tests:
- [ ] resolveRelationshipsDir returns correct path
- [ ] slugifyName handles spaces
- [ ] slugifyName handles special characters
- [ ] slugifyName handles consecutive separators

#### T-13.3: Load and Save
**File**: `src/relationships.ts`
**Test**: `tests/relationships.test.ts`

- `loadRelationship(name, options?)` — Read, parse, validate
- `saveRelationship(relationship, options?)` — Atomic write + optional git commit

Tests:
- [ ] loadRelationship reads valid file
- [ ] loadRelationship returns error for missing file
- [ ] loadRelationship returns error for invalid JSON
- [ ] saveRelationship writes atomically
- [ ] saveRelationship creates directory if missing

### Group 3: CRUD Operations

#### T-13.4: Add and Remove
**File**: `src/relationships.ts`
**Test**: `tests/relationships.test.ts`

- `addRelationship(name, context?, options?)` — Create new file
- `removeRelationship(name, options?)` — Delete file

Tests:
- [ ] addRelationship creates new file
- [ ] addRelationship errors if already exists
- [ ] removeRelationship deletes file
- [ ] removeRelationship errors if not found

#### T-13.5: Update and List
**File**: `src/relationships.ts`
**Test**: `tests/relationships.test.ts`

- `updateRelationship(name, updates, options?)` — Partial update
- `listRelationships(options?)` — List all names

Tests:
- [ ] updateRelationship merges fields
- [ ] updateRelationship updates lastInteraction
- [ ] listRelationships returns all names
- [ ] listRelationships returns empty for no files

#### T-13.6: Key Moments
**File**: `src/relationships.ts`
**Test**: `tests/relationships.test.ts`

- `addKeyMoment(name, description, tags?, options?)` — Append moment

Tests:
- [ ] addKeyMoment appends to array
- [ ] addKeyMoment updates lastInteraction
- [ ] addKeyMoment includes tags when provided

### Group 4: CLI Integration

#### T-13.7: CLI rel Subcommand
**File**: `src/cli.ts`
**Test**: `tests/cli.test.ts`

Add `rel` command with sub-dispatch:
- `rel list` — List all relationships
- `rel show <name>` — Show details
- `rel add <name> [context]` — Create new
- `rel moment <name> <description>` — Add moment

Tests:
- [ ] rel list outputs names
- [ ] rel show displays relationship details
- [ ] rel add creates relationship
- [ ] rel moment adds key moment
- [ ] rel with no subcommand shows usage

### Group 5: Integration

#### T-13.8: Exports
**File**: `src/index.ts`
**Test**: `tests/relationships.test.ts`

Add F-013 exports to barrel.

Tests:
- [ ] All exports importable from index

## Task Summary

| Task | Description | Tests |
|------|-------------|-------|
| T-13.1 | Relationship schema | 3 |
| T-13.2 | Path resolution and slugification | 4 |
| T-13.3 | Load and save | 5 |
| T-13.4 | Add and remove | 4 |
| T-13.5 | Update and list | 4 |
| T-13.6 | Key moments | 3 |
| T-13.7 | CLI rel subcommand | 5 |
| T-13.8 | Exports | 1 |
| **Total** | | **29** |
