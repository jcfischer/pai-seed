# Implementation Tasks: Session Start Hook (Load + Proposals)

**Feature:** F-005
**Spec:** `.specify/specs/f-005-session-start-hook-load-proposals/spec.md`
**Plan:** `.specify/specs/f-005-session-start-hook-load-proposals/plan.md`

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | SessionContext type + exports scaffold |
| T-1.2 | ☐ | formatIdentitySummary |
| T-1.3 | ☐ | formatLearningSummary |
| T-1.4 | ☐ | formatProposals |
| T-1.5 | ☐ | formatSessionState |
| T-2.1 | ☐ | generateSessionContext |
| T-3.1 | ☐ | sessionStartHook |
| T-4.1 | ☐ | Exports + regression |

---

## Group 1: Pure Formatters

### T-1.1: Create session module with SessionContext type [T]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** none
- **Description:**
  Create `src/session.ts` with the `SessionContext` discriminated union type and `ContextMode` type. Create `tests/session.test.ts` with the test scaffold (imports, temp directory lifecycle via `beforeEach`/`afterEach`). No logic yet — just the type definitions and test file structure.

  ```typescript
  export type ContextMode = "full" | "complement";

  export type SessionContextOptions = {
    mode?: ContextMode;
  };

  export type SessionContext =
    | {
        ok: true;
        context: string;
        needsSetup: boolean;
        config: SeedConfig | null;
        proposalCount: number;
      }
    | {
        ok: false;
        error: string;
      };
  ```

  **Tests:** Type-level only — verify the module imports cleanly. 1 smoke test.

### T-1.2: Implement formatIdentitySummary [T] [P with T-1.3, T-1.4, T-1.5]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Implement `formatIdentitySummary(identity: IdentityLayer): string`. Pure function — takes identity data, returns formatted multi-line string. No I/O.

  Format:
  ```
  Identity: {aiName} (working with {principalName})
  Catchphrase: "{catchphrase}"
  Style: {responseStyle} | Timezone: {timezone} | Locale: {locale}
  ```

  **Tests (2):**
  - Formats all identity fields (custom values)
  - Formats default identity values (principalName "User", aiName "PAI")

### T-1.3: Implement formatLearningSummary [T] [P with T-1.2, T-1.4, T-1.5]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Implement `formatLearningSummary(learned: LearnedLayer): string`. Pure function. Returns empty string if all categories empty. Lists up to 5 confirmed items per non-empty category, truncated with `"... and N more"` if exceeded.

  Format:
  ```
  Learnings: N patterns, N insights, N self-knowledge
  Recent patterns:
    - Content line 1
    - Content line 2
    ... and 3 more
  ```

  Only confirmed items (`confirmed: true`) appear in the listed items. All items (confirmed or not) count in the summary line totals.

  **Tests (4):**
  - Populated learnings with confirmed items listed
  - Empty learnings returns empty string
  - Truncation at 5 confirmed items shows "... and N more"
  - Only confirmed items shown in detail list, unconfirmed only in counts

### T-1.4: Implement formatProposals [T] [P with T-1.2, T-1.3, T-1.5]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Implement `formatProposals(proposals: Proposal[]): string`. Pure function. Filters to `status === "pending"` only. Returns empty string if no pending proposals.

  Format:
  ```
  Pending proposals (N):
    1. [type] "content" (from source)
    2. [type] "content" (from source)
  ```

  **Tests (4):**
  - Pending proposals rendered with numbering
  - Empty array returns empty string
  - Mixed statuses — only pending shown
  - Single pending proposal formats correctly

### T-1.5: Implement formatSessionState [T] [P with T-1.2, T-1.3, T-1.4]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  Implement `formatSessionState(state: StateLayer): string`. Pure function. Shows last session timestamp (or "never"), active projects (or "none"), and checkpoint ref (only if defined).

  Format:
  ```
  Last session: {lastSessionAt or "never"}
  Active projects: {comma-separated or "none"}
  Checkpoint: {checkpointRef}   ← only if defined
  ```

  **Tests (3):**
  - Full state with all fields populated
  - Empty state (no lastSessionAt, no projects, no checkpoint)
  - State with checkpoint omitted (field absent from output)

---

## Group 2: Context Generation

### T-2.1: Implement generateSessionContext [T]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** T-1.2, T-1.3, T-1.4, T-1.5
- **Description:**
  Implement `generateSessionContext(seedPath?: string, options?: SessionContextOptions): Promise<SessionContext>`. Orchestrator function with I/O.

  Flow:
  1. Determine mode: `options?.mode ?? (process.env.PAI_DIR ? "complement" : "full")`
  2. Call `isFirstRun(seedPath)` from F-004
  3. If first run → return `{ ok: true, needsSetup: true, config: null, proposalCount: 0, context: "..." }`
  4. Call `loadSeedWithGit(seedPath)` from F-003
  5. If load fails → return `{ ok: false, error: "..." }`
  6. Concatenate formatter outputs (skip identity in complement mode)
  7. Prepend `"Seed: v{version}"` line
  8. Filter empty sections (no blank lines from empty formatters)
  9. Return structured `SessionContext`

  **Tests (8):**
  - Normal seed → returns formatted context with all sections
  - First run (no file) → returns `needsSetup: true` with setup message
  - First run (principalName "User") → returns `needsSetup: true`
  - Load error (corrupt file after passing isFirstRun) → returns `{ ok: false }`
  - Empty learnings → context omits learnings section
  - No pending proposals → context omits proposals section
  - `proposalCount` matches pending filter count
  - Performance: completes within 500ms
  - Full mode includes identity summary
  - Complement mode omits identity summary

---

## Group 3: Hook Entry Point

### T-3.1: Implement sessionStartHook [T]
- **File:** `src/session.ts`
- **Test:** `tests/session.test.ts`
- **Dependencies:** T-2.1
- **Description:**
  Implement `sessionStartHook(seedPath?: string, options?: SessionContextOptions): Promise<string>`. Thin wrapper — calls `generateSessionContext()` and extracts the context string.

  Flow:
  1. Call `generateSessionContext(seedPath, options)`
  2. If `result.ok` → return `result.context`
  3. If `!result.ok` → return `"PAI session context error: {error}"`
  4. Never throws, never exits non-zero

  **Tests (3):**
  - Normal seed → returns non-empty string
  - First run → returns setup message string
  - Error → returns error message string (never throws)

---

## Group 4: Integration

### T-4.1: Add exports and run regression tests [T]
- **File:** `src/index.ts`
- **Test:** all test files (`bun test`)
- **Dependencies:** T-3.1
- **Description:**
  Add F-005 exports to `src/index.ts` following the established feature-section pattern:

  ```typescript
  // =============================================================================
  // F-005: Session start hook
  // =============================================================================

  // Types
  export type { SessionContext, SessionContextOptions, ContextMode } from "./session";

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

  Run `bun test` — all F-001/F-002/F-003/F-004/F-005 tests must pass green. No regressions.

  **Tests:** Full suite regression (existing ~70+ tests + new ~25 tests).

---

## Execution Order

```
T-1.1 ─────────────────────────────────────────────────┐
  │                                                     │
  ├──→ T-1.2 ──┐                                       │
  ├──→ T-1.3 ──┤  (all four parallelizable)             │
  ├──→ T-1.4 ──┤                                       │
  └──→ T-1.5 ──┘                                       │
         │                                              │
         ▼                                              │
       T-2.1 (needs all formatters)                     │
         │                                              │
         ▼                                              │
       T-3.1 (needs context generator)                  │
         │                                              │
         ▼                                              │
       T-4.1 (exports + full regression)                │
```

**Critical path:** T-1.1 → T-1.3 (longest formatter) → T-2.1 → T-3.1 → T-4.1

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 8 |
| Parallelizable | 4 (T-1.2, T-1.3, T-1.4, T-1.5) |
| New files | 2 (`src/session.ts`, `tests/session.test.ts`) |
| Modified files | 1 (`src/index.ts`) |
| Estimated tests | ~25 |
| New dependencies | 0 |
