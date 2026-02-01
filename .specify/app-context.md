# App Context: PAI Seed

## Problem Statement

PAI (Personal AI Infrastructure) suffers from session amnesia. Every session starts cold — the AI doesn't know what happened yesterday, repeats mistakes, loses learned patterns, and has no continuity with people or projects. CLAUDE.md provides static instructions and ACR retrieves prior context, but neither captures the AI's evolving identity, accumulated learnings, or session-to-session state. The result: a powerful tool that never gets smarter.

**Core gap:** There is no persistent, structured representation of "who Ivy is" that evolves over time.

## Users & Stakeholders

- **Primary user:** Jens-Christian (PAI operator) — both reads and writes seed.json actively
- **Primary AI:** Ivy (PAI instance) — reads on startup, proposes learnings for persistence
- **Interaction model:** User configures identity; AI extracts learnings; both read/write regularly
- **External:** pai-collab agents may eventually read (but multi-agent sharing is OUT of scope for v1)

## Current State

### What Exists
- `settings.json` — PAI configuration (identity name, timezone, etc.)
- `CLAUDE.md` — Static instructions loaded every session
- **ACR** — 4-tier context retrieval (grep → semantic → injection → decay). Production, 618 tests. Acts as preconscious layer for session context.
- **PAI Algorithm** — 7-phase execution with ISC tracking
- **50+ skills, 14+ MCP tools** — Rich capability set
- **Claude Code hooks** — UserPromptSubmit, PreCompact, SessionStart events available

### What's Missing
- No persistent AI identity beyond static config
- No learning loop (extract → propose → confirm → persist)
- No event log for interaction history
- No session state recovery (checkpoint/resume)
- No mechanism for the AI to know its own patterns and tendencies

### Integration Points
- **ACR:** Seed.json learnings become a new source for ACR's Tier 2 semantic search
- **settings.json:** Loaded alongside seed.json (separate files, not merged)
- **Claude Code hooks:** Post-session extraction (PreCompact), next-session proposals (SessionStart)
- **Git:** ~/.pai/ is a git repo. Full history tracked. Auto-repair from git on corruption.

## Constraints & Requirements

### Technical
- **Stack:** TypeScript + Bun (PAI standard)
- **Location:** `~/.pai/seed.json` (new PAI directory)
- **Startup latency:** < 2s for load + validate + merge with defaults
- **Git:** Everything in git. Full version history of AI evolution.
- **Schema:** JSON Schema validation. Layered (identity, learned, state sections).

### Learning Pipeline
- **Pattern:** "Propose then confirm" (Arbor's "subconscious proposes, conscious decides")
- **Flow:** Post-session hook extracts learning candidates → stored as proposals → next session start presents proposals → user approves/rejects → approved items persist to seed.json
- **Constraint:** Claude Code hooks cannot prompt interactively. Confirmation happens at next session start via system-reminder presentation.

### Recovery
- **Corruption:** Auto-repair from git history (checkout last known good version, warn user)
- **Conflicts:** Git merge strategy for concurrent modifications
- **Defaults:** If seed.json doesn't exist, create from defaults. Never block startup.

## User Experience

### First Run
- No seed.json exists → create from defaults with user's name and basic identity
- Guided setup via AskUserQuestion (name, AI name, voice, catchphrase)
- Mirrors existing PAI installation flow but writes to `~/.pai/seed.json`

### Ongoing Sessions
- **Session start:** Load seed.json, present any pending proposals from last session
- **During session:** AI behavior informed by learned patterns and preferences
- **Session end:** Post-session hook extracts candidates, stores as proposals
- **Manual:** User can run `pai seed learn "insight"` or `pai seed forget "pattern"` anytime

### Visibility
- User can `cat ~/.pai/seed.json` to see what the AI "knows"
- `git log ~/.pai/seed.json` shows how the AI evolved over time
- `pai seed show` for human-readable summary
- `pai seed diff` to see what changed since last session

## Edge Cases & Error Handling

### All Identified Risks (user flagged ALL as concerns)
1. **Wrong patterns reinforced:** AI learns something incorrect, compounds over time
   - Mitigation: Propose/confirm gate. User approves all learnings. Decay on unconfirmed patterns.
2. **Privacy leak via git:** Sensitive info (people, relationships) in tracked file
   - Mitigation: Relationships are SEPARATE (linked, not contained). Seed.json contains patterns, not personal data about others. `.gitleaks.toml` for CI scanning.
3. **Stale identity:** Seed.json reflects past self, not current
   - Mitigation: Decay/freshness signals. Periodic "identity review" prompts. Git history for temporal context.
4. **Over-personalization:** Echo chamber effect, AI can't handle novel tasks
   - Mitigation: Learnings are preferences, not constraints. Algorithm ISC criteria always take precedence over seed patterns.

### Recovery Scenarios
- Corrupted JSON → auto-repair from git
- Missing file → create from defaults
- Schema version mismatch → migration script
- Concurrent writes → git merge or last-write-wins with backup

## Success Criteria

1. **"Ivy is getting better"** — Measurable improvement over time: fewer repeated mistakes, better suggestions, less friction
2. **"It feels like MY AI"** — Ivy has a distinct personality shaped by shared history. Not generic Claude.
3. **Continuity** — AI naturally references prior context without being told
4. **Transparency** — User can see, edit, and understand everything the AI "knows"

## Scope

### In Scope
- Seed.json schema (identity, learned patterns, session state)
- JSON Schema validation with migration support
- Post-session extraction hook (learning candidate extraction)
- Proposal system (store candidates, present at next session start)
- CLI commands (show, learn, forget, diff, repair)
- Event log foundation (append-only JSONL for interaction history)
- Checkpoint system (session state snapshots for recovery)
- Git integration (auto-commit, auto-repair, version history)
- ACR integration (seed learnings as new ACR source)
- Relationship system (separate files, linked from seed.json)

### Explicitly Out of Scope
- Multi-agent sharing (pai-collab handles cross-agent coordination)
- Heartbeat daemon (CLI-first stays; hooks provide lifecycle events)
- RLM integration (future phase, depends on seed + event log existing first)
- Trust-capability sync (single-user system for v1)
- Salience scoring (defer until usage data exists)
