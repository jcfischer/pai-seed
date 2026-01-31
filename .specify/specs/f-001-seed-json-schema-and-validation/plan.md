# Technical Plan: Seed.json Schema and Validation

**Feature:** F-001
**Status:** Plan
**Created:** 2026-01-31

## Architecture Overview

F-001 is a pure data-model feature: define types, validate data, generate defaults. No I/O, no persistence, no CLI. Everything is exported for downstream features (F-002 through F-016) to consume.

```
                        ┌──────────────────────┐
                        │   Zod Schema Defs     │  ← Single source of truth
                        │   (src/schema.ts)     │
                        └──────┬───────┬────────┘
                               │       │
                    z.infer<>  │       │  zod-to-json-schema
                               ▼       ▼
                ┌──────────────────┐  ┌──────────────────────┐
                │  TypeScript Types │  │  JSON Schema (draft-07)│
                │  (exported)       │  │  (seed.schema.json)    │
                └──────────────────┘  └──────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  validateSeed()           │  ← Pure function
                │  - Zod .safeParse()       │
                │  - Returns ValidationResult│
                └──────────────────────────┘
                               │
                               ▼
                ┌──────────────────────────┐
                │  createDefaultSeed()      │  ← Returns SeedConfig
                │  - Hardcoded defaults     │
                │  - Validated on creation  │
                └──────────────────────────┘
```

**Data flow is one-directional:** Zod definitions → TypeScript types + JSON Schema → validator → default generator. No circular dependencies.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun 1.x | PAI standard, fast startup, native TS |
| Validation | Zod 3.x | Spec recommends it; TypeScript-first, composable, `.safeParse()` returns typed errors |
| JSON Schema | zod-to-json-schema | Generates draft-07 from Zod schemas; keeps Zod as single source of truth |
| IDs | nanoid | Spec requires nanoid; URL-safe, small, no deps |
| Test runner | `bun test` | Built into Bun, fast, Jest-compatible API |
| Type checking | `bun --check` / tsc | TypeScript strict mode for compile-time safety |

**Why Zod over alternatives:**
- **ajv + hand-written JSON Schema:** Two sources of truth; types and schema can drift
- **TypeBox:** Good but less ecosystem support than Zod in PAI projects
- **io-ts:** Functional style adds complexity without benefit here
- **Zod:** One definition yields TypeScript types (`z.infer<>`), runtime validation (`.safeParse()`), and JSON Schema (`zod-to-json-schema`). Three outputs, zero drift.

## Data Model

The spec prescribes exact interfaces. The plan maps them to Zod schemas:

### Root Schema

```
SeedConfig
├── version: string (semver, currently "1.0.0")
├── identity: IdentityLayer
│   ├── principalName: string
│   ├── aiName: string
│   ├── catchphrase: string
│   ├── voiceId: string
│   └── preferences
│       ├── responseStyle: enum("concise" | "detailed" | "adaptive")
│       ├── timezone: string (IANA)
│       └── locale: string
├── learned: LearnedLayer
│   ├── patterns: Learning[]
│   ├── insights: Learning[]
│   └── selfKnowledge: Learning[]
└── state: StateLayer
    ├── lastSessionId?: string
    ├── lastSessionAt?: string (ISO 8601)
    ├── proposals: Proposal[]
    ├── activeProjects: string[]
    └── checkpointRef?: string
```

### Shared Types

```
Learning
├── id: string (nanoid)
├── content: string (non-empty)
├── source: string
├── extractedAt: string (ISO 8601)
├── confirmedAt?: string (ISO 8601)
├── confirmed: boolean
└── tags: string[]

Proposal
├── id: string (nanoid)
├── type: enum("pattern" | "insight" | "self_knowledge")
├── content: string (non-empty)
├── source: string
├── extractedAt: string (ISO 8601)
└── status: enum("pending" | "accepted" | "rejected")
```

### Design Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| `additionalProperties` | `false` at top level, `true` inside arrays | Spec says reject unknown top-level props; forward compat for minor versions means warn-not-fail for nested |
| Date format | ISO 8601 strings | Spec uses `string` type with ISO 8601 convention; Zod `.datetime()` refines this |
| Version validation | Semver regex | Spec says semver string; validate with regex pattern |
| Empty arrays | Valid | Default seed has empty learned arrays; schema must accept `[]` |
| String constraints | `min(1)` on content/source fields | Prevent empty strings that pass type check but are meaningless |

## Validation Strategy

### ValidationResult Type

```
ValidationResult =
  | { valid: true; config: SeedConfig }
  | { valid: false; errors: ValidationError[] }

ValidationError = {
  path: string;       // JSONPath (e.g., "$.identity.preferences.timezone")
  message: string;    // Human-readable error
  code: string;       // Machine-readable error code
}
```

### Error Mapping

Zod's `.safeParse()` returns `ZodError` with `issues[]`. Each issue has a `path` array and `message`. The validator maps these to `ValidationError[]` with JSONPath notation.

### Version Mismatch Handling

Before running Zod validation, check `version` field:
- Missing → error: "Missing required field: version"
- Not semver → error: "Invalid version format"
- Major version mismatch (e.g., "2.0.0" vs expected "1.x.x") → specific error: "Schema version 2.0.0 requires migration. Expected 1.x.x"
- Minor version ahead → warn but validate (forward compatibility)

### Unknown Fields

The spec says "warn but don't fail" for forward compatibility. Strategy:
- Use Zod `.strict()` at root level for error reporting
- Run a second pass with `.passthrough()` if strict fails on unknown-property errors only
- Collect unknown fields as warnings in the result
- This satisfies both "reject unknown properties" (NFR) and "warn but don't fail" (forward compat)

Simplified approach: Use `.passthrough()` and manually detect extra keys, returning them as warnings alongside the validation result.

## JSON Schema Generation

`zod-to-json-schema` converts Zod schemas to JSON Schema draft-07. The generated schema:
- Uses `$ref` for shared types (`Learning`, `Proposal`) via `$defs`
- Written to `~/.pai/seed.schema.json` by F-002 (file I/O is out of scope for F-001)
- F-001 exports a `generateJsonSchema(): JSONSchema7` function that returns the schema object

This keeps F-001 pure (no I/O) while giving F-002 what it needs to write the file.

## Implementation Phases

### Phase 0: Project Initialization

Set up the greenfield TypeScript project:

- Create `package.json` with Bun, Zod 3.x, zod-to-json-schema, nanoid
- Create `tsconfig.json` with strict mode, ESM, Bun types
- Create `.gitignore` (node_modules, *.db-shm, *.db-wal, dist/)
- Create directory structure under `src/`
- Verify `bun install` and `bun test` work with empty test

### Phase 1: Zod Schema Definitions (FR-1, FR-2, FR-3, FR-4)

Define all Zod schemas in `src/schema.ts`:

1. `learningSchema` — shared Learning type with nanoid ID, ISO 8601 dates, non-empty content
2. `proposalSchema` — shared Proposal type with status enum
3. `identityLayerSchema` — Identity with preferences sub-object
4. `learnedLayerSchema` — Three arrays of Learning
5. `stateLayerSchema` — Optional fields, proposals array
6. `seedConfigSchema` — Root schema composing all layers + version

Export inferred TypeScript types via `z.infer<>`.

### Phase 2: Validation Function (FR-6)

Implement `validateSeed(data: unknown): ValidationResult`:

1. Version pre-check (before Zod validation)
2. Zod `.safeParse()` for structural validation
3. Error mapping: Zod issues → `ValidationError[]` with JSONPath
4. Unknown field detection and warnings
5. Return typed `ValidationResult`

### Phase 3: Default Seed Generator (FR-7)

Implement `createDefaultSeed(): SeedConfig`:

1. Hardcoded default values matching spec
2. Validate output against schema (self-test)
3. Return frozen object

### Phase 4: JSON Schema Export (FR-5)

Implement `generateJsonSchema(): object`:

1. Use `zod-to-json-schema` to convert `seedConfigSchema`
2. Verify `$ref` usage for Learning and Proposal
3. Export the function (F-002 will handle writing to disk)

### Phase 5: Tests

Comprehensive test suite covering all FRs:

| Test Group | What It Covers | FR |
|------------|----------------|-----|
| Schema compilation | Types compile without errors | Success Criteria #1 |
| Valid seed | Default seed validates successfully | FR-6, FR-7 |
| Invalid seeds | Missing fields, wrong types, empty strings | FR-6 |
| Partial seeds | Optional fields absent | FR-4 |
| Version handling | Mismatch, missing, wrong format | FR-6 |
| Learning entries | All fields, optional confirmedAt, tags | FR-3 |
| Proposals | All statuses, type enum | FR-4 |
| JSON Schema | Generated schema validates seed.json | FR-5 |
| Default seed | All required fields present, validates | FR-7 |
| Error paths | JSONPath present on all validation errors | FR-6 |
| Performance | <50ms for 1MB seed with 1000+ entries | NFR |

## File Structure

```
pai-seed/
├── package.json
├── tsconfig.json
├── .gitignore
├── features.json                          # (existing)
├── .specflow/                             # (existing)
├── .specify/                              # (existing)
│   └── specs/
│       └── f-001-.../
│           ├── spec.md                    # (existing)
│           └── plan.md                    # (this file)
├── src/
│   ├── schema.ts                          # Zod schemas + exported TS types
│   ├── validate.ts                        # validateSeed() + ValidationResult
│   ├── defaults.ts                        # createDefaultSeed()
│   ├── json-schema.ts                     # generateJsonSchema()
│   └── index.ts                           # Public API barrel export
└── tests/
    ├── schema.test.ts                     # Type compilation + schema shape
    ├── validate.test.ts                   # Validation function tests
    ├── defaults.test.ts                   # Default seed tests
    ├── json-schema.test.ts                # JSON Schema generation tests
    └── fixtures/
        ├── valid-seed.json                # Complete valid seed
        ├── valid-seed-minimal.json        # Only required fields
        ├── invalid-missing-version.json   # Missing version
        ├── invalid-wrong-types.json       # Type mismatches
        └── large-seed.json                # 1000+ learnings for perf test
```

### Module Responsibilities

| Module | Exports | Depends On |
|--------|---------|------------|
| `schema.ts` | Zod schemas, TS types (`SeedConfig`, `Learning`, etc.) | zod |
| `validate.ts` | `validateSeed()`, `ValidationResult`, `ValidationError` | schema.ts |
| `defaults.ts` | `createDefaultSeed()` | schema.ts, nanoid |
| `json-schema.ts` | `generateJsonSchema()` | schema.ts, zod-to-json-schema |
| `index.ts` | Re-exports all public API | all modules |

**Dependency graph is acyclic:** schema ← validate, defaults, json-schema ← index.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `zod` | ^3.23 | Schema definition + validation |
| `zod-to-json-schema` | ^3.23 | JSON Schema generation |
| `nanoid` | ^5.0 | ID generation for Learning/Proposal |

**Dev dependencies:**
| Package | Version | Purpose |
|---------|---------|---------|
| `@types/bun` | latest | Bun type definitions |
| `typescript` | ^5.5 | Type checking (`tsc --noEmit`) |

Total: 3 runtime deps, 2 dev deps. Minimal footprint.

## API Contract (Exported Public API)

F-001 exports what downstream features consume:

```
// Types
SeedConfig, IdentityLayer, LearnedLayer, StateLayer
Learning, Proposal
ValidationResult, ValidationError

// Functions
validateSeed(data: unknown): ValidationResult
createDefaultSeed(): SeedConfig
generateJsonSchema(): object

// Schemas (for advanced use by other features)
seedConfigSchema, learningSchema, proposalSchema
```

### Downstream Consumer Map

| Consumer | What They Import | Why |
|----------|-----------------|-----|
| F-002 Seed Loader | `SeedConfig`, `validateSeed`, `createDefaultSeed`, `generateJsonSchema` | Load, validate, write defaults + schema file |
| F-005 Session Hook | `SeedConfig`, `IdentityLayer`, `StateLayer` | Read identity + state at session start |
| F-006 Extraction Hook | `Proposal`, `proposalSchema` | Create proposals from session content |
| F-007 Confirmation Flow | `Learning`, `Proposal` | Convert proposals to confirmed learnings |
| F-012 ACR Integration | `Learning`, `LearnedLayer` | Index learnings for semantic search |
| F-014 Migration System | `seedConfigSchema`, version field | Detect version, apply migrations |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Zod validation >50ms on large seeds | Medium — startup latency | Low — Zod is fast | Benchmark with 1000+ entry fixture in tests; if slow, precompile schema |
| `zod-to-json-schema` output doesn't match Zod behavior | Medium — dual-validation divergence | Low — mature library | Test: validate same seed with both Zod and generated JSON Schema |
| nanoid collisions in large learned arrays | Low — theoretical | Very Low — 21-char default | Use default nanoid (21 chars, ~149 years at 1000 IDs/sec for 1% collision) |
| Downstream features need fields not in v1.0.0 | High — schema changes | Medium — early design | Version field enables migration (F-014); design for additive changes |
| `additionalProperties: false` breaks forward compat | Medium — can't add fields in minor versions | Medium | Use passthrough strategy: validate known fields, warn on unknown |
| Zod 4.x breaking changes | Medium — API changes | Low — Zod 3.x is stable | Pin to `^3.23`, update when Zod 4 stabilizes |

## Testing Strategy

### Test Pyramid

```
       ┌─────────────┐
       │  Performance │  ← 1 test: 1000+ entries <50ms
       ├─────────────┤
       │  Integration │  ← JSON Schema ↔ Zod agreement
       ├─────────────┤
       │    Unit      │  ← Schema, validate, defaults
       └─────────────┘
```

### Coverage Targets

- Every FR has at least one test
- Every field type (string, enum, optional, array) tested
- Every error path produces a ValidationError with JSONPath
- Happy path: valid minimal seed, valid full seed
- Sad path: missing fields, wrong types, empty strings, version mismatch
- Edge cases: empty arrays, 0-length tags, extremely long content strings

### Performance Test

Generate a seed with 1000 learnings + 100 proposals. Time `validateSeed()`. Assert <50ms. Run in CI-like conditions (no warm-up bias).
