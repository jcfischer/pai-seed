# F-020: Deliberate Capture + Review UX

## Problem

The learning system only has one input channel: automatic post-session extraction. There is no way for the user to explicitly capture a learning during or between sessions. Additionally, proposals accumulate with no natural review moment — the CLI exists but requires remembering to run it.

## Solution

Two additions:

### 1. `pai-seed capture` command

Direct CLI command to capture a confirmed learning, bypassing the proposal stage entirely:

```bash
pai-seed capture pattern "User prefers concise responses"
pai-seed capture insight "Caching reduces API latency by 40%"
pai-seed capture self_knowledge "Always validate schema before deploy"
```

This is the "conscious decides" channel from Arbor — deliberate encoding by the user. The learning is immediately confirmed (no proposal review needed) and committed to git.

**Difference from `pai-seed learn`:** The existing `learn` command already does this. `capture` is an alias that makes the Arbor mental model explicit. We may choose to keep `learn` as the primary and document `capture` as alias, or vice versa.

### 2. Session-start review suggestion

When proposals are pending, the session-start system-reminder includes a suggestion for the AI to help review:

```
Pending proposals (5 shown, 43 more):
  1. [pattern] "User prefers TypeScript strict mode" (from session-2026-01-30)
  ...

Suggestion: Ask your AI to help review proposals, or run `pai-seed proposals review`.
```

This creates a natural review moment without forcing it. The user can ignore it or ask the AI to walk through proposals.

## User Scenarios

### S1: User captures a learning during a session
- User runs `pai-seed capture pattern "Prefer Bun over Node for CLI tools"`
- Learning added directly to `learned.patterns[]` with confirmed=true
- Git commit: "Learn: captured pattern via CLI"
- No proposal created — direct to learnings

### S2: Session starts with pending proposals
- 5 proposals shown in system-reminder (capped by F-019)
- Footer text suggests asking AI to review or using CLI
- User can say "review my proposals" and AI can call `pai-seed proposals accept/reject`

### S3: User captures with wrong type
- User runs `pai-seed capture invalid_type "content"`
- Error: "Type must be pattern, insight, or self_knowledge"

## Functional Requirements

### FR-1: `capture` command
- **Syntax:** `pai-seed capture <type> <content>`
- **Types:** pattern, insight, self_knowledge
- **Behavior:** Create confirmed learning directly (same as existing `learn` command)
- **Git:** Commit with "Learn: captured <type> via CLI"
- **Files:** `src/cli.ts` — add capture as alias for learn

### FR-2: Session-start review suggestion
- **When:** Pending proposals exist and are shown in session context
- **Then:** Append suggestion text after proposal list
- **Text:** "Suggestion: Ask your AI to help review proposals, or run `pai-seed proposals review`."
- **Files:** `src/session.ts` `formatProposals()`

### FR-3: Document the two-channel model
- **CLI help:** Update help text to explain capture (deliberate) vs extraction (automatic)
- **Files:** `src/cli.ts` `printHelp()`

## Out of Scope

- Inline tagging during AI conversations (future exploration)
- Disabling auto-extraction (staying ON per user preference)
- Trust tiers / auto-accept (F-021)
- Interactive capture mode (keeping it simple: args only)

## Success Criteria

1. `pai-seed capture pattern "test"` creates a confirmed learning
2. `pai-seed capture` with wrong type shows error
3. Session-start system-reminder includes review suggestion when proposals pending
4. Help text documents both channels
5. All existing tests pass
