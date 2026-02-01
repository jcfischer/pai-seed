# Implementation Tasks: First-run Setup Wizard (F-004)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | SetupAnswers schema + SetupResult type |
| T-1.2 | ☐ | detectTimezone() |
| T-1.3 | ☐ | buildSeedFromAnswers() |
| T-2.1 | ☐ | isFirstRun() |
| T-3.1 | ☐ | runSetup() |
| T-4.1 | ☐ | Exports + regression |

## Group 1: Foundation (Types & Pure Functions)

### T-1.1: Define SetupAnswers schema and SetupResult type [T]

- **File:** `src/setup.ts`
- **Test:** `tests/setup.test.ts`
- **Dependencies:** none
- **Description:** Create `setupAnswersSchema` (Zod) with `principalName` required and all optional fields (`aiName`, `catchphrase`, `voiceId`, `responseStyle`, `timezone`, `locale`). Define `SetupResult` discriminated union type. Import `SeedConfig` from `./schema`.

**Acceptance criteria covered:**
- FR-2: SetupAnswers type with well-defined answer types
- FR-2: Required fields produce validation errors if missing

**Tests (~3):**
- Schema accepts valid full answers
- Schema accepts minimal answers (principalName only)
- Schema rejects missing principalName (empty string)

---

### T-1.2: Implement detectTimezone() [T] [P with T-1.1]

- **File:** `src/setup.ts`
- **Test:** `tests/setup.test.ts`
- **Dependencies:** none
- **Description:** Implement `detectTimezone(): string` using `Intl.DateTimeFormat().resolvedOptions().timeZone` with `"UTC"` fallback on error or empty result.

**Acceptance criteria covered:**
- Scenario 4: Returns system's IANA timezone string
- Scenario 4: Falls back to "UTC" if detection fails

**Tests (~2):**
- Returns valid IANA timezone string (non-empty, contains `/`)
- Function never throws (returns string in all cases)

---

### T-1.3: Implement buildSeedFromAnswers() [T]

- **File:** `src/setup.ts`
- **Test:** `tests/setup.test.ts`
- **Dependencies:** T-1.1, T-1.2
- **Description:** Pure function that creates `SeedConfig` using `createDefaultSeed()` as base, overrides identity and preference fields from answers, derives catchphrase from aiName when not provided (`"${aiName} here, ready to go."`), validates result with `validateSeed()`. Throws on invalid input.

**Imports needed:** `createDefaultSeed` from `./defaults`, `validateSeed` from `./validate`, `SeedConfig` from `./schema`

**Acceptance criteria covered:**
- Scenario 2: Produces valid SeedConfig from setup answers
- Scenario 2: Missing optional answers fall back to defaults
- Scenario 2: All required fields produce validation errors if missing
- FR-3: Pure function (no I/O)

**Tests (~5):**
- All fields provided → valid SeedConfig with all overrides applied
- Minimal input (principalName only) → valid SeedConfig with defaults
- Catchphrase derived from aiName when not provided
- Custom catchphrase preserved when provided
- Invalid input (empty principalName) → throws

---

## Group 2: First-Run Detection

### T-2.1: Implement isFirstRun() [T]

- **File:** `src/setup.ts`
- **Test:** `tests/setup.test.ts`
- **Dependencies:** T-1.1 (uses types)
- **Description:** Implement `isFirstRun(seedPath?: string): Promise<boolean>` that calls `loadSeed()` from `src/loader.ts`, returns `true` when file doesn't exist or principalName is `"User"` (default), returns `false` when customized. Never throws — returns `true` on any error.

**Imports needed:** `loadSeed` from `./loader`

**Acceptance criteria covered:**
- Scenario 1: Returns `true` when seed.json doesn't exist
- Scenario 1: Returns `true` when seed.json has default identity values
- Scenario 1: Returns `false` when seed.json has been customized
- Scenario 1: Detection is fast (< 100ms)
- FR-1: Never throws — returns `true` on any error

**Tests (~5):**
- No seed file → returns `true`
- Default seed (principalName "User") → returns `true`
- Customized seed (principalName "Jens-Christian") → returns `false`
- Corrupted file → returns `true` (safe default)
- Performance: completes in < 100ms

---

## Group 3: Setup Orchestration

### T-3.1: Implement runSetup() [T]

- **File:** `src/setup.ts`
- **Test:** `tests/setup.test.ts`
- **Dependencies:** T-1.3, T-2.1
- **Description:** Implement `runSetup(answers: SetupAnswers, seedPath?: string): Promise<SetupResult>` that orchestrates: check `isFirstRun()` → if not first run return existing → build config via `buildSeedFromAnswers()` → write via `writeSeedWithCommit()` with commit message `"Init: first-run setup completed"` → return result. Idempotent.

**Imports needed:** `writeSeedWithCommit` from `./git`

**Acceptance criteria covered:**
- Scenario 3: Writes seed.json with custom identity via `writeSeedWithCommit()`
- Scenario 3: Commit message uses "Init: first-run setup completed"
- Scenario 3: Idempotent — running again returns without changes
- Scenario 3: Returns the created config for immediate use
- FR-5: Full flow orchestration

**Tests (~4):**
- First run → creates config, returns `{ ok: true, created: true }`
- Already configured → returns existing config with `created: false`
- Write failure → returns `{ ok: false, error }`
- Idempotency: calling twice, second returns `created: false`

---

## Group 4: Integration

### T-4.1: Export public API and run regression [T]

- **File:** `src/index.ts`
- **Test:** all test files (regression)
- **Dependencies:** T-3.1
- **Description:** Add exports to `src/index.ts`: types (`SetupAnswers`, `SetupResult`), functions (`isFirstRun`, `buildSeedFromAnswers`, `detectTimezone`, `runSetup`), schema (`setupAnswersSchema`). Run full `bun test` to verify no regressions across F-001/F-002/F-003.

**Acceptance criteria covered:**
- Success criteria: Existing F-001/F-002/F-003 tests pass
- Success criteria: `bun test` passes all tests green

**Verification:**
- All new exports resolve correctly
- `bun test` — all tests green (existing + new)

---

## Execution Order

```
T-1.1 ──┐
         ├──→ T-1.3 ──→ T-3.1 ──→ T-4.1
T-1.2 ──┘        ↑
                  │
T-2.1 ────────────┘ (T-2.1 can start after T-1.1, parallel with T-1.3)
```

1. **T-1.1**, **T-1.2** (parallel — no shared dependencies)
2. **T-1.3**, **T-2.1** (parallel — T-1.3 needs T-1.1+T-1.2; T-2.1 needs T-1.1 only)
3. **T-3.1** (after T-1.3 and T-2.1)
4. **T-4.1** (after T-3.1)

## Spec Acceptance Criteria Cross-Reference

| Spec Criterion | Task |
|---------------|------|
| `isFirstRun()` returns true when no file | T-2.1 |
| `isFirstRun()` returns true for default values | T-2.1 |
| `isFirstRun()` returns false when customized | T-2.1 |
| Detection < 100ms | T-2.1 |
| `buildSeedFromAnswers()` produces valid SeedConfig | T-1.3 |
| Missing optional answers fall back to defaults | T-1.3 |
| Required fields produce validation errors | T-1.1, T-1.3 |
| Answer types well-defined and documented | T-1.1 |
| `runSetup()` writes seed.json via writeSeedWithCommit | T-3.1 |
| Commit message "Init: first-run setup completed" | T-3.1 |
| Setup is idempotent | T-3.1 |
| Returns created config | T-3.1 |
| `detectTimezone()` returns IANA timezone | T-1.2 |
| Falls back to "UTC" | T-1.2 |
| All tests use temp directories | T-2.1, T-3.1 |
| Existing tests pass (no regressions) | T-4.1 |
| `bun test` all green | T-4.1 |
