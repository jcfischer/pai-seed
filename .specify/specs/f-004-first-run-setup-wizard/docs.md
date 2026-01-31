# Documentation Updates: F-004 First-run Setup Wizard

**Feature:** F-004
**Date:** 2026-01-31

## What Was Created

### New Source Files

| File | Purpose |
|------|---------|
| `src/setup.ts` | `setupAnswersSchema`, `detectTimezone()`, `buildSeedFromAnswers()`, `isFirstRun()`, `runSetup()` |

### New Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/setup.test.ts` | 19 | Schema validation, timezone detection, config building, first-run detection, setup orchestration |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Added F-004 type, function, and schema exports |

## Public API Additions

Exported from `src/index.ts` (appended to F-001/F-002/F-003 exports):

### Types
- `SetupAnswers` -- User's setup choices (principalName required, all others optional)
- `SetupResult` -- `{ ok: true; config: SeedConfig; created: boolean }` or `{ ok: false; error: string }`

### Schemas
- `setupAnswersSchema` -- Zod schema for runtime validation of setup answers

### Functions
- `detectTimezone(): string` -- System IANA timezone with UTC fallback
- `buildSeedFromAnswers(answers: SetupAnswers): SeedConfig` -- Pure: transforms answers into validated SeedConfig
- `isFirstRun(seedPath?: string): Promise<boolean>` -- Detects if setup is needed (no file, default values, or errors)
- `runSetup(answers: SetupAnswers, seedPath?: string): Promise<SetupResult>` -- Full setup orchestration with git commit

## No External Documentation Changes

F-004 is a library layer for setup logic. No README or user-facing documentation needed yet. CLI documentation will come with F-011.
