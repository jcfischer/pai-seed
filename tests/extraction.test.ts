import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed, loadSeed } from "../src/loader";
import { proposalSchema } from "../src/schema";
import type { SeedConfig, Proposal } from "../src/schema";
import {
  detectLearningSignals,
  extractProposals,
  writeProposals,
  extractionHook,
} from "../src/extraction";

// =============================================================================
// Test Helpers
// =============================================================================

/** Initialize a git repo with local-only config (never touches --global). */
async function initTestGitRepo(dir: string): Promise<void> {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await run(["init"]).exited;
  await run(["config", "user.email", "test@test.com"]).exited;
  await run(["config", "user.name", "Test"]).exited;
  await Bun.write(join(dir, ".gitignore"), "*.tmp\n");
  await run(["add", "."]).exited;
  await run(["commit", "-m", "init"]).exited;
}

/** Write a valid seed and commit it so loadSeedWithGit can find it. */
async function writeSeedAndCommit(
  dir: string,
  config?: SeedConfig,
): Promise<string> {
  const seedPath = join(dir, "seed.json");
  const seed = config ?? createDefaultSeed();
  await writeSeed(seed, seedPath);
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await run(["add", "."]).exited;
  await run(["commit", "-m", "seed committed"]).exited;
  return seedPath;
}

// =============================================================================
// detectLearningSignals — Pure function tests (~12 tests)
// =============================================================================

describe("detectLearningSignals", () => {
  test("detects pattern signal ('you prefer')", () => {
    const text = "I noticed that you prefer TypeScript over Python for all projects.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBeGreaterThanOrEqual(1);
    const patternSignals = signals.filter((s) => s.type === "pattern");
    expect(patternSignals.length).toBeGreaterThanOrEqual(1);
    expect(patternSignals[0].matchedPhrase).toBe("you prefer");
  });

  test("detects insight signal ('i learned')", () => {
    const text = "I learned that caching reduces latency by 40% in production.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBeGreaterThanOrEqual(1);
    const insightSignals = signals.filter((s) => s.type === "insight");
    expect(insightSignals.length).toBeGreaterThanOrEqual(1);
    expect(insightSignals[0].matchedPhrase).toBe("i learned");
  });

  test("detects self_knowledge signal ('note to self')", () => {
    const text = "Note to self: always run the full test suite before committing.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBeGreaterThanOrEqual(1);
    const selfSignals = signals.filter((s) => s.type === "self_knowledge");
    expect(selfSignals.length).toBeGreaterThanOrEqual(1);
    expect(selfSignals[0].matchedPhrase).toBe("note to self");
  });

  test("case-insensitive matching", () => {
    const text = "I LEARNED that bun is faster than node for our use case.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].type).toBe("insight");
  });

  test("skips content shorter than 10 characters", () => {
    const text = "You prefer X. I learned that long content is important here.";
    const signals = detectLearningSignals(text);
    // "You prefer X" is short when cleaned; "I learned that long content..." is valid
    const contents = signals.map((s) => s.content);
    for (const c of contents) {
      expect(c.length).toBeGreaterThanOrEqual(10);
    }
  });

  test("no false positives — 'bayou always' should not match 'you always'", () => {
    const text = "The bayou always floods in spring. It is a natural occurrence.";
    const signals = detectLearningSignals(text);
    const falseMatches = signals.filter((s) => s.matchedPhrase === "you always");
    expect(falseMatches.length).toBe(0);
  });

  test("empty string returns empty array", () => {
    const signals = detectLearningSignals("");
    expect(signals).toEqual([]);
  });

  test("multi-signal transcript finds all signals", () => {
    const text = [
      "You prefer short functions.",
      "I learned that testing early saves time.",
      "Note to self: check environment variables before deploy.",
    ].join(" ");
    const signals = detectLearningSignals(text);
    const types = new Set(signals.map((s) => s.type));
    expect(types.has("pattern")).toBe(true);
    expect(types.has("insight")).toBe(true);
    expect(types.has("self_knowledge")).toBe(true);
  });

  test("sentence boundary preservation — splits on '. ' and newline", () => {
    const text = "First sentence. You prefer explicit types.\nI learned about generics.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBe(2);
    // Each signal content should be from its own sentence, not merged
    const patternContent = signals.find((s) => s.type === "pattern")?.content;
    expect(patternContent).toBeDefined();
    expect(patternContent).not.toContain("First sentence");
  });

  test("smart quotes normalized to straight quotes", () => {
    const text = "I learned that \u201Csmart quotes\u201D should become straight quotes in output.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0].content).not.toContain("\u201C");
    expect(signals[0].content).not.toContain("\u201D");
    expect(signals[0].content).toContain('"');
  });

  test("leading punctuation stripped from content", () => {
    const text = "Something happened. - You prefer functional patterns over OOP.";
    const signals = detectLearningSignals(text);
    expect(signals.length).toBeGreaterThanOrEqual(1);
    // Content should not start with "- "
    expect(signals[0].content).not.toMatch(/^[\s\-\*\#]/);
  });

  test("URL in text does not break splitting", () => {
    const text =
      "Check https://example.com/path.html for details. I learned that URLs need careful handling in parsers.";
    const signals = detectLearningSignals(text);
    // Should still detect the insight without breaking on the URL dots
    const insightSignals = signals.filter((s) => s.type === "insight");
    expect(insightSignals.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// extractProposals — Pure function tests (~8 tests)
// =============================================================================

describe("extractProposals", () => {
  test("normal extraction produces valid Proposals", () => {
    const text = "You prefer TypeScript for backend development. I learned that bun is fast.";
    const proposals = extractProposals(text, "session-123");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
  });

  test("each proposal has id, type, content, source, status 'pending'", () => {
    const text = "You prefer concise code. I noticed redundant imports slow things down.";
    const proposals = extractProposals(text, "session-abc");
    for (const p of proposals) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(["pattern", "insight", "self_knowledge"]).toContain(p.type);
      expect(typeof p.content).toBe("string");
      expect(p.content.length).toBeGreaterThan(0);
      expect(p.source).toBe("session-abc");
      expect(p.status).toBe("pending");
    }
  });

  test("extractedAt is a valid ISO datetime", () => {
    const text = "I learned that dates must be ISO formatted to be useful.";
    const proposals = extractProposals(text, "session-dt");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    for (const p of proposals) {
      // Should not throw when parsed as a Date
      const date = new Date(p.extractedAt);
      expect(date.toISOString()).toBe(p.extractedAt);
    }
  });

  test("deduplication by content (case-insensitive)", () => {
    const text = [
      "You prefer TypeScript over Python.",
      "Some unrelated text here.",
      "you prefer TypeScript over Python.",
    ].join(" ");
    const proposals = extractProposals(text, "session-dup");
    const contents = proposals.map((p) => p.content.toLowerCase());
    const unique = new Set(contents);
    expect(contents.length).toBe(unique.size);
  });

  test("empty transcript returns empty array", () => {
    const proposals = extractProposals("", "session-empty");
    expect(proposals).toEqual([]);
  });

  test("session ID flows to source field", () => {
    const text = "I learned that session tracking matters for audit trails.";
    const proposals = extractProposals(text, "custom-session-42");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].source).toBe("custom-session-42");
  });

  test("missing session ID defaults to 'unknown-session'", () => {
    const text = "I discovered that default values prevent undefined errors.";
    const proposals = extractProposals(text);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].source).toBe("unknown-session");
  });

  test("generated proposals validate against proposalSchema", () => {
    const text =
      "You always use strict TypeScript. I learned that Zod validation catches bugs early. Note to self: run typecheck before pushing.";
    const proposals = extractProposals(text, "session-schema");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    for (const p of proposals) {
      const result = proposalSchema.safeParse(p);
      expect(result.success).toBe(true);
    }
  });
});

// =============================================================================
// writeProposals — I/O tests (~6 tests)
// =============================================================================

describe("writeProposals", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-extraction-test-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("normal write: proposals appended to seed state", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const text = "You prefer functional patterns. I learned that immutability prevents bugs.";
    const proposals = extractProposals(text, "session-write");

    const result = await writeProposals(proposals, seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added).toBeGreaterThanOrEqual(1);
    }

    // Verify proposals were written to the seed file
    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.config.state.proposals.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("dedup against existing proposals in seed", async () => {
    await initTestGitRepo(testDir);

    // Create seed with an existing proposal
    const seed = createDefaultSeed();
    const existingProposal: Proposal = {
      id: "existing-1",
      type: "pattern",
      content: "You prefer TypeScript over Python",
      source: "old-session",
      extractedAt: new Date().toISOString(),
      status: "pending",
    };
    seed.state.proposals = [existingProposal];
    await writeSeedAndCommit(testDir, seed);

    // Extract proposals that include one matching existing content
    const text = "You prefer TypeScript over Python. I learned that dedup works correctly.";
    const proposals = extractProposals(text, "session-dedup");

    const result = await writeProposals(proposals, seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    }

    // Load and verify no duplicates
    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const contents = loadResult.config.state.proposals.map((p) =>
        p.content.toLowerCase(),
      );
      const unique = new Set(contents);
      expect(contents.length).toBe(unique.size);
    }
  });

  test("empty proposals returns { ok: true, added: 0, skipped: 0 }", async () => {
    const result = await writeProposals([], seedPath);
    expect(result).toEqual({ ok: true, added: 0, skipped: 0 });
  });

  test("load failure returns { ok: false }", async () => {
    // /dev/null is a file, not a directory — cannot create subdirs under it
    const badPath = "/dev/null/impossible/seed.json";
    const text = "You prefer error handling that does not throw.";
    const proposals = extractProposals(text, "session-fail");

    const result = await writeProposals(proposals, badPath);
    expect(result.ok).toBe(false);
  });

  test("existing proposals preserved when adding new ones", async () => {
    await initTestGitRepo(testDir);

    // Seed with existing proposals
    const seed = createDefaultSeed();
    const existing: Proposal = {
      id: "keep-me",
      type: "insight",
      content: "This existing proposal must survive the write",
      source: "old-session",
      extractedAt: new Date().toISOString(),
      status: "pending",
    };
    seed.state.proposals = [existing];
    await writeSeedAndCommit(testDir, seed);

    // Write new proposals
    const text = "I learned that existing data should be preserved during writes.";
    const proposals = extractProposals(text, "session-preserve");
    await writeProposals(proposals, seedPath);

    // Verify existing proposal is still there
    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const ids = loadResult.config.state.proposals.map((p) => p.id);
      expect(ids).toContain("keep-me");
      expect(loadResult.config.state.proposals.length).toBeGreaterThan(1);
    }
  });

  test("git commit message matches 'Learn: extracted N proposals'", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const text = "You prefer explicit error handling. I learned that clear messages help debugging.";
    const proposals = extractProposals(text, "session-commit-msg");

    await writeProposals(proposals, seedPath);

    // Check last git commit message
    const log = Bun.spawn(["git", "log", "-1", "--format=%s"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await log.exited;
    const msg = await new Response(log.stdout).text();
    expect(msg.trim()).toMatch(/^Learn: extracted \d+ proposals?$/);
  });
});

// =============================================================================
// extractionHook — End-to-end I/O tests (~7 tests)
// =============================================================================

describe("extractionHook", () => {
  let testDir: string;
  let seedPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-hook-test-"));
    seedPath = join(testDir, "seed.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("end-to-end flow: detects signals, writes proposals, returns counts", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const transcript = [
      "You prefer short functions that do one thing.",
      "I learned that smaller modules are easier to test.",
      "Note to self: always check error boundaries in React components.",
    ].join(" ");

    const result = await extractionHook(transcript, "session-e2e", seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
    }
  });

  test("no-signal transcript returns { ok: true, added: 0, total: 0 }", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const result = await extractionHook(
      "This is a normal conversation with no learning signals at all.",
      "session-nosignal",
      seedPath,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added).toBe(0);
      expect(result.total).toBe(0);
    }
  });

  test("write error returns { ok: false }", async () => {
    // /dev/null is a file, not a directory — impossible to create seed.json under it
    const badPath = "/dev/null/impossible/seed.json";
    const result = await extractionHook(
      "You prefer clear error messages in production.",
      "session-writefail",
      badPath,
    );
    expect(result.ok).toBe(false);
  });

  test("never throws on any error", async () => {
    // Various invalid inputs that should not throw
    const cases = [
      extractionHook("", undefined, "/nonexistent/path/seed.json"),
      extractionHook("You prefer X. ".repeat(1000), undefined, "/bad/path"),
      extractionHook("normal text", "s", seedPath),
    ];

    for (const promise of cases) {
      // Should resolve (not reject)
      const result = await promise;
      expect(typeof result.ok).toBe("boolean");
    }
  });

  test("idempotent: same transcript twice produces no duplication", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const transcript = "You prefer immutable data structures for state management.";

    const first = await extractionHook(transcript, "session-idem-1", seedPath);
    expect(first.ok).toBe(true);

    const second = await extractionHook(transcript, "session-idem-2", seedPath);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.added).toBe(0);
    }

    // Verify only one proposal in the seed
    const loadResult = await loadSeed(seedPath);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      const matchingProposals = loadResult.config.state.proposals.filter(
        (p) => p.content.toLowerCase().includes("immutable data structures"),
      );
      expect(matchingProposals.length).toBe(1);
    }
  });

  test("correct added/total counts", async () => {
    await initTestGitRepo(testDir);
    await writeSeedAndCommit(testDir);

    const transcript = [
      "You prefer functional programming patterns.",
      "I learned that TypeScript strict mode catches many bugs.",
      "I noticed that smaller PRs get reviewed faster.",
    ].join(" ");

    const result = await extractionHook(transcript, "session-counts", seedPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.added).toBe(result.total); // First run, all should be added
    }
  });

  test("performance: 100KB transcript completes in under 100ms", async () => {
    // Build a large transcript (~100KB)
    const sentence = "This is a normal sentence without any signal phrases. ";
    const repeated = sentence.repeat(Math.ceil(100_000 / sentence.length));
    // Add a few signals at the end
    const transcript =
      repeated +
      " You prefer fast code. I learned that optimization matters.";

    const start = performance.now();
    // Pure function only — no I/O needed for performance test
    const proposals = extractProposals(transcript, "perf-session");
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(proposals.length).toBeGreaterThanOrEqual(2);
  });
});
