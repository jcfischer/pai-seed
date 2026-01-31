# Implementation Tasks: Seed.json Schema and Validation

**Feature:** F-001
**Spec:** `.specify/specs/f-001-seed-json-schema-and-validation/spec.md`
**Plan:** `.specify/specs/f-001-seed-json-schema-and-validation/plan.md`

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Project init |
| T-1.2 | ☐ | Directory structure |
| T-2.1 | ☐ | Shared types (Learning, Proposal) |
| T-2.2 | ☐ | Identity layer schema |
| T-2.3 | ☐ | Learned layer schema |
| T-2.4 | ☐ | State layer schema |
| T-2.5 | ☐ | Root SeedConfig schema |
| T-3.1 | ☐ | validateSeed() |
| T-3.2 | ☐ | createDefaultSeed() |
| T-4.1 | ☐ | generateJsonSchema() |
| T-4.2 | ☐ | Barrel export (index.ts) |
| T-5.1 | ☐ | Test fixtures |
| T-5.2 | ☐ | Schema unit tests |
| T-5.3 | ☐ | Validation unit tests |
| T-5.4 | ☐ | Default seed tests |
| T-5.5 | ☐ | JSON Schema integration tests |
| T-5.6 | ☐ | Performance test |

## Group 1: Foundation

### T-1.1: Initialize project [T]
- **Files:** `package.json`, `tsconfig.json`, `.gitignore`
- **Test:** `bun install` succeeds, `bun test` runs (empty)
- **Dependencies:** none
- **Description:**
  Create `package.json` with:
  - Runtime deps: `zod@^3.23`, `zod-to-json-schema@^3.23`, `nanoid@^5.0`
  - Dev deps: `@types/bun@latest`, `typescript@^5.5`
  - Scripts: `"test": "bun test"`, `"typecheck": "tsc --noEmit"`

  Create `tsconfig.json` with strict mode, ESM module resolution, Bun types, `src/` as rootDir.

  Create `.gitignore` with `node_modules/`, `dist/`, `*.db-shm`, `*.db-wal`.

  Run `bun install` to verify deps resolve.

### T-1.2: Create directory structure
- **Files:** `src/`, `tests/`, `tests/fixtures/`
- **Test:** Directories exist
- **Dependencies:** T-1.1
- **Description:**
  Create the directory skeleton:
  ```
  src/
    schema.ts      (placeholder)
    validate.ts    (placeholder)
    defaults.ts    (placeholder)
    json-schema.ts (placeholder)
    index.ts       (placeholder)
  tests/
    schema.test.ts    (placeholder)
    validate.test.ts  (placeholder)
    defaults.test.ts  (placeholder)
    json-schema.test.ts (placeholder)
    fixtures/
  ```
  Each placeholder can be an empty export or a single skipped test to verify the structure works with `bun test`.

---

## Group 2: Schema Definitions (FR-1 through FR-4)

### T-2.1: Define shared types — Learning and Proposal [T]
- **File:** `src/schema.ts`
- **Test:** `tests/schema.test.ts`
- **Dependencies:** T-1.2
- **Description:**
  Define Zod schemas and export inferred TypeScript types:

  **`learningSchema`** (FR-3):
  - `id`: `z.string()` (nanoid format)
  - `content`: `z.string().min(1)`
  - `source`: `z.string().min(1)`
  - `extractedAt`: `z.string().datetime()`
  - `confirmedAt`: `z.string().datetime().optional()`
  - `confirmed`: `z.boolean()`
  - `tags`: `z.array(z.string())`

  **`proposalSchema`** (FR-4):
  - `id`: `z.string()`
  - `type`: `z.enum(["pattern", "insight", "self_knowledge"])`
  - `content`: `z.string().min(1)`
  - `source`: `z.string().min(1)`
  - `extractedAt`: `z.string().datetime()`
  - `status`: `z.enum(["pending", "accepted", "rejected"])`

  Export: `type Learning = z.infer<typeof learningSchema>`, `type Proposal = z.infer<typeof proposalSchema>`

  **Tests:** Parse valid learning, parse valid proposal, reject empty content, reject invalid enum values, verify optional `confirmedAt`.

### T-2.2: Define Identity layer schema [T] [P with T-2.3, T-2.4]
- **File:** `src/schema.ts`
- **Test:** `tests/schema.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Define `identityLayerSchema` (FR-2):

  **`preferencesSchema`**:
  - `responseStyle`: `z.enum(["concise", "detailed", "adaptive"])`
  - `timezone`: `z.string()` (IANA timezone)
  - `locale`: `z.string()` (locale code)

  **`identityLayerSchema`**:
  - `principalName`: `z.string().min(1)`
  - `aiName`: `z.string().min(1)`
  - `catchphrase`: `z.string().min(1)`
  - `voiceId`: `z.string()`
  - `preferences`: `preferencesSchema`

  Export: `type IdentityLayer = z.infer<typeof identityLayerSchema>`

  **Tests:** Parse valid identity, reject missing principalName, reject invalid responseStyle enum.

### T-2.3: Define Learned layer schema [T] [P with T-2.2, T-2.4]
- **File:** `src/schema.ts`
- **Test:** `tests/schema.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Define `learnedLayerSchema` (FR-3):
  - `patterns`: `z.array(learningSchema)`
  - `insights`: `z.array(learningSchema)`
  - `selfKnowledge`: `z.array(learningSchema)`

  Export: `type LearnedLayer = z.infer<typeof learnedLayerSchema>`

  **Tests:** Parse with empty arrays, parse with populated arrays, reject invalid learning entries within arrays.

### T-2.4: Define State layer schema [T] [P with T-2.2, T-2.3]
- **File:** `src/schema.ts`
- **Test:** `tests/schema.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Define `stateLayerSchema` (FR-4):
  - `lastSessionId`: `z.string().optional()`
  - `lastSessionAt`: `z.string().datetime().optional()`
  - `proposals`: `z.array(proposalSchema)`
  - `activeProjects`: `z.array(z.string())`
  - `checkpointRef`: `z.string().optional()`

  Export: `type StateLayer = z.infer<typeof stateLayerSchema>`

  **Tests:** Parse with all optional fields absent, parse with proposals in each status, reject invalid datetime format.

### T-2.5: Define root SeedConfig schema [T]
- **File:** `src/schema.ts`
- **Test:** `tests/schema.test.ts`
- **Dependencies:** T-2.2, T-2.3, T-2.4
- **Description:**
  Define `seedConfigSchema` (FR-1):
  - `version`: `z.string().regex(/^\d+\.\d+\.\d+$/)` (semver)
  - `identity`: `identityLayerSchema`
  - `learned`: `learnedLayerSchema`
  - `state`: `stateLayerSchema`

  Use `.passthrough()` at root to allow unknown fields (forward compatibility — warnings handled in validate.ts).

  Export: `type SeedConfig = z.infer<typeof seedConfigSchema>`

  **Tests:** Parse complete valid seed, reject missing version, reject non-semver version string, verify all three layers compose correctly.

---

## Group 3: Core Logic (FR-6, FR-7)

### T-3.1: Implement validateSeed() [T]
- **File:** `src/validate.ts`
- **Test:** `tests/validate.test.ts`
- **Dependencies:** T-2.5
- **Description:**
  Implement `validateSeed(data: unknown): ValidationResult` (FR-6):

  **Types:**
  ```typescript
  type ValidationResult =
    | { valid: true; config: SeedConfig; warnings?: string[] }
    | { valid: false; errors: ValidationError[] }

  type ValidationError = {
    path: string;    // JSONPath (e.g., "$.identity.preferences.timezone")
    message: string; // Human-readable
    code: string;    // Machine-readable (e.g., "invalid_type", "too_small")
  }
  ```

  **Logic:**
  1. Check `data` is a non-null object
  2. Version pre-check: missing → error, not semver → error, major mismatch → migration error
  3. Run `seedConfigSchema.safeParse(data)`
  4. Map Zod `issues[]` to `ValidationError[]` with JSONPath (`$.` + path segments joined by `.`)
  5. Detect unknown top-level keys (compare Object.keys against known schema keys), collect as warnings
  6. Return `ValidationResult`

  **Tests:**
  - Valid seed → `{ valid: true, config }` with correct type
  - Missing version → error with path `$.version`
  - Wrong version format → error with code and message
  - Major version mismatch (e.g., "2.0.0") → specific migration error
  - Missing required field → error with correct JSONPath
  - Wrong type (number where string expected) → error
  - Multiple errors returned (not just first)
  - Unknown top-level key → valid with warnings
  - `null` input → error
  - Non-object input → error

### T-3.2: Implement createDefaultSeed() [T] [P with T-3.1]
- **File:** `src/defaults.ts`
- **Test:** `tests/defaults.test.ts`
- **Dependencies:** T-2.5
- **Description:**
  Implement `createDefaultSeed(): SeedConfig` (FR-7):

  Return a valid `SeedConfig` with:
  - `version`: `"1.0.0"`
  - `identity.principalName`: `"User"`
  - `identity.aiName`: `"PAI"`
  - `identity.catchphrase`: `"PAI here, ready to go."`
  - `identity.voiceId`: `"default"`
  - `identity.preferences.responseStyle`: `"adaptive"`
  - `identity.preferences.timezone`: `"UTC"`
  - `identity.preferences.locale`: `"en-US"`
  - `learned.patterns`: `[]`
  - `learned.insights`: `[]`
  - `learned.selfKnowledge`: `[]`
  - `state.proposals`: `[]`
  - `state.activeProjects`: `[]`

  Self-validate: call `validateSeed()` on the output and assert valid. If validation fails, throw (programming error).

  **Tests:**
  - Default seed validates against schema
  - All required fields present with expected values
  - Learned arrays are empty
  - State has no proposals or active projects
  - Version is "1.0.0"

---

## Group 4: JSON Schema & Export (FR-5)

### T-4.1: Implement generateJsonSchema() [T]
- **File:** `src/json-schema.ts`
- **Test:** `tests/json-schema.test.ts`
- **Dependencies:** T-2.5
- **Description:**
  Implement `generateJsonSchema(): object` (FR-5):

  1. Use `zodToJsonSchema(seedConfigSchema)` from `zod-to-json-schema`
  2. Verify output contains `$defs` (or `definitions`) with shared types for Learning and Proposal
  3. Return the JSON Schema object (caller handles file I/O — that's F-002)

  **Tests:**
  - Returned object has `type: "object"` at root
  - Schema has `properties` for version, identity, learned, state
  - `$defs` (or `definitions`) includes Learning and Proposal refs
  - Validate the default seed against the generated JSON Schema using a JSON Schema validator (ajv or manual check)

### T-4.2: Create barrel export (index.ts) [T]
- **File:** `src/index.ts`
- **Test:** `bun --check` / `tsc --noEmit` passes
- **Dependencies:** T-3.1, T-3.2, T-4.1
- **Description:**
  Re-export the full public API:

  ```typescript
  // Types
  export type { SeedConfig, IdentityLayer, LearnedLayer, StateLayer } from './schema';
  export type { Learning, Proposal } from './schema';
  export type { ValidationResult, ValidationError } from './validate';

  // Functions
  export { validateSeed } from './validate';
  export { createDefaultSeed } from './defaults';
  export { generateJsonSchema } from './json-schema';

  // Schemas (for downstream features)
  export { seedConfigSchema, learningSchema, proposalSchema } from './schema';
  ```

  Verify: `tsc --noEmit` passes with no errors. All exported names resolve.

---

## Group 5: Test Suite & Fixtures

### T-5.1: Create test fixtures [P with T-5.2, T-5.3]
- **File:** `tests/fixtures/*.json`
- **Test:** Each fixture is valid JSON (parseable)
- **Dependencies:** T-2.5
- **Description:**
  Create JSON fixture files:

  - **`valid-seed.json`** — Complete seed with all fields populated, multiple learnings and proposals
  - **`valid-seed-minimal.json`** — Only required fields, empty arrays, no optional fields
  - **`invalid-missing-version.json`** — Complete seed minus the `version` field
  - **`invalid-wrong-types.json`** — Version as number, principalName as boolean, tags as string (not array)
  - **`large-seed.json`** — 1000 learnings in patterns, 500 in insights, 100 proposals (for performance test)

### T-5.2: Schema unit tests [T]
- **File:** `tests/schema.test.ts`
- **Test:** `bun test tests/schema.test.ts`
- **Dependencies:** T-2.5, T-5.1
- **Description:**
  Comprehensive schema tests (written incrementally with T-2.x tasks, finalized here):

  - Types compile without errors (import and use each type)
  - Each Zod schema parses its valid fixture
  - Each Zod schema rejects its invalid fixture
  - Enum fields reject out-of-range values
  - Optional fields accept `undefined`
  - String `min(1)` fields reject empty strings
  - Datetime fields reject non-ISO strings
  - Array fields accept empty arrays

### T-5.3: Validation unit tests [T]
- **File:** `tests/validate.test.ts`
- **Test:** `bun test tests/validate.test.ts`
- **Dependencies:** T-3.1, T-5.1
- **Description:**
  Tests for `validateSeed()`:

  - Valid full seed → `{ valid: true }`
  - Valid minimal seed → `{ valid: true }`
  - Missing version → specific error
  - Version format wrong → specific error
  - Major version mismatch → migration error message
  - Missing required fields → errors with JSONPath
  - Wrong types → errors with JSONPath
  - Multiple simultaneous errors → all returned
  - Unknown top-level keys → valid with warnings
  - `null` / `undefined` / `42` / `"string"` → error
  - Malformed inner objects → errors with deep JSONPaths

### T-5.4: Default seed tests [T]
- **File:** `tests/defaults.test.ts`
- **Test:** `bun test tests/defaults.test.ts`
- **Dependencies:** T-3.2
- **Description:**
  Tests for `createDefaultSeed()`:

  - Returns valid SeedConfig (passes validateSeed)
  - Identity defaults match spec values
  - Learned arrays are all empty
  - State has no proposals and no active projects
  - Version is "1.0.0"
  - Returned object is a fresh instance each call (not shared reference)

### T-5.5: JSON Schema integration tests [T]
- **File:** `tests/json-schema.test.ts`
- **Test:** `bun test tests/json-schema.test.ts`
- **Dependencies:** T-4.1, T-5.1
- **Description:**
  Tests for `generateJsonSchema()`:

  - Output is valid JSON Schema (has `type`, `properties`)
  - Schema validates `valid-seed.json` fixture (cross-validate with Zod)
  - Schema rejects `invalid-wrong-types.json` fixture
  - `$defs` contains Learning and Proposal definitions
  - Default seed validates against JSON Schema

### T-5.6: Performance test [T]
- **File:** `tests/validate.test.ts` (appended)
- **Test:** `bun test tests/validate.test.ts`
- **Dependencies:** T-3.1, T-5.1
- **Description:**
  Performance benchmark per NFR:

  - Load `large-seed.json` (1000+ learnings, 100+ proposals)
  - Run `validateSeed()` and measure elapsed time
  - Assert <50ms
  - Run 10 iterations to rule out JIT/warm-up variance

---

## Execution Order

```
T-1.1  (project init — no deps)
  │
  ▼
T-1.2  (directory structure)
  │
  ▼
T-2.1  (shared types: Learning, Proposal)
  │
  ├──────────┬──────────┐
  ▼          ▼          ▼
T-2.2 [P]  T-2.3 [P]  T-2.4 [P]   (Identity, Learned, State — parallel)
  │          │          │
  └──────────┴──────────┘
             │
             ▼
           T-2.5  (root SeedConfig)
             │
  ┌──────────┼──────────┬──────────┐
  ▼          ▼          ▼          ▼
T-3.1 [P]  T-3.2 [P]  T-4.1 [P]  T-5.1 [P]  (validate, defaults, jsonschema, fixtures — parallel)
  │          │          │          │
  └──────────┴──────────┴──────────┘
             │
             ▼
           T-4.2  (barrel export)
             │
  ┌──────────┼──────────┬──────────┬──────────┐
  ▼          ▼          ▼          ▼          ▼
T-5.2 [P]  T-5.3 [P]  T-5.4 [P]  T-5.5 [P]  T-5.6 [P]  (all tests — parallel)
```

**Critical path:** T-1.1 → T-1.2 → T-2.1 → T-2.5 → T-3.1 → T-4.2 → T-5.3
**Total tasks:** 16
**Parallelizable:** 10 (marked [P])
