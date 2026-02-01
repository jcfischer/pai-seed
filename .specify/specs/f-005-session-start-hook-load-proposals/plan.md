# Technical Plan: Session Start Hook (Load + Proposals)

## Architecture Overview

F-005 is a **read-only library layer** — it loads seed state and formats it as text for injection into Claude Code's context via a SessionStart hook. No writes to seed.json. No interactive I/O.

```
                        sessionStartHook(seedPath?)
                                │
                                ▼
                      generateSessionContext(seedPath?)
                                │
                   ┌────────────┴────────────┐
                   │                         │
            isFirstRun(seedPath?)      loadSeedWithGit(seedPath?)
               (F-004)                      (F-003)
                   │                         │
            ┌──────┴──────┐           ┌──────┴──────┐
            │             │           │             │
         true          false     { ok: true }  { ok: false }
            │             │           │             │
     Return setup     Continue    SeedConfig    Return error
     needed context       │           │
                          │           │
                          └─────┬─────┘
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   Format Context String  │
                   │                         │
                   │  formatIdentitySummary() │ ◄── identity layer
                   │  formatLearningSummary() │ ◄── learned layer
                   │  formatProposals()       │ ◄── state.proposals
                   │  formatSessionState()    │ ◄── state layer
                   │                         │
                   └────────────┬────────────┘
                                │
                                ▼
                        SessionContext {
                          ok: true,
                          context: string,    ◄── concatenated formatted text
                          needsSetup: false,
                          config: SeedConfig,
                          proposalCount: N
                        }
                                │
                                ▼
                   sessionStartHook() returns context string
                   (ready for console.log / stdout)
```

**Data flow:**
1. `sessionStartHook()` is the entry point — thin wrapper that calls `generateSessionContext()` and extracts the string
2. `generateSessionContext()` orchestrates: check first-run → load seed → format sections → return structured result
3. Four pure formatters produce text from typed data — no I/O, no side effects
4. Callers (hook scripts) just `console.log(await sessionStartHook())` to stdout

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Language | TypeScript (strict) | Project standard |
| Testing | `bun:test` | Existing test runner, temp directory pattern established |

**No new dependencies.** All infrastructure exists in F-001/F-002/F-003/F-004.

## Data Model

### New Types (in `src/session.ts`)

```typescript
/**
 * SessionContext — structured result of context generation.
 * Discriminated union following project pattern (ok: true | false).
 */
export type SessionContext =
  | {
      ok: true;
      context: string;           // Formatted text for system-reminder injection
      needsSetup: boolean;       // True if isFirstRun()
      config: SeedConfig | null; // The loaded config (null if first run)
      proposalCount: number;     // Number of pending proposals
    }
  | {
      ok: false;
      error: string;
    };
```

**Design decisions:**
- `SessionContext` follows the project's discriminated union pattern (`{ ok: true | false }`) used in `LoadResult`, `WriteResult`, `SetupResult`, `GitResult`
- `config: SeedConfig | null` — null when `needsSetup: true` (no valid config exists yet)
- `proposalCount` surfaces pending count without callers needing to parse the context string
- No new Zod schema needed — `SessionContext` is an output type, not user input

### Existing Types Used

| Type | Source | Usage in F-005 |
|------|--------|----------------|
| `SeedConfig` | `src/schema.ts` | Input to formatters, returned in SessionContext |
| `IdentityLayer` | `src/schema.ts` | Input to `formatIdentitySummary()` |
| `LearnedLayer` | `src/schema.ts` | Input to `formatLearningSummary()` |
| `StateLayer` | `src/schema.ts` | Input to `formatSessionState()` |
| `Proposal` | `src/schema.ts` | Input to `formatProposals()` |
| `LoadResult` | `src/loader.ts` | Return type of `loadSeedWithGit()` used in `generateSessionContext()` |

## API Contracts

### FR-2: `formatIdentitySummary(identity: IdentityLayer): string`

```typescript
export function formatIdentitySummary(identity: IdentityLayer): string
```

**Pure function.** No I/O. Deterministic.

**Logic:**
1. Format: AI name, principal name, catchphrase
2. Format: response style, timezone, locale from preferences
3. Return multi-line text

**Output example:**
```
Identity: Ivy (working with Jens-Christian)
Catchphrase: "Ivy here, ready to go."
Style: adaptive | Timezone: Europe/Zurich | Locale: en-US
```

**Edge case:** Default values (principalName "User", aiName "PAI") format identically — no special handling needed.

### FR-3: `formatLearningSummary(learned: LearnedLayer): string`

```typescript
export function formatLearningSummary(learned: LearnedLayer): string
```

**Pure function.** No I/O. Deterministic.

**Logic:**
1. Count each category: `patterns.length`, `insights.length`, `selfKnowledge.length`
2. If all counts are 0 → return empty string (no noise)
3. Format summary line: `"Learnings: N patterns, N insights, N self-knowledge"`
4. For each non-empty category, list confirmed items (up to 5)
5. If category has more than 5 confirmed items → show 5 + `"... and N more"`
6. Confirmed items shown with `"- "` prefix and content text

**Output example (populated):**
```
Learnings: 3 patterns, 1 insight, 1 self-knowledge
Recent patterns:
  - Prefers TypeScript over Python for all projects
  - Uses Bun as the JavaScript runtime, never npm/yarn/pnpm
  - Writes tests before implementation (TDD mandatory)
Recent insights:
  - Morning sessions are more productive for architecture work
```

**Output (empty):** empty string `""`

**Truncation example (>5 confirmed patterns):**
```
Recent patterns:
  - Item 1
  - Item 2
  - Item 3
  - Item 4
  - Item 5
  ... and 3 more
```

**Note:** Show confirmed items first (they carry more weight). Unconfirmed items are counted in the summary line but not listed — they're proposals, not established knowledge.

### FR-4: `formatProposals(proposals: Proposal[]): string`

```typescript
export function formatProposals(proposals: Proposal[]): string
```

**Pure function.** No I/O. Deterministic.

**Logic:**
1. Filter to `status === "pending"` only
2. If no pending proposals → return empty string
3. Format header: `"Pending proposals (N):"`
4. Number each proposal: `"  N. [type] \"content\" (from source)"`

**Output example:**
```
Pending proposals (1):
  1. [pattern] "Prefers Chart.js over D3 for data visualization" (from session_2026-01-30)
```

**Edge cases:**
- Empty array → `""`
- Array with no pending (all accepted/rejected) → `""`
- Single pending → `"Pending proposals (1):\n  1. ..."`

### FR-5: `formatSessionState(state: StateLayer): string`

```typescript
export function formatSessionState(state: StateLayer): string
```

**Pure function.** No I/O. Deterministic.

**Logic:**
1. Format last session: `"Last session: <timestamp>"` or `"Last session: never"` if `lastSessionAt` is undefined
2. Format active projects: `"Active projects: proj1, proj2, proj3"` or `"Active projects: none"` if empty
3. Format checkpoint: `"Checkpoint: <ref>"` only if `checkpointRef` is defined
4. Format seed version from parent context (passed separately or omitted — see note)

**Note on version:** The spec says "Context includes seed version." The `StateLayer` type doesn't contain version — it's on `SeedConfig.version`. Rather than changing the function signature, `generateSessionContext()` will prepend the version line separately since it has access to the full `SeedConfig`.

**Output example:**
```
Last session: 2026-01-30T18:45:00Z
Active projects: pai-seed, reporter, ragent
Checkpoint: checkpoint_2026-01-30_001
```

**Output (empty state):**
```
Last session: never
Active projects: none
```

### FR-1: `generateSessionContext(seedPath?: string): Promise<SessionContext>`

```typescript
export async function generateSessionContext(
  seedPath?: string
): Promise<SessionContext>
```

**Orchestrator function.** Has I/O (reads seed via F-002/F-003). Delegates formatting to pure functions.

**Logic:**
1. Call `isFirstRun(seedPath)` from F-004
2. If first run → return:
   ```typescript
   {
     ok: true,
     context: "PAI seed not configured. Run setup to initialize.",
     needsSetup: true,
     config: null,
     proposalCount: 0,
   }
   ```
3. Call `loadSeedWithGit(seedPath)` from F-003
4. If load fails → return `{ ok: false, error: loadResult.error.message }`
5. Extract `config` from load result
6. Count pending proposals: `config.state.proposals.filter(p => p.status === "pending").length`
7. Build context string by concatenating (with blank line separators):
   - Version line: `"Seed: v${config.version}"`
   - `formatIdentitySummary(config.identity)`
   - `formatLearningSummary(config.learned)`
   - `formatProposals(config.state.proposals)`
   - `formatSessionState(config.state)`
8. Trim empty sections (skip blank lines from empty formatters)
9. Return `{ ok: true, context, needsSetup: false, config, proposalCount }`

**Never throws.** All errors wrapped in result type.

**Performance:** Dominated by `loadSeedWithGit()` which includes file I/O and git init check. Expected < 500ms total.

### FR-6: `sessionStartHook(seedPath?: string): Promise<string>`

```typescript
export async function sessionStartHook(seedPath?: string): Promise<string>
```

**Thin entry point.** Calls `generateSessionContext()` and extracts the string.

**Logic:**
1. Call `generateSessionContext(seedPath)`
2. If `result.ok` → return `result.context`
3. If `!result.ok` → return `"PAI session context error: ${result.error}"`
4. **Never exits non-zero.** Hook failures should not block Claude Code startup.

**Output contract:**
- Always returns a string (never throws, never returns undefined)
- The string is ready for `console.log()` / stdout
- On error: returns human-readable error message (not a stack trace)

## Context String Format

The complete formatted context string produced by `generateSessionContext()`:

```
Seed: v1.0.0
Identity: Ivy (working with Jens-Christian)
Catchphrase: "Ivy here, ready to go."
Style: adaptive | Timezone: Europe/Zurich | Locale: en-US

Learnings: 3 patterns, 1 insight, 1 self-knowledge
Recent patterns:
  - Prefers TypeScript over Python for all projects
  - Uses Bun as the JavaScript runtime, never npm/yarn/pnpm
  - Writes tests before implementation (TDD mandatory)
Recent insights:
  - Morning sessions are more productive for architecture work

Pending proposals (1):
  1. [pattern] "Prefers Chart.js over D3 for data visualization" (from session_2026-01-30)

Last session: 2026-01-30T18:45:00Z
Active projects: pai-seed, reporter, ragent
Checkpoint: checkpoint_2026-01-30_001
```

**First-run output:**
```
PAI seed not configured. Run setup to initialize.
```

**Error output:**
```
PAI session context error: Failed to read seed file: EACCES permission denied
```

## Implementation Phases

### Phase 1: Pure Formatters

**Files:** `src/session.ts` (new), `tests/session.test.ts` (new)

1. Define `SessionContext` type
2. Implement `formatIdentitySummary(identity)` — ~10 lines
3. Implement `formatLearningSummary(learned)` — ~25 lines (handles truncation)
4. Implement `formatProposals(proposals)` — ~12 lines (filter + format)
5. Implement `formatSessionState(state)` — ~12 lines

**Tests:** `tests/session.test.ts`
- `formatIdentitySummary()`: all fields populated, default values
- `formatLearningSummary()`: populated learnings, empty learnings, truncation at 5, only confirmed shown in list
- `formatProposals()`: pending proposals, empty array, mixed statuses (only pending shown), single proposal
- `formatSessionState()`: full state, empty state (never/none), no checkpoint

**Why first:** Pure functions with zero dependencies beyond types. Fastest to implement and test. Forms the foundation for Phase 2.

### Phase 2: Context Generation

**Files:** `src/session.ts` (append)

6. Implement `generateSessionContext(seedPath?)` — ~30 lines
   - Calls `isFirstRun()` from F-004
   - Calls `loadSeedWithGit()` from F-003
   - Concatenates formatter outputs
   - Returns `SessionContext`

**Tests:** `tests/session.test.ts` (append)
- Normal seed → returns formatted context with all sections
- First run (no file) → returns `needsSetup: true` with setup message
- First run (principalName "User") → returns `needsSetup: true`
- Load error → returns `{ ok: false, error }`
- Empty learnings → context omits learnings section
- No pending proposals → context omits proposals section
- `proposalCount` matches pending filter count

**Why second:** Depends on Phase 1 formatters plus F-003/F-004 functions. Tests use temp directories.

### Phase 3: Hook Entry Point

**Files:** `src/session.ts` (append)

7. Implement `sessionStartHook(seedPath?)` — ~8 lines
   - Calls `generateSessionContext()`
   - Extracts string, handles error case

**Tests:** `tests/session.test.ts` (append)
- Normal seed → returns non-empty string
- First run → returns setup message string
- Error → returns error message string (never throws)
- Return type is always string

**Why last:** Depends on Phase 2. Thinnest layer — mostly testing the contract.

### Phase 4: Exports and Integration

**Files:** `src/index.ts` (edit)

8. Add F-005 export section:
   ```typescript
   // =============================================================================
   // F-005: Session start hook
   // =============================================================================

   // Types
   export type { SessionContext } from "./session";

   // Functions
   export {
     formatIdentitySummary,
     formatLearningSummary,
     formatProposals,
     formatSessionState,
     generateSessionContext,
     sessionStartHook,
   } from "./session";
   ```

9. Run full test suite: `bun test` — verify no regressions in F-001/F-002/F-003/F-004

**Why last:** Integration step. All new code tested in isolation first.

## File Structure

```
src/
├── schema.ts          # F-001 (unchanged)
├── validate.ts        # F-001 (unchanged)
├── defaults.ts        # F-001 (unchanged)
├── json-schema.ts     # F-001 (unchanged)
├── merge.ts           # F-002 (unchanged)
├── loader.ts          # F-002 (unchanged)
├── git.ts             # F-003 (unchanged)
├── setup.ts           # F-004 (unchanged)
├── session.ts         # F-005 (NEW — ~100 lines)
└── index.ts           # MODIFIED: add F-005 exports

tests/
├── schema.test.ts     # F-001 (unchanged)
├── validate.test.ts   # F-001 (unchanged)
├── defaults.test.ts   # F-001 (unchanged)
├── json-schema.test.ts # F-001 (unchanged)
├── merge.test.ts      # F-002 (unchanged)
├── loader.test.ts     # F-002 (unchanged)
├── git.test.ts        # F-003 (unchanged)
├── setup.test.ts      # F-004 (unchanged)
├── session.test.ts    # F-005 (NEW — ~200 lines)
└── fixtures/          # (unchanged — reuses valid-seed.json for test data)
```

### Why One File

All F-005 logic goes in `src/session.ts` because:
- All functions serve a single purpose: formatting seed state as session context
- The formatters are called only by `generateSessionContext()` — cohesive unit
- The file will be ~100 lines (smaller than `loader.ts` at ~293 lines or `git.ts` at ~350 lines)
- Keeps the import graph simple: `session.ts` imports from `setup.ts` and `git.ts`, never the reverse

## Dependencies

### Upstream (F-005 consumes)

| Dependency | Import | Used By |
|------------|--------|---------|
| `SeedConfig`, `IdentityLayer`, `LearnedLayer`, `StateLayer`, `Proposal` | `src/schema.ts` | All formatter function signatures |
| `loadSeedWithGit()` | `src/git.ts` | `generateSessionContext()` — loads seed with git integration |
| `isFirstRun()` | `src/setup.ts` | `generateSessionContext()` — detects first-run state |
| `LoadResult` | `src/loader.ts` | Internal type for `loadSeedWithGit()` return |

### Downstream (F-005 provides)

| Consumer | What They Import | Why |
|----------|-----------------|-----|
| PAI hooks | `sessionStartHook()` | Thin wrapper hook calls this, outputs to stdout |
| F-011 CLI | `generateSessionContext()` | `pai seed status` command displays context |

### Package Dependencies

**None new.** All functions use string concatenation and array operations on existing types.

## Test Strategy

### Test Isolation

Pure formatters need no I/O setup — they take typed data and return strings. Only `generateSessionContext()` and `sessionStartHook()` need temp directories (for seed file I/O).

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultSeed } from "../src/defaults";

// For pure formatter tests — no setup needed
describe("formatIdentitySummary", () => {
  test("formats all identity fields", () => {
    const identity = createDefaultSeed().identity;
    const result = formatIdentitySummary(identity);
    expect(result).toContain("PAI");
    expect(result).toContain("User");
  });
});

// For I/O tests — temp directory
let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-seed-session-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

### Test Fixtures

Reuse existing `tests/fixtures/valid-seed.json` for constructing test data. Pure formatter tests create `SeedConfig` objects directly using `createDefaultSeed()` plus overrides — no file fixtures needed.

### Test Matrix

| Category | Test Count (est.) | Phase |
|----------|------------------|-------|
| `formatIdentitySummary()` | 2 | 1 |
| `formatLearningSummary()` | 4 | 1 |
| `formatProposals()` | 4 | 1 |
| `formatSessionState()` | 3 | 1 |
| `generateSessionContext()` — normal | 3 | 2 |
| `generateSessionContext()` — first run | 2 | 2 |
| `generateSessionContext()` — error | 1 | 2 |
| `generateSessionContext()` — edge cases | 2 | 2 |
| `sessionStartHook()` | 3 | 3 |
| Performance | 1 | 2 |
| **Total** | **~25** | |

### Performance Budget

Spec requires `generateSessionContext()` completes in < 500ms. The bottleneck is `loadSeedWithGit()` which includes file I/O and git init check. Formatters are pure string operations — negligible.

```typescript
test("completes within 500ms", async () => {
  // Write a valid seed first
  await writeSeed(createDefaultSeed(), join(testDir, "seed.json"));

  const start = performance.now();
  await generateSessionContext(join(testDir, "seed.json"));
  expect(performance.now() - start).toBeLessThan(500);
});
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Large learned section exceeds system-reminder size limits | Medium | Low | Truncation built into `formatLearningSummary()` — max 5 items per category with count. Even with max truncation, output is bounded. |
| `loadSeedWithGit()` initializes git repo as side effect | Low | Medium | Documented behavior from F-003. `generateSessionContext()` is read-only *from seed.json's perspective* — git init is an infrastructure concern that F-003 handles idempotently. |
| `isFirstRun()` returns true for corrupted seed → setup message instead of error | Low | Low | Matches spec: first-run detection includes "Seed is corrupted/unreadable" per F-004. The setup flow will handle re-initialization. |
| Context string format changes break downstream hook consumers | Medium | Low | `sessionStartHook()` returns plain text — no structured parsing contract. Hook consumers just inject the string as-is. Format changes are cosmetic, not breaking. |
| Date formatting varies across locales/runtimes | Low | Very Low | Spec says "simple date formatting" — we use the raw ISO 8601 timestamp from seed.json. No locale-sensitive formatting. |
| Race between `isFirstRun()` and `loadSeedWithGit()` — file created between calls | Low | Very Low | Both calls are sequential within the same async function. No concurrent access in single-user system. Even if another process creates the file between calls, `loadSeedWithGit()` handles the "already exists" case correctly. |
