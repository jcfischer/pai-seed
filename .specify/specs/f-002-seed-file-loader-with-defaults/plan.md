# Technical Plan: Seed File Loader with Defaults

## Architecture Overview

```
                         loadSeed(path?)
                              │
                    ┌─────────▼──────────┐
                    │   Resolve Path      │
                    │   (~/.pai/seed.json)│
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Read File         │
                    │   (Bun.file.text()) │
                    └─────────┬──────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
          File exists               File missing
                 │                         │
       ┌─────────▼──────────┐    ┌─────────▼──────────┐
       │  JSON.parse()       │    │  createDefaultSeed() │
       │  validateSeed()     │    │  writeSeed()         │
       └─────────┬──────────┘    │  writeJsonSchema()   │
                 │               └─────────┬──────────┘
          ┌──────┴──────┐                  │
          │             │          return { ok, created: true }
      Valid          Invalid
          │             │
  ┌───────▼───────┐     │
  │ deepMerge()   │     └──► return { ok: false, error }
  │ with defaults │
  └───────┬───────┘
          │
    ┌─────┴─────┐
    │           │
 Changed    Unchanged
    │           │
 writeSeed()    │
    │           │
    └─────┬─────┘
          │
  return { ok, merged }


                         writeSeed(config, path?)
                              │
                    ┌─────────▼──────────┐
                    │  validateSeed()     │
                    │  (reject invalid)   │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  mkdir -p parent    │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Write to .tmp      │
                    │  (Bun.write)        │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  rename .tmp → final│
                    │  (fs.rename)        │
                    └─────────┬──────────┘
                              │
                    return { ok: true }
```

**Design principle:** F-002 is a thin I/O shell around F-001's pure logic. All validation, schema generation, and default creation delegate to F-001 exports. F-002 adds filesystem operations, error wrapping, and the deep merge strategy.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard. `Bun.file()` and `Bun.write()` for fast I/O |
| Path resolution | `node:path` + `node:os` | `path.resolve()`, `path.join()`, `os.homedir()` — standard, cross-platform |
| Directory creation | `node:fs/promises` | `mkdir({ recursive: true })` — Bun supports node:fs |
| Atomic rename | `node:fs/promises` | `rename()` — POSIX atomic on same filesystem |
| Validation | F-001 exports | `validateSeed()`, `createDefaultSeed()`, `generateJsonSchema()` |
| Testing | `bun:test` | Project pattern, mock fs via temp directories |

**No new dependencies.** Everything needed is in Bun's standard library plus F-001 exports.

## Data Model

### New Types (F-002)

```typescript
// --- Load Result ---

type LoadResult =
  | { ok: true; config: SeedConfig; created: boolean; merged: boolean; warnings?: string[] }
  | { ok: false; error: LoadError };

type LoadError = {
  code: "parse_error" | "validation_error" | "read_error" | "permission_error";
  message: string;
  details?: ValidationError[];  // re-exported from F-001
};

// --- Write Result ---

type WriteResult =
  | { ok: true }
  | { ok: false; error: WriteError };

type WriteError = {
  code: "validation_error" | "write_error" | "permission_error";
  message: string;
  details?: ValidationError[];
};
```

### Reused from F-001

| Type | Source | Usage in F-002 |
|------|--------|----------------|
| `SeedConfig` | `src/schema.ts` | Return type, merge input/output |
| `ValidationResult` | `src/validate.ts` | Internal: validateSeed() returns |
| `ValidationError` | `src/validate.ts` | Forwarded in LoadError.details |

## API Contracts

### `loadSeed(seedPath?: string): Promise<LoadResult>`

| Aspect | Detail |
|--------|--------|
| Default path | `~/.pai/seed.json` (resolved via `os.homedir()`) |
| File missing | Creates default seed + schema, returns `{ ok: true, created: true, merged: false }` |
| File valid, complete | Returns `{ ok: true, created: false, merged: false }` |
| File valid, partial | Deep merges with defaults, writes back if changed, returns `{ ok: true, merged: true }` |
| Invalid JSON | Returns `{ ok: false, error: { code: "parse_error", message } }` |
| Schema invalid | Returns `{ ok: false, error: { code: "validation_error", details } }` |
| Permission denied | Returns `{ ok: false, error: { code: "permission_error", message } }` |
| Read error | Returns `{ ok: false, error: { code: "read_error", message } }` |
| Never throws | All errors captured in result type |

### `writeSeed(config: SeedConfig, seedPath?: string): Promise<WriteResult>`

| Aspect | Detail |
|--------|--------|
| Pre-write validation | Validates via `validateSeed()` — rejects invalid data |
| Atomic write | Write to `{path}.tmp` then `rename()` |
| Directory creation | `mkdir -p` on parent directory |
| Formatting | `JSON.stringify(config, null, 2) + "\n"` |
| Default path | `~/.pai/seed.json` |

### `writeJsonSchema(schemaPath?: string): Promise<WriteResult>`

| Aspect | Detail |
|--------|--------|
| Generation | Delegates to `generateJsonSchema()` from F-001 |
| Default path | `~/.pai/seed.schema.json` |
| Atomic write | Same temp+rename pattern as writeSeed |
| Formatting | `JSON.stringify(schema, null, 2) + "\n"` |

### `resolveSeedPath(seedPath?: string): string`

| Aspect | Detail |
|--------|--------|
| Default | `path.join(os.homedir(), ".pai", "seed.json")` |
| Override | Returns `path.resolve(seedPath)` |
| Exported | Yes — downstream features need consistent path resolution |

### `deepMerge(existing: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown>`

| Aspect | Detail |
|--------|--------|
| Exported | Yes — standalone utility, separately testable |
| Pure function | No side effects, returns new object |

## Deep Merge Strategy

The merge algorithm is the most nuanced part of F-002. It must handle forward-compatibility (unknown keys), prevent data loss (existing values win), and avoid array duplication.

### Rules

```
Given: existing (from disk), defaults (from createDefaultSeed())

For each key in union(existing.keys, defaults.keys):

  1. Key only in existing    → keep existing value (passthrough)
  2. Key only in defaults    → use default value (fill missing)
  3. Both exist, both objects (non-array, non-null)
                             → recurse: deepMerge(existing[key], defaults[key])
  4. Both exist, either is array
                             → keep existing value (no array merge)
  5. Both exist, primitives  → keep existing value (existing wins)
```

### Implementation

```typescript
export function deepMerge(
  existing: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };

  for (const key of Object.keys(defaults)) {
    if (!(key in existing)) {
      // Rule 2: missing key — fill from defaults
      result[key] = defaults[key];
    } else if (
      isPlainObject(existing[key]) && isPlainObject(defaults[key])
    ) {
      // Rule 3: both objects — recurse
      result[key] = deepMerge(
        existing[key] as Record<string, unknown>,
        defaults[key] as Record<string, unknown>,
      );
    }
    // Rules 1, 4, 5: existing value already in result via spread
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

### Merge Examples

| Input | Result |
|-------|--------|
| Existing: `{ identity: { principalName: "Dan" } }`, Default: `{ identity: { principalName: "User", aiName: "PAI" } }` | `{ identity: { principalName: "Dan", aiName: "PAI" } }` |
| Existing: `{ learned: { patterns: [A, B] } }`, Default: `{ learned: { patterns: [] } }` | `{ learned: { patterns: [A, B] } }` — array NOT merged |
| Existing: `{ customField: "value" }`, Default: `{}` | `{ customField: "value" }` — unknown key preserved |
| Existing: `{}`, Default: `{ state: { proposals: [] } }` | `{ state: { proposals: [] } }` — missing section filled |

### Change Detection

After merging, compare with the original to determine if a write-back is needed:

```typescript
const merged = deepMerge(parsed, defaults);
const changed = JSON.stringify(merged) !== JSON.stringify(parsed);
```

`JSON.stringify` comparison is sufficient because:
- Key order is deterministic (spread preserves insertion order, `Object.keys` iterates in insertion order)
- No circular references (seed is a tree)
- No special types (dates, regexes) — all primitives, arrays, objects

## File Structure

```
src/
├── schema.ts          # F-001 (unchanged)
├── validate.ts        # F-001 (unchanged)
├── defaults.ts        # F-001 (unchanged)
├── json-schema.ts     # F-001 (unchanged)
├── merge.ts           # NEW: deepMerge() + isPlainObject()
├── loader.ts          # NEW: loadSeed(), writeSeed(), writeJsonSchema(), resolveSeedPath()
└── index.ts           # MODIFIED: add F-002 exports

tests/
├── schema.test.ts     # F-001 (unchanged)
├── validate.test.ts   # F-001 (unchanged)
├── defaults.test.ts   # F-001 (unchanged)
├── json-schema.test.ts # F-001 (unchanged)
├── merge.test.ts      # NEW: deepMerge unit tests
├── loader.test.ts     # NEW: loadSeed/writeSeed integration tests
└── fixtures/          # (unchanged, plus potentially new fixtures)
```

### Why Two Files

- **`merge.ts`** — Pure function, zero dependencies beyond type checking. Independently testable with simple unit tests. No I/O.
- **`loader.ts`** — All I/O operations. Depends on F-001 exports + merge.ts. Tests use temp directories for real filesystem interaction.

This separation keeps the merge logic testable without filesystem mocking.

## Implementation Phases

### Phase 1: Types and Path Resolution

**Files:** `src/loader.ts` (types + `resolveSeedPath`)

- Define `LoadResult`, `LoadError`, `WriteResult`, `WriteError` types
- Implement `resolveSeedPath()` with `os.homedir()` + path override
- Export types from `src/index.ts`

**Verify:** Types compile. `resolveSeedPath()` returns correct absolute paths.

### Phase 2: Deep Merge

**Files:** `src/merge.ts`, `tests/merge.test.ts`

- Implement `deepMerge()` and `isPlainObject()`
- Test cases:
  - Empty existing + full defaults → returns defaults
  - Full existing + empty defaults → returns existing
  - Partial existing → missing fields filled
  - Nested objects merge recursively
  - Arrays are NOT merged (existing wins)
  - Unknown keys preserved
  - Primitives: existing wins
  - `null` values treated as primitives (not objects)
  - Deep nesting (3+ levels)

**Verify:** All merge rules covered. Pure function, no side effects.

### Phase 3: Atomic Write

**Files:** `src/loader.ts` (add `writeSeed`, `writeJsonSchema`), `tests/loader.test.ts` (start)

- Implement atomic write helper: temp file → rename
- Implement `writeSeed()`: validate → mkdir → atomic write
- Implement `writeJsonSchema()`: generate → mkdir → atomic write
- Test cases:
  - Write valid config, read back, compare
  - Write invalid config → returns validation error
  - Write to non-existent directory → creates it
  - Atomic: verify no partial writes (write to temp, rename)
  - JSON formatting: 2-space indent + trailing newline

**Verify:** Written files are valid JSON. Invalid configs rejected before write.

### Phase 4: Load Seed

**Files:** `src/loader.ts` (add `loadSeed`), `tests/loader.test.ts` (expand)

- Implement `loadSeed()` orchestrating the full flow
- Test cases:
  - **File missing:** Creates default seed + schema, returns `{ created: true }`
  - **File valid, complete:** Returns config, `{ created: false, merged: false }`
  - **File valid, partial:** Merges, writes back, returns `{ merged: true }`
  - **Invalid JSON:** Returns `{ code: "parse_error" }`
  - **Schema failure:** Returns `{ code: "validation_error", details }`
  - **Permission error:** Returns `{ code: "permission_error" }` (test with read-only dir)
  - **Unknown keys:** Preserved in merge, warnings in result
  - **Performance:** loadSeed completes in <2s (use existing large-seed fixture)

**Verify:** All 5 spec scenarios covered. Never throws.

### Phase 5: Export and Integration

**Files:** `src/index.ts` (add exports)

- Add to public API:
  ```typescript
  export { loadSeed, writeSeed, writeJsonSchema, resolveSeedPath } from "./loader";
  export { deepMerge } from "./merge";
  export type { LoadResult, LoadError, WriteResult, WriteError } from "./loader";
  ```
- Run full test suite: `bun test`
- Run typecheck: `tsc --noEmit`

**Verify:** All tests pass. Types compile. No regressions in F-001 tests.

## Test Strategy

### Filesystem Isolation

All tests use temp directories, never `~/.pai/`:

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

### Test Matrix

| Category | Test Count (est.) | File |
|----------|------------------|------|
| deepMerge rules | ~12 | `merge.test.ts` |
| writeSeed (valid/invalid/atomic) | ~8 | `loader.test.ts` |
| writeJsonSchema | ~3 | `loader.test.ts` |
| loadSeed scenarios (5 from spec) | ~10 | `loader.test.ts` |
| resolveSeedPath | ~4 | `loader.test.ts` |
| Error mapping (parse/validation/permission/read) | ~6 | `loader.test.ts` |
| Performance | ~1 | `loader.test.ts` |
| **Total** | **~44** | |

### Fixture Reuse

Reuse existing `tests/fixtures/` from F-001:
- `valid-seed.json` — test loadSeed happy path
- `valid-seed-minimal.json` — test loadSeed with minimal file
- `invalid-missing-version.json` — test validation error path
- `invalid-wrong-types.json` — test validation error details
- `large-seed.json` — performance test for loadSeed <2s

## Error Handling Strategy

### Error Classification

```
Filesystem errors (from Bun/Node)
  │
  ├── ENOENT        → file missing path (create defaults)
  ├── EACCES/EPERM  → LoadError { code: "permission_error" }
  ├── EISDIR        → LoadError { code: "read_error" }
  └── other         → LoadError { code: "read_error" }

Parse errors (from JSON.parse)
  └── SyntaxError   → LoadError { code: "parse_error", message: syntaxError.message }

Validation errors (from validateSeed)
  └── { valid: false } → LoadError { code: "validation_error", details: errors }
```

### Error Detection Pattern

```typescript
try {
  const text = await Bun.file(seedPath).text();
  // ...
} catch (err: unknown) {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File missing — normal path, create defaults
    } else if (code === "EACCES" || code === "EPERM") {
      return { ok: false, error: { code: "permission_error", message: err.message } };
    } else {
      return { ok: false, error: { code: "read_error", message: err.message } };
    }
  }
}
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `$HOME` unset in container/CI | Medium | Low | `os.homedir()` falls back to `/` on POSIX. Detect and return clear error. All functions accept path override. |
| Atomic rename fails across filesystems | High | Very Low | Temp file written in same directory as target (`.seed.json.tmp` next to `seed.json`), so rename stays on same filesystem. |
| Permission denied on `~/.pai/` | Medium | Low | Return `permission_error` — caller decides recovery. Don't auto-escalate or fallback. |
| Deep merge infinite recursion | High | Very Low | `isPlainObject` guard excludes null, arrays, primitives. Real seed data is max 4 levels deep. |
| JSON.stringify comparison misses key order changes | Low | Low | Spread operator preserves insertion order. For extra safety, could sort keys — but not needed for v1 since we control the merge output shape. |
| Concurrent writes (two sessions) | Medium | Medium | Out of scope per spec. F-003 git strategy handles this. `writeSeed` makes single writes atomic but doesn't lock. |
| Large seed performance >2s | Low | Very Low | F-001 validates 1600-entry seed in <50ms. File I/O for a ~100KB JSON file is <10ms. Well within budget. |

## Dependencies

### Upstream (F-002 consumes)

| Dependency | Import | Used By |
|------------|--------|---------|
| `validateSeed` | `src/validate.ts` | loadSeed (validation), writeSeed (pre-write check) |
| `createDefaultSeed` | `src/defaults.ts` | loadSeed (file missing + merge base) |
| `generateJsonSchema` | `src/json-schema.ts` | writeJsonSchema |
| `SeedConfig` | `src/schema.ts` | All function signatures |
| `ValidationError` | `src/validate.ts` | LoadError.details, WriteError.details |

### Downstream (F-002 provides)

| Consumer | What They Import | Why |
|----------|-----------------|-----|
| F-003 | `loadSeed`, `writeSeed` | Git persistence |
| F-005 | `loadSeed` | Session startup |
| F-006 | `loadSeed`, `writeSeed` | Extraction proposals |
| F-007 | `loadSeed`, `writeSeed` | Confirmation flow |
| F-011 | `loadSeed`, `writeSeed`, `resolveSeedPath` | CLI commands |
| F-014 | `loadSeed` | Migration detection |

### Package Dependencies

**None new.** All I/O uses Bun built-ins and Node standard library modules already available.
