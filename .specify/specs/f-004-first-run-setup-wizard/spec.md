---
id: "F-004"
feature: "First-run setup wizard"
status: "draft"
created: "2026-01-31"
depends_on: ["F-002", "F-003"]
---

# Specification: First-run Setup Wizard

## Overview

Provide a programmatic setup wizard that detects first-run state and transforms user-provided answers into a personalized SeedConfig. This is a library layer — it provides functions that downstream features (hooks, CLI) call to handle the initial seed.json creation with the user's identity choices.

## User Scenarios

### Scenario 1: Detect first-run state

**As a** PAI system starting a new session
**I want** to detect whether setup has been completed
**So that** I know whether to guide the user through initial configuration

**Acceptance Criteria:**
- [ ] `isFirstRun()` returns `true` when seed.json doesn't exist
- [ ] `isFirstRun()` returns `true` when seed.json has default identity values (principalName === "User")
- [ ] `isFirstRun()` returns `false` when seed.json has been customized
- [ ] Detection is fast (< 100ms) — no heavy I/O

### Scenario 2: Build config from user answers

**As a** PAI setup flow (hook or CLI)
**I want** to transform user answers into a valid SeedConfig
**So that** the setup logic is reusable across different interfaces

**Acceptance Criteria:**
- [ ] `buildSeedFromAnswers()` produces a valid SeedConfig from setup answers
- [ ] Missing optional answers fall back to defaults
- [ ] All required fields produce validation errors if missing
- [ ] Answer types are well-defined and documented

### Scenario 3: Complete setup flow

**As a** PAI system completing first-run setup
**I want** to write the personalized seed and commit it to git
**So that** the AI identity is persisted from the very first session

**Acceptance Criteria:**
- [ ] `runSetup()` writes seed.json with custom identity via `writeSeedWithCommit()`
- [ ] Commit message uses `"Init: first-run setup completed"` category
- [ ] Setup is idempotent — running again on a configured seed returns without changes
- [ ] Returns the created config for immediate use in the session

### Scenario 4: Timezone detection

**As a** PAI system setting up for the first time
**I want** the user's timezone detected automatically
**So that** the user doesn't have to manually specify it

**Acceptance Criteria:**
- [ ] `detectTimezone()` returns the system's IANA timezone string
- [ ] Falls back to "UTC" if detection fails
- [ ] Used as default for preferences.timezone in setup

## Functional Requirements

### FR-1: First-Run Detection

Provide `isFirstRun(seedPath?: string): Promise<boolean>` that:
- Checks if seed.json exists at the given path
- If it doesn't exist: returns `true`
- If it exists: loads and checks `identity.principalName`
- If principalName is `"User"` (the default): returns `true`
- If principalName is anything else: returns `false`
- Never throws — returns `true` on any error (safe default: prompt setup)

**Validation:** Unit test: no file, default file, customized file, corrupted file.

### FR-2: Setup Answers Type

Define a `SetupAnswers` type representing the user's choices:

```typescript
type SetupAnswers = {
  principalName: string;      // Required — user's name
  aiName?: string;            // Default: "PAI"
  catchphrase?: string;       // Default: derived from aiName
  voiceId?: string;           // Default: "default"
  responseStyle?: "concise" | "detailed" | "adaptive";  // Default: "adaptive"
  timezone?: string;          // Default: detectTimezone()
  locale?: string;            // Default: "en-US"
};
```

**Validation:** Type-level test: ensures required fields are enforced.

### FR-3: Build Config from Answers

Provide `buildSeedFromAnswers(answers: SetupAnswers): SeedConfig` that:
- Creates a `SeedConfig` using `createDefaultSeed()` as the base
- Overwrites identity fields from provided answers
- Derives catchphrase from aiName if not provided: `"<aiName> here, ready to go."`
- Validates the result with `validateSeed()` before returning
- Throws on invalid input (programming error — caller should validate first)

**Validation:** Unit test: all fields provided, minimal fields, derived catchphrase, validation.

### FR-4: Timezone Detection

Provide `detectTimezone(): string` that:
- Uses `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Returns the IANA timezone string (e.g., "Europe/Zurich")
- Falls back to `"UTC"` if detection throws or returns empty

**Validation:** Unit test: returns valid IANA timezone string, fallback behavior.

### FR-5: Run Setup Flow

Provide `runSetup(answers: SetupAnswers, seedPath?: string): Promise<SetupResult>` that:

```typescript
type SetupResult =
  | { ok: true; config: SeedConfig; created: boolean }
  | { ok: false; error: string };
```

Flow:
1. Check `isFirstRun(seedPath)` — if not first run, return `{ ok: true, config: existingConfig, created: false }`
2. Build config from answers via `buildSeedFromAnswers()`
3. Write using `writeSeedWithCommit(config, "Init: first-run setup completed", seedPath)`
4. If write fails: return `{ ok: false, error }`
5. Return `{ ok: true, config, created: true }`

**Validation:** Unit test: first run creates config, already configured returns existing, write failure propagates.

## Non-Functional Requirements

- **Performance:** `isFirstRun()` completes in < 100ms. `runSetup()` completes in < 1s.
- **Purity:** `buildSeedFromAnswers()` is pure (no I/O). Only `isFirstRun()` and `runSetup()` do I/O.
- **Testability:** All functions accept path overrides. Tests use temp directories.
- **No interactive I/O:** This module does NOT prompt the user. It receives answers and produces configs. Interactive prompting is the caller's responsibility (hooks, CLI).

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| SetupAnswers | User's setup choices | New in F-004 |
| SetupResult | Result of running setup | New in F-004 |
| SeedConfig | Typed seed data | F-001 |
| WriteResult | Write outcome from F-002 | F-002 |

## Success Criteria

- [ ] `isFirstRun()` correctly detects first-run state (no file, default values)
- [ ] `buildSeedFromAnswers()` produces valid SeedConfig from all answer combinations
- [ ] `detectTimezone()` returns valid IANA timezone
- [ ] `runSetup()` writes personalized seed with git commit
- [ ] Setup is idempotent (no changes on already-configured seed)
- [ ] All tests use temp directories (never touches ~/.pai/)
- [ ] Existing F-001/F-002/F-003 tests pass (no regressions)
- [ ] `bun test` passes all tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| `Intl.DateTimeFormat` works in Bun | Bun doesn't support Intl fully | Test timezone detection, fallback to UTC |
| principalName "User" indicates unconfigured | User's actual name is "User" | Edge case — acceptable false positive |
| Callers validate input before calling | Invalid answers passed directly | Schema validation in buildSeedFromAnswers |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-001 | `SeedConfig`, `validateSeed()`, `createDefaultSeed()` | Types, validation behavior |
| F-002 | `loadSeed()`, `resolveSeedPath()` | Load behavior |
| F-003 | `writeSeedWithCommit()` | Git commit integration |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|-----|
| F-005 Session start hook | `isFirstRun()`, `runSetup()` | Detect and trigger setup at session start |
| F-011 CLI | `runSetup()`, `isFirstRun()` | `pai seed setup` command |

## Out of Scope

- Interactive prompting (callers handle UI)
- Voice selection / ElevenLabs integration (voiceId is just a string)
- Settings.json migration (separate system)
- Multi-user setup (single principal)
