---
id: "F-011"
feature: "Seed CLI commands"
status: "draft"
created: "2026-02-01"
---

# Specification: Seed CLI Commands

## Context

> Generated from SpecFlow on 2026-02-01
> Builds on: F-002 (loader), F-003 (git), F-007 (confirmation)
> Integrates with: F-005 (session formatting), F-014 (migration)

## Problem Statement

**Core Problem**: Users and automation scripts have no CLI interface to interact with seed.json. All operations require importing TypeScript functions programmatically.

**Urgency**: Priority 4 — enables human interaction with the seed system (show, learn, forget, repair).

**Impact if Unsolved**: Users must manually edit JSON files or write custom scripts for basic operations.

## Users & Stakeholders

**Primary User**: Human user — interacts with seed.json via terminal commands
**Secondary**: Automation scripts — CLI enables shell scripting for PAI operations

## Current State

**Existing System**:
- All library functions exist: loadSeed, writeSeed, repairFromGit, formatters from session.ts
- F-007 provides proposal acceptance/rejection
- No CLI entry point, no `bin` field in package.json
- No command parsing or output formatting

## Overview

CLI tool (`pai-seed`) with subcommands for direct seed.json interaction. Uses existing library functions for all logic — the CLI is a thin presentation layer.

## User Scenarios

### Scenario 1: Show Seed Summary

**As** a user
**I want to** see a readable summary of my seed configuration
**So that** I can verify my identity, learnings, and pending proposals

**Acceptance Criteria:**
- [ ] `pai-seed show` prints identity, learnings count, pending proposals count
- [ ] Output is human-readable, formatted text
- [ ] Exit code 0 on success, 1 on error

### Scenario 2: Manual Learning

**As** a user
**I want to** add a learning directly from the command line
**So that** I can teach PAI things without going through a session

**Acceptance Criteria:**
- [ ] `pai-seed learn <type> <content>` adds a confirmed learning to seed.json
- [ ] Type must be "pattern", "insight", or "self_knowledge"
- [ ] Learning committed to git with descriptive message
- [ ] Exit code 0 on success, 1 on invalid input

### Scenario 3: Forget a Learning

**As** a user
**I want to** remove a learned item
**So that** I can correct or clean up PAI's memory

**Acceptance Criteria:**
- [ ] `pai-seed forget <id>` removes learning by ID from seed.json
- [ ] Committed to git with "Learn: removed <id>" message
- [ ] Exit code 0 on success, 1 if ID not found

### Scenario 4: Show Diff

**As** a user
**I want to** see what changed in seed.json since last session
**So that** I can review automated changes

**Acceptance Criteria:**
- [ ] `pai-seed diff` shows git diff for seed.json
- [ ] Clean output if no changes

### Scenario 5: Repair

**As** a user
**I want to** auto-repair a corrupted seed.json
**So that** I can recover from errors without manual editing

**Acceptance Criteria:**
- [ ] `pai-seed repair` calls repairFromGit and shows result
- [ ] Reports whether repair used git history or defaults

### Scenario 6: Status

**As** a user
**I want to** see a quick status of seed.json
**So that** I can verify the file exists and is valid

**Acceptance Criteria:**
- [ ] `pai-seed status` shows version, path, validity, git state
- [ ] Quick, minimal output

## Functional Requirements

### FR-1: CLI Entry Point
- Binary name: `pai-seed`
- Entry file: `src/cli.ts`
- package.json `bin` field: `{ "pai-seed": "src/cli.ts" }`
- Uses Bun native arg parsing (no Commander.js dependency — keep deps minimal)

### FR-2: Subcommands
- `show` — Format and display seed summary
- `learn <type> <content>` — Add a confirmed learning
- `forget <id>` — Remove a learning by ID
- `diff` — Show git diff for seed.json
- `repair` — Run repairFromGit
- `status` — Quick health check
- `--help` / no args — Show usage

### FR-3: Output Formatting
- Use ANSI colors via Bun built-ins (no chalk dependency)
- Structured output for `show`: sections for identity, learnings, proposals
- Error messages to stderr
- Exit code 0 for success, 1 for errors

### FR-4: No New Dependencies
- Use Bun native process.argv parsing
- No Commander.js, yargs, or similar
- Keep the CLI thin — delegate all logic to existing library functions

## Non-Functional Requirements

### NFR-1: Startup Time
- CLI should start < 200ms (Bun direct execution, no bundling)

### NFR-2: No Side Effects on Show/Status/Diff
- Read-only commands must not modify seed.json

## Out of Scope

- Interactive prompts (deferred — use batch mode only)
- `confirm` / `reject` subcommands (F-007 handles programmatically)
- Tab completion
- JSON output mode (future enhancement)
