---
id: "F-005"
feature: "Session start hook (load + present)"
status: "draft"
created: "2026-02-01"
depends_on: ["F-002", "F-003", "F-004"]
---

# Specification: Session Start Hook (Load + Present)

## Overview

Provide functions that generate session-start context from seed.json. At each session start, the AI needs to know: who it is (identity), what it has learned (patterns, insights), and what proposals are pending from last session. This module formats that information for injection into Claude Code's context via a SessionStart hook.

This is a library layer — it provides formatting functions. The actual hook script is a thin wrapper that calls these functions and outputs to stdout.

## User Scenarios

### Scenario 1: Normal session start with existing seed

**As a** PAI system starting a new session
**I want** the AI's identity and learnings loaded and presented
**So that** the AI has continuity from previous sessions

**Acceptance Criteria:**
- [ ] `generateSessionContext()` loads seed.json and returns formatted context string
- [ ] Context includes identity summary (AI name, principal name, catchphrase)
- [ ] Context includes learned patterns count and key insights
- [ ] Context includes active projects list
- [ ] Formatted output is readable as a system-reminder injection

### Scenario 2: Session start with pending proposals

**As a** PAI system with proposals from the previous session
**I want** pending proposals presented clearly for review
**So that** the user can approve or reject learning candidates

**Acceptance Criteria:**
- [ ] `formatProposals()` renders pending proposals as readable text
- [ ] Each proposal shows type, content, and source
- [ ] Proposals are numbered for easy reference
- [ ] Empty proposals array returns empty string (no noise)

### Scenario 3: First session (no seed exists)

**As a** PAI system starting for the first time
**I want** a clear indication that setup is needed
**So that** the session start hook can trigger setup

**Acceptance Criteria:**
- [ ] `generateSessionContext()` detects first-run state
- [ ] Returns context indicating setup is needed
- [ ] Includes flag for callers to act on (`needsSetup: true`)

### Scenario 4: Session context with seed statistics

**As a** PAI system providing context to the AI
**I want** a summary of the seed state (counts, last session info)
**So that** the AI knows its current learning state

**Acceptance Criteria:**
- [ ] Context includes total learning counts by category
- [ ] Context includes last session timestamp if available
- [ ] Context includes seed version

## Functional Requirements

### FR-1: Session Context Generation

Provide `generateSessionContext(seedPath?: string, options?: SessionContextOptions): Promise<SessionContext>` that:

```typescript
type ContextMode = "full" | "complement";

type SessionContextOptions = {
  mode?: ContextMode;  // Default: auto-detect (complement if PAI_DIR set, full otherwise)
};

type SessionContext = {
  ok: true;
  context: string;         // Formatted text for system-reminder injection
  needsSetup: boolean;     // True if isFirstRun()
  config: SeedConfig | null; // The loaded config (null if first run)
  proposalCount: number;   // Number of pending proposals
} | {
  ok: false;
  error: string;
};
```

**Context modes:**
- `"full"` — Outputs everything: identity, learnings, proposals, session state. For standalone use without PAI.
- `"complement"` — Outputs only seed-specific additions: learnings, proposals, seed stats. Omits identity (already injected by PAI's LoadContext.hook.ts). For use within the PAI system.
- **Auto-detection:** If `process.env.PAI_DIR` is set → default to `"complement"`. Otherwise → `"full"`.

Flow:
1. Determine mode: `options?.mode ?? (process.env.PAI_DIR ? "complement" : "full")`
2. Check `isFirstRun(seedPath)` — if true, return setup-needed context
3. Load seed via `loadSeedWithGit(seedPath)` from F-003
4. If load fails: return error
5. Format context string:
   - `"full"` mode: `formatIdentitySummary()` + `formatLearningSummary()` + `formatProposals()` + `formatSessionState()`
   - `"complement"` mode: `formatLearningSummary()` + `formatProposals()` + `formatSessionState()` (skip identity)
6. Return structured result

**Validation:** Unit test: normal seed, first run, with proposals, empty seed, full mode, complement mode.

### FR-2: Identity Summary Formatting

Provide `formatIdentitySummary(identity: IdentityLayer): string` that:
- Formats: AI name, principal name, catchphrase, voice, preferences
- Returns multi-line readable text
- Example output:
  ```
  Identity: Ivy (serving Daniel)
  Catchphrase: "Ivy here, ready to go."
  Style: adaptive | Timezone: Europe/Zurich | Locale: en-US
  ```

**Validation:** Unit test: format with all fields, format with defaults.

### FR-3: Learning Summary Formatting

Provide `formatLearningSummary(learned: LearnedLayer): string` that:
- Counts patterns, insights, selfKnowledge
- Lists confirmed items (up to 5 per category, truncated with count)
- Returns multi-line text
- Returns empty string if no learnings exist
- Example output:
  ```
  Learnings: 3 patterns, 2 insights, 1 self-knowledge
  Recent patterns:
    - Prefers TypeScript with Bun runtime
    - Uses TDD for all implementations
  ```

**Validation:** Unit test: populated learnings, empty learnings, truncation.

### FR-4: Proposal Formatting

Provide `formatProposals(proposals: Proposal[]): string` that:
- Filters to `status === "pending"` only
- Numbers each proposal
- Shows type, content, and source
- Returns empty string if no pending proposals
- Example output:
  ```
  Pending proposals (2):
    1. [pattern] "Prefers concise commit messages" (from session abc-123)
    2. [insight] "Works best in morning hours" (from session def-456)
  ```

**Validation:** Unit test: with proposals, empty, mixed statuses.

### FR-5: Session State Formatting

Provide `formatSessionState(state: StateLayer): string` that:
- Shows last session timestamp (human-readable relative time or "never")
- Lists active projects
- Shows checkpoint reference if exists
- Returns formatted text

**Validation:** Unit test: with state data, empty state.

### FR-6: Hook Script Entry Point

Provide `sessionStartHook(seedPath?: string, options?: SessionContextOptions): Promise<string>` that:
- Calls `generateSessionContext(seedPath, options)`
- On success: returns the formatted `context` string (ready for stdout)
- On first-run: returns setup-needed message
- On error: returns error message (non-fatal — never exits non-zero)
- Mode auto-detection: inherits from `generateSessionContext()` (PAI_DIR → complement, else → full)
- This is the function a hook script would call: `const output = await sessionStartHook(); console.log(output);`

**Validation:** Unit test: normal output, first-run output, error output, both modes.

## Non-Functional Requirements

- **Performance:** `generateSessionContext()` completes in < 500ms (dominated by file I/O)
- **No side effects:** Context generation is read-only. No writes to seed.json.
- **Idempotent:** Same seed state produces same context output
- **Testability:** All functions accept path overrides or take data directly. Tests use temp directories.
- **Pure formatters:** `formatIdentitySummary`, `formatLearningSummary`, `formatProposals`, `formatSessionState` are pure functions (data in, string out)

## Key Entities

| Entity | Description | Source |
|--------|-------------|--------|
| SessionContext | Result of context generation | New in F-005 |
| SeedConfig | Typed seed data | F-001 |
| IdentityLayer | Identity section of seed | F-001 |
| LearnedLayer | Learned section of seed | F-001 |
| StateLayer | State section of seed | F-001 |
| Proposal | Pending learning candidate | F-001 |

## Success Criteria

- [ ] `generateSessionContext()` returns structured context from seed.json
- [ ] `formatIdentitySummary()` produces readable identity text
- [ ] `formatLearningSummary()` shows learning counts and recent items
- [ ] `formatProposals()` renders pending proposals with numbering
- [ ] `formatSessionState()` shows last session and active projects
- [ ] `sessionStartHook()` returns complete formatted output string
- [ ] First-run detection returns needsSetup flag
- [ ] All formatters are pure functions (no I/O)
- [ ] All tests use temp directories (never touches ~/.pai/)
- [ ] Existing F-001/F-002/F-003/F-004 tests pass (no regressions)
- [ ] `bun test` passes all tests green

## Assumptions

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Proposals use "pending" status for unreviewed | Status values change | Zod schema enforces enum |
| Context fits in system-reminder size | Very large learned section | Truncation with counts |
| Formatters don't need i18n | Multi-language requirement | English-only for v1 |

## System Context

### Upstream Dependencies

| System | What We Get | What Breaks If It Changes |
|--------|-------------|---------------------------|
| F-001 | `SeedConfig`, `IdentityLayer`, `LearnedLayer`, `StateLayer`, `Proposal` types | Type shapes |
| F-002 | `loadSeed()`, `resolveSeedPath()` | Load behavior |
| F-003 | `loadSeedWithGit()` | Git-integrated loading |
| F-004 | `isFirstRun()` | First-run detection |

### Downstream Consumers

| System | What They Import | Why |
|--------|-----------------|-----|
| PAI hooks | `sessionStartHook()` | Thin wrapper hook calls this |
| F-011 CLI | `generateSessionContext()` | `pai seed status` command |

## Out of Scope

- Hook installation/registration (F-011 CLI concern)
- Interactive proposal review (F-007 handles confirmation flow)
- Writing to seed.json (read-only module)
- Relative time formatting library (use simple date formatting)
