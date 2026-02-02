import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeObservation,
  readObservations,
  resolveObservationsDir,
  observationSchema,
  type Observation,
} from "../src/observation";

// =============================================================================
// F-026 FR-1/FR-2: Observation capture and buffer
// =============================================================================

describe("F-026: resolveObservationsDir", () => {
  test("T-26.1a: custom dir returned as-is", () => {
    const result = resolveObservationsDir("/custom/path");
    expect(result).toBe("/custom/path");
  });

  test("T-26.1b: default dir is ~/.pai/observations", () => {
    const result = resolveObservationsDir();
    expect(result).toEndWith(".pai/observations");
  });
});

describe("F-026: writeObservation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-obs-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("T-26.2a: writes observation to session buffer file", async () => {
    const result = await writeObservation(
      {
        type: "pattern",
        content: "User prefers explicit error types over generic Error",
        sessionId: "session-abc",
      },
      testDir,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBeDefined();
      expect(result.file).toContain("session-abc.jsonl");
    }

    // Verify file exists and contains valid JSONL
    const files = await readdir(testDir);
    expect(files).toContain("session-abc.jsonl");

    const content = await readFile(join(testDir, "session-abc.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("pattern");
    expect(parsed.content).toBe("User prefers explicit error types over generic Error");
    expect(parsed.sessionId).toBe("session-abc");
    expect(parsed.observedAt).toBeDefined();
  });

  test("T-26.2b: appends multiple observations to same session file", async () => {
    await writeObservation(
      { type: "pattern", content: "First observation about patterns", sessionId: "session-multi" },
      testDir,
    );
    await writeObservation(
      { type: "insight", content: "Second observation about insights", sessionId: "session-multi" },
      testDir,
    );

    const content = await readFile(join(testDir, "session-multi.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(first.type).toBe("pattern");
    expect(second.type).toBe("insight");
  });

  test("T-26.2c: generates unique IDs for each observation", async () => {
    const r1 = await writeObservation(
      { type: "pattern", content: "Observation one with unique ID", sessionId: "session-ids" },
      testDir,
    );
    const r2 = await writeObservation(
      { type: "insight", content: "Observation two with unique ID", sessionId: "session-ids" },
      testDir,
    );
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.id).not.toBe(r2.id);
    }
  });

  test("T-26.2d: validates observation type", async () => {
    const result = await writeObservation(
      { type: "invalid" as any, content: "Bad type observation content", sessionId: "session-bad" },
      testDir,
    );
    expect(result.ok).toBe(false);
  });

  test("T-26.2e: optional context field included", async () => {
    await writeObservation(
      {
        type: "pattern",
        content: "Prefers functional error handling patterns",
        context: "While implementing error handling in src/api.ts",
        sessionId: "session-ctx",
      },
      testDir,
    );

    const content = await readFile(join(testDir, "session-ctx.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.context).toBe("While implementing error handling in src/api.ts");
  });
});

describe("F-026: readObservations", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "pai-seed-obs-read-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("T-26.3a: reads all observations for a session", async () => {
    await writeObservation(
      { type: "pattern", content: "First pattern observation in session", sessionId: "session-read" },
      testDir,
    );
    await writeObservation(
      { type: "insight", content: "First insight observation in session", sessionId: "session-read" },
      testDir,
    );

    const observations = await readObservations("session-read", testDir);
    expect(observations.length).toBe(2);
    expect(observations[0].type).toBe("pattern");
    expect(observations[1].type).toBe("insight");
  });

  test("T-26.3b: returns empty array for nonexistent session", async () => {
    const observations = await readObservations("session-missing", testDir);
    expect(observations).toEqual([]);
  });

  test("T-26.3c: skips malformed JSONL lines", async () => {
    // Write one valid and one invalid line
    const file = join(testDir, "session-bad.jsonl");
    const { mkdir: mkdirSync } = await import("node:fs/promises");
    await mkdirSync(testDir, { recursive: true });
    await Bun.write(file, '{"id":"obs1","type":"pattern","content":"Valid observation for testing","sessionId":"session-bad","observedAt":"2026-02-02T10:00:00Z"}\nnot json\n');

    const observations = await readObservations("session-bad", testDir);
    expect(observations.length).toBe(1);
    expect(observations[0].content).toBe("Valid observation for testing");
  });
});

describe("F-026: observationSchema", () => {
  test("T-26.4a: valid observation passes schema", () => {
    const result = observationSchema.safeParse({
      id: "obs_abc123",
      type: "pattern",
      content: "User prefers explicit error types",
      sessionId: "session-xyz",
      observedAt: "2026-02-02T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  test("T-26.4b: observation with context passes schema", () => {
    const result = observationSchema.safeParse({
      id: "obs_abc123",
      type: "self_knowledge",
      content: "Morning sessions are more productive",
      context: "Noticed during early morning coding",
      sessionId: "session-xyz",
      observedAt: "2026-02-02T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  test("T-26.4c: invalid type fails schema", () => {
    const result = observationSchema.safeParse({
      id: "obs_abc123",
      type: "invalid",
      content: "test",
      sessionId: "session-xyz",
      observedAt: "2026-02-02T10:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
