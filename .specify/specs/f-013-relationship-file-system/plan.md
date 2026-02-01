---
feature: "Relationship file system"
feature_id: "F-013"
created: "2026-02-01"
---

# Implementation Plan: Relationship File System

## Architecture

Single new module `src/relationships.ts` following established patterns:
- Zod-first schema with inferred types
- Result types (discriminated unions, never-throw)
- Atomic file writes (temp + rename)
- Git auto-commit on mutations

## File Layout

```
src/relationships.ts     — Schema, CRUD, git integration
src/cli.ts               — Extended with `rel` subcommand
tests/relationships.test.ts — Full test coverage
src/index.ts             — Barrel exports
```

## Implementation Order

### Group 1: Schema + Types
Define Zod schemas: `keyMomentSchema`, `relationshipSchema`. Derive TypeScript types. Result types for operations.

### Group 2: File Operations
- `resolveRelationshipsDir()` — Path resolution (~/.pai/relationships/)
- `slugifyName()` — Name to filename slug
- `loadRelationship()` — Read and validate JSON
- `saveRelationship()` — Atomic write with git commit
- `listRelationships()` — Read directory, parse filenames

### Group 3: CRUD
- `addRelationship()` — Create new, error if exists
- `updateRelationship()` — Partial update
- `removeRelationship()` — Delete file + git commit
- `addKeyMoment()` — Append moment, update lastInteraction

### Group 4: CLI
- New `rel` subcommand in cli.ts with sub-dispatch
- `rel list`, `rel show`, `rel add`, `rel moment`

### Group 5: Integration
- Add exports to index.ts
- Ensure all tests pass

## Key Decisions

1. **Slugification** — Simple: lowercase, replace spaces/special chars with hyphens, collapse consecutive hyphens
2. **No seed.json reference** — Relationships are standalone; seed.json integration deferred
3. **Git integration** — Use `commitSeedChange()` from git.ts with relationships dir
4. **Error handling** — Result types throughout, never-throw pattern
