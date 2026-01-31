# Documentation Updates: F-001 Seed.json Schema and Validation

**Feature:** F-001
**Date:** 2026-01-31

## What Was Created

This is a greenfield project. All documentation is new.

### Source Files

| File | Purpose |
|------|---------|
| `src/schema.ts` | Zod schema definitions + TypeScript types (single source of truth) |
| `src/validate.ts` | `validateSeed()` function with JSONPath errors and unknown-key warnings |
| `src/defaults.ts` | `createDefaultSeed()` function with self-validation |
| `src/json-schema.ts` | `generateJsonSchema()` using zod-to-json-schema |
| `src/index.ts` | Barrel export of all public API |

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/schema.test.ts` | 33 | All Zod schemas, enums, optionals, constraints |
| `tests/validate.test.ts` | 26 | Validation, version checks, error paths, performance |
| `tests/defaults.test.ts` | 9 | Default seed generation and self-validation |
| `tests/json-schema.test.ts` | 9 | JSON Schema generation and cross-validation |

### Test Fixtures

| File | Purpose |
|------|---------|
| `tests/fixtures/valid-seed.json` | Complete valid seed with populated arrays |
| `tests/fixtures/valid-seed-minimal.json` | Minimal valid seed (empty arrays) |
| `tests/fixtures/invalid-missing-version.json` | Missing version field |
| `tests/fixtures/invalid-wrong-types.json` | Type mismatches |
| `tests/fixtures/large-seed.json` | 1600 entries for performance testing |

## Public API

Exported from `src/index.ts`:

### Types
- `SeedConfig` — Root configuration type
- `IdentityLayer`, `LearnedLayer`, `StateLayer` — Layer types
- `Learning`, `Proposal`, `Preferences` — Shared types
- `ValidationResult`, `ValidationError` — Validation result types

### Functions
- `validateSeed(data: unknown): ValidationResult` — Pure validation function
- `createDefaultSeed(): SeedConfig` — Default seed generator
- `generateJsonSchema(): object` — JSON Schema (draft-07) generator

### Schemas (for advanced use)
- `seedConfigSchema`, `learningSchema`, `proposalSchema`
- `preferencesSchema`, `identityLayerSchema`, `learnedLayerSchema`, `stateLayerSchema`
- `KNOWN_SEED_KEYS`, `CURRENT_MAJOR_VERSION`

## No External Documentation Changes

F-001 is a pure data-model feature with no CLI, no README, and no user-facing docs. Documentation updates will be needed when F-002 (Seed Loader) and F-011 (CLI) are implemented.
