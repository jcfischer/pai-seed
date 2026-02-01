# Documentation Updates: F-013 Relationship File System

## Files Updated

### API Surface Added

New file `src/relationships.ts` — Relationship CRUD operations and schema.

**Types:**
- `Relationship` — Full relationship record (name, dates, context, keyMoments)
- `KeyMoment` — Single key moment (date, description, tags?)
- `RelationshipResult` — Discriminated union result for single relationship
- `ListResult` — Discriminated union result for listing names
- `RelationshipWriteResult` — Write operation result
- `RelationshipOptions` — Options: paiDir

**Schemas:**
- `relationshipSchema` — Zod schema for Relationship
- `keyMomentSchema` — Zod schema for KeyMoment

**Functions:**
- `resolveRelationshipsDir(paiDir?)` — Path to ~/.pai/relationships/
- `slugifyName(name)` — Convert name to filename-safe slug
- `loadRelationship(name, options?)` — Read and validate relationship file
- `saveRelationship(relationship, options?)` — Atomic write
- `addRelationship(name, context?, options?)` — Create new relationship
- `removeRelationship(name, options?)` — Delete relationship file
- `updateRelationship(name, updates, options?)` — Partial update
- `listRelationships(options?)` — List all relationship slugs
- `addKeyMoment(name, description, tags?, options?)` — Append key moment

### CLI Commands Added

| Command | Description |
|---------|-------------|
| `pai-seed rel list` | List all relationships |
| `pai-seed rel show <name>` | Show relationship details |
| `pai-seed rel add <name> [context]` | Create new relationship |
| `pai-seed rel moment <name> <description>` | Add key moment |
| `pai-seed rel help` | Show rel subcommand usage |

### File Storage

- Directory: `~/.pai/relationships/`
- Pattern: `rel_<slugified-name>.json`
- Slug: lowercase, spaces→hyphens, strip special chars

### New File Locations

- `src/relationships.ts` — Relationship module (~230 lines)
- `tests/relationships.test.ts` — 25 tests
- `src/cli.ts` — Extended with `rel` subcommand
- `tests/cli.test.ts` — 5 new CLI tests
