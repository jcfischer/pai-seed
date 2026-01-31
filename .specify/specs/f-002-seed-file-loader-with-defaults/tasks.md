# Implementation Tasks: Seed File Loader with Defaults

**Feature:** F-002
**Spec:** `.specify/specs/f-002-seed-file-loader-with-defaults/spec.md`
**Plan:** `.specify/specs/f-002-seed-file-loader-with-defaults/plan.md`

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Types + path resolution |
| T-2.1 | ☐ | deepMerge + isPlainObject |
| T-2.2 | ☐ | deepMerge unit tests |
| T-3.1 | ☐ | writeSeed + atomic write |
| T-3.2 | ☐ | writeJsonSchema |
| T-3.3 | ☐ | loadSeed orchestration |
| T-3.4 | ☐ | Loader + writer tests |
| T-4.1 | ☐ | Update barrel export |
| T-4.2 | ☐ | Full suite + typecheck |

---

## Group 1: Foundation

### T-1.1: Define types and path resolution [T]
- **File:** `src/loader.ts`
- **Test:** `tests/loader.test.ts` (path resolution subset)
- **Dependencies:** none (F-001 types only — already stable)
- **Description:**
  Define all F-002 types and the path resolution utility in `src/loader.ts`:

  **Types:**
  ```typescript
  type LoadResult =
    | { ok: true; config: SeedConfig; created: boolean; merged: boolean; warnings?: string[] }
    | { ok: false; error: LoadError };

  type LoadError = {
    code: "parse_error" | "validation_error" | "read_error" | "permission_error";
    message: string;
    details?: ValidationError[];
  };

  type WriteResult =
    | { ok: true }
    | { ok: false; error: WriteError };

  type WriteError = {
    code: "validation_error" | "write_error" | "permission_error";
    message: string;
    details?: ValidationError[];
  };
  ```

  **Function:** `resolveSeedPath(seedPath?: string): string`
  - Default: `path.join(os.homedir(), ".pai", "seed.json")`
  - Override: `path.resolve(seedPath)`
  - Exported for downstream use (F-011 CLI needs it)

  **Imports:** `node:path`, `node:os`, `ValidationError` from `./validate`

  **Tests (path resolution only):**
  - Default path contains `.pai/seed.json`
  - Default path is absolute
  - Custom path override returns resolved absolute path
  - Relative custom path is resolved to absolute

---

## Group 2: Core Logic

### T-2.1: Implement deepMerge [T]
- **File:** `src/merge.ts`
- **Test:** `tests/merge.test.ts`
- **Dependencies:** none (pure function, no F-001 imports)
- **Description:**
  Implement `deepMerge()` and `isPlainObject()` as a pure utility module:

  **`isPlainObject(value: unknown): value is Record<string, unknown>`**
  - Returns `true` for `{}`, `{ a: 1 }`, nested objects
  - Returns `false` for `null`, arrays, primitives, `Date`, `RegExp`

  **`deepMerge(existing, defaults): Record<string, unknown>`**
  Merge rules (from spec):
  1. Key only in existing -> keep existing (passthrough)
  2. Key only in defaults -> use default (fill missing)
  3. Both objects (non-array, non-null) -> recurse
  4. Both exist, either is array -> keep existing (no array merge)
  5. Both exist, primitives -> keep existing (existing wins)

  Both functions exported. No side effects, returns new object.

### T-2.2: Deep merge unit tests [T] [P with T-2.1]
- **File:** `tests/merge.test.ts`
- **Test:** `bun test tests/merge.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Test cases covering all merge rules:

  - Empty existing + full defaults -> returns defaults
  - Full existing + empty defaults -> returns existing unchanged
  - Partial existing -> missing fields filled from defaults
  - Nested objects merge recursively (3+ levels deep)
  - Arrays NOT merged: existing `[A, B]` + default `[]` -> `[A, B]`
  - Arrays NOT merged: existing `[]` + default `[X]` -> `[]`
  - Unknown keys preserved (key only in existing)
  - Primitives: existing string wins over default string
  - Primitives: existing number wins over default number
  - `null` values treated as primitives (not recursed into)
  - Mixed: existing has object where default has primitive -> existing wins
  - Returns new object (not mutating either input)
  - Real-world: seed missing `state` section gets it from defaults
  - Real-world: seed with existing `learned.patterns` keeps them

---

## Group 3: I/O Operations

### T-3.1: Implement writeSeed with atomic write [T]
- **File:** `src/loader.ts`
- **Test:** `tests/loader.test.ts` (write subset)
- **Dependencies:** T-1.1
- **Description:**
  Add `writeSeed(config: SeedConfig, seedPath?: string): Promise<WriteResult>` to `src/loader.ts`:

  1. Validate config via `validateSeed()` from F-001 — reject if invalid
  2. Resolve path via `resolveSeedPath(seedPath)`
  3. Create parent directory: `mkdir(dirname(path), { recursive: true })`
  4. Serialize: `JSON.stringify(config, null, 2) + "\n"`
  5. Atomic write: `Bun.write(path + ".tmp", content)` then `rename(path + ".tmp", path)`
  6. Return `{ ok: true }` or appropriate `WriteError`

  **Error mapping:**
  - `validateSeed` fails -> `{ code: "validation_error", details }`
  - `EACCES`/`EPERM` -> `{ code: "permission_error" }`
  - Other I/O errors -> `{ code: "write_error" }`

  **Imports:** `node:fs/promises` (`mkdir`, `rename`), `node:path` (`dirname`, `resolve`)

  **Tests:**
  - Write valid config -> file exists, content matches, parseable JSON
  - Write invalid config -> returns `validation_error`, no file created
  - Write to non-existent directory -> directory created, file written
  - Written JSON has 2-space indent + trailing newline
  - Temp file cleaned up after successful rename (no `.tmp` left behind)

### T-3.2: Implement writeJsonSchema [T] [P with T-3.1]
- **File:** `src/loader.ts`
- **Test:** `tests/loader.test.ts` (schema write subset)
- **Dependencies:** T-1.1
- **Description:**
  Add `writeJsonSchema(schemaPath?: string): Promise<WriteResult>` to `src/loader.ts`:

  1. Generate schema via `generateJsonSchema()` from F-001
  2. Default path: sibling to seed path -> `~/.pai/seed.schema.json`
  3. Serialize: `JSON.stringify(schema, null, 2) + "\n"`
  4. Atomic write (same temp+rename pattern as writeSeed)
  5. Return `{ ok: true }` or `WriteError`

  **Tests:**
  - Written file is valid JSON
  - Content has `type: "object"` at root (valid JSON Schema)
  - Default path resolves to `~/.pai/seed.schema.json`
  - Custom path override works

### T-3.3: Implement loadSeed orchestration [T]
- **File:** `src/loader.ts`
- **Test:** `tests/loader.test.ts` (load subset)
- **Dependencies:** T-1.1, T-2.1, T-3.1, T-3.2
- **Description:**
  Add `loadSeed(seedPath?: string): Promise<LoadResult>` to `src/loader.ts`:

  **Flow:**
  1. Resolve path via `resolveSeedPath(seedPath)`
  2. Attempt `Bun.file(path).text()`
  3. **File missing (ENOENT):**
     - `createDefaultSeed()` from F-001
     - `writeSeed(defaultConfig, path)`
     - `writeJsonSchema(schemaPath)` (sibling path)
     - Return `{ ok: true, config, created: true, merged: false }`
  4. **File exists:**
     - `JSON.parse(text)` — catch SyntaxError -> `{ code: "parse_error" }`
     - `validateSeed(parsed)` — if invalid -> `{ code: "validation_error", details }`
     - `deepMerge(parsed, createDefaultSeed())` from T-2.1
     - Compare merged vs parsed via `JSON.stringify` equality
     - If changed: `writeSeed(merged as SeedConfig, path)` -> `{ merged: true }`
     - If unchanged: `{ merged: false }`
     - Forward warnings from `validateSeed()`
  5. **Permission error:** `{ code: "permission_error" }`
  6. **Other read error:** `{ code: "read_error" }`

  **Never throws** — all errors captured in LoadResult.

  **Tests (by scenario from spec):**
  - **Scenario 1 — File missing:** Creates default seed + schema, returns `{ created: true }`
  - **Scenario 2 — Valid complete file:** Returns config, `{ created: false, merged: false }`
  - **Scenario 3 — Partial file (missing `state`):** Merges, writes back, returns `{ merged: true }`
  - **Scenario 3 — Partial file (missing nested `preferences.timezone`):** Filled from defaults
  - **Scenario 3 — Arrays not merged:** Existing `learned.patterns` preserved, not replaced
  - **Scenario 3 — Unknown keys preserved:** Extra top-level key survives merge
  - **Scenario 4 — Invalid JSON:** Returns `{ code: "parse_error" }` with details
  - **Scenario 4 — Schema failure:** Returns `{ code: "validation_error" }` with all errors
  - **Scenario 4 — Version mismatch:** Returns error with migration-needed message
  - **Idempotency:** loadSeed twice with no changes returns same result
  - **Performance:** loadSeed completes in <2s (with `large-seed.json` fixture)

### T-3.4: Loader and writer integration tests [T]
- **File:** `tests/loader.test.ts`
- **Test:** `bun test tests/loader.test.ts`
- **Dependencies:** T-3.1, T-3.2, T-3.3
- **Description:**
  Finalize and organize all loader tests using temp directory isolation:

  **Setup pattern:**
  ```typescript
  import { mkdtemp, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";

  let testDir: string;
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-test-"));
  });
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  ```

  **Test groups (organized by describe block):**
  - `resolveSeedPath` — 4 tests (from T-1.1)
  - `writeSeed` — 5 tests (from T-3.1)
  - `writeJsonSchema` — 4 tests (from T-3.2)
  - `loadSeed` — 11 tests (from T-3.3)
  - `round-trip` — write then load, verify consistency
  - `error isolation` — verify loadSeed never throws (wrap in try/catch assert)

  **Estimated total:** ~28 tests in loader.test.ts

---

## Group 4: Integration

### T-4.1: Update barrel export (index.ts) [T]
- **File:** `src/index.ts`
- **Test:** `tsc --noEmit` passes
- **Dependencies:** T-3.3
- **Description:**
  Add F-002 exports to the existing public API in `src/index.ts`:

  ```typescript
  // F-002: Loader
  export { loadSeed, writeSeed, writeJsonSchema, resolveSeedPath } from "./loader";
  export { deepMerge } from "./merge";
  export type { LoadResult, LoadError, WriteResult, WriteError } from "./loader";
  ```

  Append to existing exports — do NOT modify F-001 exports.

  **Verify:** `tsc --noEmit` passes. All new exports resolve.

### T-4.2: Full test suite and typecheck [T]
- **File:** all test files
- **Test:** `bun test` + `tsc --noEmit`
- **Dependencies:** T-4.1
- **Description:**
  Final integration verification:

  1. Run `bun test` — all tests pass (F-001 + F-002)
  2. Run `tsc --noEmit` — no type errors
  3. Verify no regressions in F-001 tests:
     - `tests/schema.test.ts` still passes
     - `tests/validate.test.ts` still passes
     - `tests/defaults.test.ts` still passes
     - `tests/json-schema.test.ts` still passes
  4. Verify F-002 test counts:
     - `tests/merge.test.ts` — ~14 tests
     - `tests/loader.test.ts` — ~28 tests
  5. Total test count: F-001 (~30) + F-002 (~42) = ~72 tests

---

## Execution Order

```
T-1.1  (types + path resolution — no deps)
  │
  ├──────────┐
  ▼          ▼
T-2.1 [P]  T-3.1 [P]   (deepMerge and writeSeed — independent)
  │          │
  ▼          ├──────────┐
T-2.2        ▼          ▼
  │        T-3.2 [P]   T-3.3  (writeJsonSchema parallel with loadSeed after writeSeed)
  │          │          │
  │          └──────────┘
  │                │
  └────────────────┘
           │
           ▼
         T-3.4  (integration tests — needs all I/O + merge)
           │
           ▼
         T-4.1  (barrel export)
           │
           ▼
         T-4.2  (full suite + typecheck)
```

**Critical path:** T-1.1 -> T-3.1 -> T-3.3 -> T-3.4 -> T-4.1 -> T-4.2
**Total tasks:** 9
**Parallelizable:** 4 (T-2.1/T-3.1, T-3.1/T-3.2)

---

## File Summary

| File | Action | Tasks |
|------|--------|-------|
| `src/merge.ts` | NEW | T-2.1 |
| `src/loader.ts` | NEW | T-1.1, T-3.1, T-3.2, T-3.3 |
| `src/index.ts` | MODIFY | T-4.1 |
| `tests/merge.test.ts` | NEW | T-2.2 |
| `tests/loader.test.ts` | NEW | T-1.1, T-3.1, T-3.2, T-3.3, T-3.4 |
