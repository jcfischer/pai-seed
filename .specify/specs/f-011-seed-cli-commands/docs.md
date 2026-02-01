# Documentation Updates: F-011 Seed CLI Commands

## Files Updated

### API Surface Added

New binary in `package.json`:
- `"bin": { "pai-seed": "src/cli.ts" }`

New file `src/cli.ts` — CLI entry point with exported `main(argv?)` function.

### CLI Commands

| Command | Description |
|---------|-------------|
| `pai-seed show` | Human-readable seed summary |
| `pai-seed status` | Quick health check (path, version, validity, git) |
| `pai-seed diff` | Git diff for seed.json |
| `pai-seed learn <type> <content>` | Add a confirmed learning |
| `pai-seed forget <id>` | Remove a learning by ID |
| `pai-seed repair` | Auto-repair from git history |
| `pai-seed help` | Show usage |

### New File Locations

- `src/cli.ts` — CLI entry point (~250 lines)
- `tests/cli.test.ts` — 18 tests
