---
id: "F-001"
feature: "Seed.json schema and validation"
status: "draft"
created: "2026-01-31"
---

# Specification: Seed.json Schema and Validation

## Overview

Define the canonical JSON Schema for `seed.json` — the persistent identity and memory file for PAI. The schema has three layers: **identity** (who Ivy is), **learned** (patterns and insights accumulated over time), and **state** (session-to-session operational state). This feature establishes the data model that all other pai-seed features build on.

## User Scenarios

### Scenario 1: First-time PAI user

**As a** PAI user setting up for the first time
**I want** seed.json to be created with sensible defaults
**So that** PAI works immediately without manual configuration

**Acceptance Criteria:**
- [ ] Default seed.json created when none exists
- [ ] All required fields populated with defaults
- [ ] Schema validates the default seed as valid
- [ ] Identity section has placeholder values (name: "User", aiName: "PAI")

### Scenario 2: Experienced user with accumulated learnings

**As a** PAI user with months of history
**I want** seed.json to hold my AI's accumulated knowledge
**So that** every session benefits from prior experience

**Acceptance Criteria:**
- [ ] Learned section stores patterns with timestamps and confirmation status
- [ ] State section tracks pending proposals from last session
- [ ] Schema supports arrays of learnings, insights, and self-knowledge entries
- [ ] Each learning entry has: content, source, timestamp, confirmed flag

### Scenario 3: Schema evolution over time

**As a** developer updating pai-seed
**I want** the schema to be versioned
**So that** future changes don't break existing seed.json files

**Acceptance Criteria:**
- [ ] Schema includes a `version` field (semver string)
- [ ] Current schema version is "1.0.0"
- [ ] Validator reports version mismatches clearly
- [ ] Schema is exported as both TypeScript types and JSON Schema

## Functional Requirements

### FR-1: Three-Layer Schema Structure

The seed.json schema MUST have three top-level sections:

```typescript
interface SeedConfig {
  version: string;          // Schema version (semver)
  identity: IdentityLayer;  // Who the AI is
  learned: LearnedLayer;    // What the AI knows
  state: StateLayer;        // Operational session state
}
```

**Validation:** Unit test that validates a complete seed.json against the schema.

### FR-2: Identity Layer

```typescript
interface IdentityLayer {
  principalName: string;     // User's name
  aiName: string;            // AI's name (e.g., "Ivy")
  catchphrase: string;       // Startup greeting
  voiceId: string;           // ElevenLabs voice ID or preset name
  preferences: {
    responseStyle: "concise" | "detailed" | "adaptive";
    timezone: string;        // IANA timezone
    locale: string;          // Language/locale code
  };
}
```

**Validation:** Unit test for each field type and constraint.

### FR-3: Learned Layer

```typescript
interface LearnedLayer {
  patterns: Learning[];      // Behavioral patterns
  insights: Learning[];      // Extracted insights
  selfKnowledge: Learning[]; // AI's knowledge about itself
}

interface Learning {
  id: string;                // Unique identifier (nanoid)
  content: string;           // The learning itself
  source: string;            // Where it came from (session ID, manual, etc.)
  extractedAt: string;       // ISO 8601 timestamp
  confirmedAt?: string;      // When user approved (undefined = pending)
  confirmed: boolean;        // Whether user has confirmed
  tags: string[];            // Categorization tags
}
```

**Validation:** Unit test that validates learning entries with all fields, optional fields, and edge cases.

### FR-4: State Layer

```typescript
interface StateLayer {
  lastSessionId?: string;         // ID of most recent session
  lastSessionAt?: string;         // ISO 8601 timestamp
  proposals: Proposal[];          // Pending learning proposals
  activeProjects: string[];       // Currently active project names
  checkpointRef?: string;         // Reference to latest checkpoint file
}

interface Proposal {
  id: string;                     // Unique identifier
  type: "pattern" | "insight" | "self_knowledge";
  content: string;                // Proposed learning
  source: string;                 // Session that generated it
  extractedAt: string;            // When extracted
  status: "pending" | "accepted" | "rejected";
}
```

**Validation:** Unit test for state with proposals in various statuses.

### FR-5: JSON Schema Generation

Export the TypeScript types as a standard JSON Schema (draft-07 or later) for external validation tools. The JSON Schema MUST:
- Be generated from the TypeScript types (single source of truth)
- Be written to `~/.pai/seed.schema.json` alongside the data file
- Support `$ref` for shared types (Learning, Proposal)

**Validation:** Validate seed.json using both TypeScript validator and standalone JSON Schema.

### FR-6: Validation Function

Provide a `validateSeed(data: unknown): ValidationResult` function that:
- Validates against the JSON Schema
- Returns typed errors with field paths
- Returns `{ valid: true, config: SeedConfig }` on success
- Returns `{ valid: false, errors: ValidationError[] }` on failure
- Is pure (no side effects, no file I/O)

**Validation:** Unit tests with valid seeds, invalid seeds, partial seeds, and malformed JSON.

### FR-7: Default Seed Generation

Provide a `createDefaultSeed(): SeedConfig` function that returns a valid seed with default values:
- Identity: name="User", aiName="PAI", catchphrase="PAI here, ready to go."
- Learned: empty arrays for all three categories
- State: no proposals, no active projects, no checkpoint
- Version: "1.0.0"

**Validation:** Validate default seed against schema. All required fields present.

## Non-Functional Requirements

- **Performance:** Schema validation must complete in <50ms for a seed.json up to 1MB
- **Security:** No executable code in seed.json. Schema rejects unknown properties (`additionalProperties: false` at top level). Relationship data lives in separate files, not in seed.json.
- **Scalability:** Learned arrays can grow to 1000+ entries. Validation must remain fast.
- **Failure Behavior:**
  - On malformed JSON: Return parse error with line/column if possible
  - On schema violation: Return all violations (not just first), with JSONPath to each
  - On version mismatch: Return specific error indicating migration needed
  - On unknown fields: Warn but don't fail (forward compatibility for minor versions)

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| SeedConfig | Root configuration | version, identity, learned, state |
| IdentityLayer | AI personality and user prefs | principalName, aiName, catchphrase, voiceId, preferences |
| LearnedLayer | Accumulated knowledge | patterns[], insights[], selfKnowledge[] |
| Learning | Single learned item | id, content, source, extractedAt, confirmed, tags |
| StateLayer | Session-to-session state | lastSessionId, proposals[], activeProjects[] |
| Proposal | Pending learning candidate | id, type, content, source, status |

## Success Criteria

- [ ] TypeScript types compile without errors
- [ ] JSON Schema generated from types and written to file
- [ ] `validateSeed()` passes on valid seed, fails on invalid
- [ ] `createDefaultSeed()` produces a valid seed
- [ ] All validation errors include JSONPath to the offending field
- [ ] Schema version field present and enforced
- [ ] 100% of defined types have corresponding test coverage
- [ ] `bun test` passes with all schema tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| JSON is sufficient (not YAML, TOML) | User requests YAML support | Feature request |
| Single file per AI instance | Multi-agent needs separate seeds | pai-collab requirements change |
| English-only content initially | Internationalization needed | User feedback |
| nanoid for IDs is unique enough | ID collision in large datasets | Monitor ID generation |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes | Version/Contract |
|--------|-------------|---------------------------|------------------|
| Bun runtime | TypeScript execution, test runner | Build/test commands | Bun 1.x |
| Zod (recommended) | Runtime validation from TS types | Validation logic | Zod 3.x |

### Downstream Consumers

| System | What They Expect | Breaking Change Threshold |
|--------|-----------------|--------------------------|
| F-002 Seed Loader | Valid SeedConfig type + validateSeed() | Type signature changes |
| F-005 Session Hook | SeedConfig type for injection | Identity/state field changes |
| F-006 Extraction Hook | Proposal type for writing candidates | Proposal schema changes |
| F-012 ACR Integration | Learning type for indexing | Learning field changes |
| F-014 Migration System | Schema version field | Version format changes |

### Adjacent Systems (Implicit Coupling)

| System | Implicit Dependency | Risk |
|--------|---------------------|------|
| PAI settings.json | Both loaded at startup, must not conflict | Field name collision |
| ACR config | Both in ~/.pai/ or ~/.claude/ namespace | Directory structure |
| Git | seed.json must be valid JSON for git diff | Binary/corrupt detection |

## Out of Scope

- File I/O (reading/writing seed.json) — that's F-002
- Git operations — that's F-003
- Migration logic — that's F-014
- Relationship files — that's F-013
- CLI commands — that's F-011
- Event log — that's F-008
