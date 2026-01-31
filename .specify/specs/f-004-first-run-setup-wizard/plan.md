# Technical Plan: First-run Setup Wizard

## Architecture Overview

F-004 is a **library layer** — it receives structured answers and produces a valid `SeedConfig`. No interactive I/O. Callers (F-005 hook, F-011 CLI) handle user prompting.

```
                          ┌─────────────────────────────────┐
                          │         Caller (hook/CLI)        │
                          │   Gathers SetupAnswers from user │
                          └──────────┬──────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        src/setup.ts (F-004)                         │
│                                                                     │
│  isFirstRun(seedPath?) ─────► loadSeed() ─────► check principalName │
│                                (F-002)                              │
│                                                                     │
│  detectTimezone() ──────────► Intl.DateTimeFormat ──► IANA string   │
│                                                                     │
│  buildSeedFromAnswers(answers) ──► createDefaultSeed() ──► merge    │
│                          (pure)       (F-001)         identity      │
│                                                    ──► validateSeed │
│                                                        (F-001)      │
│                                                                     │
│  runSetup(answers, seedPath?) ──► isFirstRun()                      │
│                                  ──► buildSeedFromAnswers()         │
│                                  ──► writeSeedWithCommit()          │
│                                       (F-003)                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. Caller collects `SetupAnswers` (how is caller's concern)
2. `isFirstRun()` checks state via `loadSeed()` from F-002
3. `buildSeedFromAnswers()` merges answers onto `createDefaultSeed()` base
4. `runSetup()` orchestrates: detect → build → write+commit

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Language | TypeScript (strict) | Project standard |
| Validation | Zod | Schema already defines all target types (`src/schema.ts`) |
| Testing | `bun test` | Existing test runner, temp directory pattern established |

**No new dependencies.** All infrastructure exists in F-001/F-002/F-003.

## Data Model

### New Types (in `src/setup.ts`)

```typescript
import { z } from "zod";

/**
 * SetupAnswers — the user's choices during first-run setup.
 * Only principalName is required. All others have sensible defaults.
 */
export const setupAnswersSchema = z.object({
  principalName: z.string().min(1),
  aiName: z.string().min(1).optional(),
  catchphrase: z.string().min(1).optional(),
  voiceId: z.string().optional(),
  responseStyle: z.enum(["concise", "detailed", "adaptive"]).optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
});

export type SetupAnswers = z.infer<typeof setupAnswersSchema>;

/**
 * SetupResult — discriminated union for runSetup() outcome.
 */
export type SetupResult =
  | { ok: true; config: SeedConfig; created: boolean }
  | { ok: false; error: string };
```

**Design decisions:**
- `SetupAnswers` gets its own Zod schema for runtime validation (consistent with project pattern)
- `principalName` is the only required field (matches spec FR-2)
- All optional fields have defaults derived in `buildSeedFromAnswers()`
- `SetupResult` follows the project's discriminated union pattern (`{ ok: true | false }`)

### Existing Types Used

| Type | Source | Usage in F-004 |
|------|--------|----------------|
| `SeedConfig` | `src/schema.ts` | Output of `buildSeedFromAnswers()` |
| `LoadResult` | `src/loader.ts` | Return type of `loadSeed()` used in `isFirstRun()` |
| `WriteResult` | `src/loader.ts` | Return type of `writeSeedWithCommit()` used in `runSetup()` |

## API Contracts

### FR-1: `isFirstRun(seedPath?): Promise<boolean>`

```typescript
export async function isFirstRun(seedPath?: string): Promise<boolean>
```

**Logic:**
1. Call `loadSeed(seedPath)` (from `src/loader.ts:152`)
2. If `!result.ok` → return `true` (safe default: prompt setup)
3. If `result.config.identity.principalName === "User"` → return `true`
4. Else → return `false`

**Never throws.** Any error from `loadSeed()` returns `true`.

**Performance:** Bounded by `loadSeed()` which is < 2s (tested in F-002). First-run check is a subset — typically < 100ms since it only reads, no merge/write.

### FR-2: `setupAnswersSchema` (Zod schema + type)

Defined in Data Model section above. Used by `buildSeedFromAnswers()` for input validation.

### FR-3: `buildSeedFromAnswers(answers): SeedConfig`

```typescript
export function buildSeedFromAnswers(answers: SetupAnswers): SeedConfig
```

**Logic:**
1. Parse `answers` through `setupAnswersSchema` (throws on invalid — programming error)
2. Call `createDefaultSeed()` (from `src/defaults.ts:15`) for base config
3. Override identity fields:
   - `principalName` ← `answers.principalName` (required)
   - `aiName` ← `answers.aiName ?? "PAI"`
   - `catchphrase` ← `answers.catchphrase ?? "${aiName} here, ready to go."`
   - `voiceId` ← `answers.voiceId ?? "default"`
4. Override preferences:
   - `responseStyle` ← `answers.responseStyle ?? "adaptive"`
   - `timezone` ← `answers.timezone ?? detectTimezone()`
   - `locale` ← `answers.locale ?? "en-US"`
5. Validate result with `validateSeed()` (from `src/validate.ts`)
6. If invalid → throw (programming error — defaults + valid answers should always produce valid config)
7. Return validated `SeedConfig`

**Pure function.** No I/O. Deterministic given the same inputs (except `detectTimezone()` fallback, which is system-dependent but stable within a session).

### FR-4: `detectTimezone(): string`

```typescript
export function detectTimezone(): string
```

**Logic:**
1. `try { return Intl.DateTimeFormat().resolvedOptions().timeZone }`
2. If result is falsy or throws → return `"UTC"`

**Pure-ish.** Reads system state but has no side effects.

### FR-5: `runSetup(answers, seedPath?): Promise<SetupResult>`

```typescript
export async function runSetup(
  answers: SetupAnswers,
  seedPath?: string
): Promise<SetupResult>
```

**Logic:**
1. Call `isFirstRun(seedPath)`
2. If not first run → load existing config via `loadSeed(seedPath)`:
   - If load succeeds → return `{ ok: true, config, created: false }`
   - If load fails → return `{ ok: false, error: loadResult.error.message }`
3. Build config via `buildSeedFromAnswers(answers)`
4. Write via `writeSeedWithCommit(config, "Init: first-run setup completed", seedPath)` (from `src/git.ts:219`)
5. If write fails → return `{ ok: false, error }`
6. Return `{ ok: true, config, created: true }`

**Idempotent.** Calling on an already-configured seed returns the existing config without modification.

## Implementation Phases

### Phase 1: Types and Pure Functions

**Files:** `src/setup.ts`

1. Define `setupAnswersSchema` (Zod) and `SetupAnswers` type
2. Define `SetupResult` type
3. Implement `detectTimezone()` — 5 lines, no dependencies
4. Implement `buildSeedFromAnswers()` — pure, uses `createDefaultSeed()` + `validateSeed()`

**Tests:** `tests/setup.test.ts`
- `detectTimezone()`: returns valid IANA string, fallback behavior
- `buildSeedFromAnswers()`: all fields provided, minimal (principalName only), derived catchphrase, invalid input throws

**Why first:** Pure functions with no I/O. Fastest to implement and test. Forms the foundation for Phase 2.

### Phase 2: First-Run Detection

**Files:** `src/setup.ts` (append)

5. Implement `isFirstRun()` — uses `loadSeed()` from F-002

**Tests:** `tests/setup.test.ts` (append)
- No seed file → `true`
- Default seed (principalName "User") → `true`
- Customized seed → `false`
- Corrupted file → `true` (safe default)

**Why second:** Depends on `loadSeed()` (F-002) but not on Phase 1 functions. Could be parallel with Phase 1, but sequential is simpler.

### Phase 3: Setup Orchestration

**Files:** `src/setup.ts` (append)

6. Implement `runSetup()` — orchestrates isFirstRun + buildSeedFromAnswers + writeSeedWithCommit

**Tests:** `tests/setup.test.ts` (append)
- First run → creates config, commits to git
- Already configured → returns existing config, `created: false`
- Write failure → returns `{ ok: false, error }`
- Idempotency: calling twice produces same result

**Why last:** Depends on both Phase 1 (`buildSeedFromAnswers`) and Phase 2 (`isFirstRun`).

### Phase 4: Export and Integration

**Files:** `src/index.ts` (edit)

7. Export new types: `SetupAnswers`, `SetupResult`
8. Export new functions: `isFirstRun`, `buildSeedFromAnswers`, `detectTimezone`, `runSetup`
9. Export schema: `setupAnswersSchema`

**Tests:** Run full suite (`bun test`) to verify no regressions.

## File Structure

```
src/
├── schema.ts         # F-001 (unchanged)
├── validate.ts       # F-001 (unchanged)
├── defaults.ts       # F-001 (unchanged)
├── json-schema.ts    # F-001 (unchanged)
├── merge.ts          # F-002 (unchanged)
├── loader.ts         # F-002 (unchanged)
├── git.ts            # F-003 (unchanged)
├── setup.ts          # F-004 (NEW — ~80 lines)
└── index.ts          # Updated with F-004 exports

tests/
├── schema.test.ts    # F-001 (unchanged)
├── validate.test.ts  # F-001 (unchanged)
├── loader.test.ts    # F-002 (unchanged)
├── git.test.ts       # F-003 (unchanged)
└── setup.test.ts     # F-004 (NEW — ~150 lines)
```

**No changes to existing files except `src/index.ts`** (adding exports).

## Dependencies

### Internal (imports from existing modules)

| Import | From | Used By |
|--------|------|---------|
| `SeedConfig` | `src/schema.ts` | Type annotation throughout |
| `validateSeed()` | `src/validate.ts` | `buildSeedFromAnswers()` validation step |
| `createDefaultSeed()` | `src/defaults.ts` | `buildSeedFromAnswers()` base config |
| `loadSeed()`, `resolveSeedPath()` | `src/loader.ts` | `isFirstRun()` state check |
| `writeSeedWithCommit()` | `src/git.ts` | `runSetup()` persistence |

### External (npm packages)

| Package | Version | Usage |
|---------|---------|-------|
| `zod` | `^3.23` (already installed) | `setupAnswersSchema` definition |

**No new external dependencies.**

### Runtime APIs

| API | Usage | Fallback |
|-----|-------|----------|
| `Intl.DateTimeFormat().resolvedOptions().timeZone` | `detectTimezone()` | `"UTC"` |

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `Intl.DateTimeFormat` not fully supported in Bun | Low | Low | Explicit fallback to `"UTC"`. Bun has strong V8/JSC Intl support. Test covers fallback path. |
| User's actual name is "User" | Low | Very low | Spec acknowledges this as acceptable false positive. `isFirstRun()` would return `true`, triggering re-setup. User can re-enter "User" as their name — `runSetup()` writes it, and subsequent `isFirstRun()` checks still see "User" as default. **Note:** This is a spec-level decision, not a plan-level problem. If it becomes an issue, F-004 could add a `setupCompleted: boolean` flag to state layer (requires F-001 schema change). |
| `loadSeed()` returns merged result where principalName was filled from defaults | Medium | Low | `isFirstRun()` checks `principalName === "User"` which is the default value. A merged file that had no principalName gets `"User"` from defaults → correctly detected as first-run. |
| `writeSeedWithCommit()` git failure | Low | Low | Git is non-fatal by design (F-003). Write succeeds even if commit fails. `runSetup()` returns `ok: true` as long as the file write succeeds. |
| Race condition: two sessions both detect first-run | Low | Very low | `writeSeed()` uses atomic write (tmp+rename). Last writer wins. Both produce valid configs. Not a practical concern for single-user system. |
| `buildSeedFromAnswers()` called with empty string principalName | Low | Low | Zod schema enforces `z.string().min(1)`. Throws at parse step — caller's responsibility to validate before calling (spec FR-3: "programming error"). |

## Test Strategy

Following established patterns from `tests/git.test.ts` and `tests/loader.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-setup-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

**Test categories:**

| Category | Count | Focus |
|----------|-------|-------|
| `detectTimezone()` | 2 | Returns IANA string, fallback |
| `buildSeedFromAnswers()` | 5 | Full answers, minimal, derived catchphrase, custom catchphrase, invalid throws |
| `isFirstRun()` | 4 | No file, default seed, customized seed, corrupted file |
| `runSetup()` | 4 | First run creates, already configured returns, write failure, idempotency |
| Performance | 1 | `isFirstRun()` < 100ms |

**Total: ~16 test cases**
