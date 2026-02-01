# Implementation Tasks: F-020 Deliberate Capture + Review UX

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☑ | Add `capture` command alias in main dispatcher |
| T-1.2 | ☑ | Modify cmdLearn to support "captured" commit message |
| T-2.1 | ☑ | Add review suggestion to formatProposals |
| T-2.2 | ☑ | Tests for review suggestion |
| T-3.1 | ☑ | Update printHelp with capture + two-channel docs |
| T-4.1 | ☑ | Full regression test suite — 571 pass, 0 fail |

---

## Group 1: Capture Command

### T-1.1: Add `capture` to main dispatcher
- **File:** `src/cli.ts` main() switch
- **Description:** Add `case "capture":` routing to cmdLearn with capture flag

### T-1.2: Modify cmdLearn for capture source
- **File:** `src/cli.ts` cmdLearn()
- **Description:** Accept optional verb parameter; change commit message to "captured" when invoked via capture

---

## Group 2: Review Suggestion

### T-2.1: Append suggestion to formatProposals
- **File:** `src/session.ts` formatProposals()
- **Description:** After proposal list, append review suggestion line

### T-2.2: Tests for review suggestion
- **File:** `tests/session.test.ts`
- **Description:** Verify suggestion text appears when proposals pending, absent when empty

---

## Group 3: Help Text

### T-3.1: Update printHelp
- **File:** `src/cli.ts` printHelp()
- **Description:** Add capture command, document deliberate vs automatic channels

---

## Group 4: Verification

### T-4.1: Full regression test suite
- **Test:** `bun test`
- **Description:** All tests pass

---

## Execution Order

All tasks independent except T-2.2 depends on T-2.1, T-4.1 depends on all.
