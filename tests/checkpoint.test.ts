import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveCheckpointsDir,
  createCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  detectIncompleteCheckpoint,
  completeCheckpoint,
  cleanupCheckpoints,
  checkpointStateSchema,
  type IscCriterionSnapshot,
} from "../src/checkpoint";
import { createDefaultSeed } from "../src/defaults";
import { writeSeed } from "../src/loader";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let checkpointsDir: string;
let seedPath: string;
let eventsDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-ckpt-test-"));
  checkpointsDir = join(tempDir, "checkpoints");
  seedPath = join(tempDir, "seed.json");
  eventsDir = join(tempDir, "events");

  const { mkdir } = await import("node:fs/promises");
  await mkdir(checkpointsDir, { recursive: true });
  await mkdir(eventsDir, { recursive: true });

  // Write a default seed.json for tests that update checkpointRef
  const seed = createDefaultSeed();
  await writeSeed(seed, seedPath);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const testCriteria: IscCriterionSnapshot[] = [
  { id: "c1", subject: "Tests pass for all modules", status: "pending" },
  { id: "c2", subject: "No regressions in existing suite", status: "completed" },
];

const opts = () => ({ checkpointsDir, seedPath, eventsDir });

// =============================================================================
// resolveCheckpointsDir (T-10.1)
// =============================================================================

describe("resolveCheckpointsDir", () => {
  test("returns default ~/.pai/checkpoints/ path", () => {
    const result = resolveCheckpointsDir();
    expect(result).toContain(".pai");
    expect(result).toContain("checkpoints");
  });

  test("returns resolved custom path", () => {
    const result = resolveCheckpointsDir("/custom/dir");
    expect(result).toBe("/custom/dir");
  });
});

// =============================================================================
// createCheckpoint (T-10.2)
// =============================================================================

describe("createCheckpoint", () => {
  test("creates checkpoint file on disk", async () => {
    const result = await createCheckpoint(
      "observe", 1, "Analyze the login flow", testCriteria, { key: "value" }, opts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = await readdir(checkpointsDir);
    const ckptFiles = files.filter((f) => f.startsWith("ckpt-"));
    expect(ckptFiles.length).toBe(1);
  });

  test("checkpoint file is valid JSON with correct schema", async () => {
    const result = await createCheckpoint(
      "build", 4, "Implement auth module", testCriteria, {}, opts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = await readdir(checkpointsDir);
    const ckptFile = files.find((f) => f.startsWith("ckpt-"))!;
    const content = await readFile(join(checkpointsDir, ckptFile), "utf-8");
    const parsed = checkpointStateSchema.safeParse(JSON.parse(content));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phase).toBe("build");
      expect(parsed.data.phaseNumber).toBe(4);
      expect(parsed.data.completed).toBe(false);
      expect(parsed.data.taskSummary).toBe("Implement auth module");
    }
  });

  test("returns checkpointId and filename", async () => {
    const result = await createCheckpoint(
      "think", 2, "Design the API", [], {}, opts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checkpointId).toBeTruthy();
    expect(result.file).toMatch(/^ckpt-.*\.json$/);
  });

  test("updates seed.json checkpointRef", async () => {
    const result = await createCheckpoint(
      "plan", 3, "Plan deployment strategy", [], {}, opts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seedContent = await readFile(seedPath, "utf-8");
    const seed = JSON.parse(seedContent);
    expect(seed.state.checkpointRef).toBe(result.checkpointId);
  });

  test("never throws on error", async () => {
    const result = await createCheckpoint(
      "observe", 1, "Test", [], {},
      { checkpointsDir: "/nonexistent/readonly/path", seedPath, eventsDir },
    );
    // Should return error result, not throw
    expect(result.ok === true || result.ok === false).toBe(true);
  });
});

// =============================================================================
// loadCheckpoint (T-10.3)
// =============================================================================

describe("loadCheckpoint", () => {
  test("loads checkpoint by ID", async () => {
    const result = await createCheckpoint(
      "execute", 5, "Run the pipeline", testCriteria, { step: 3 }, opts(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const loaded = await loadCheckpoint(result.checkpointId, opts());
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(result.checkpointId);
    expect(loaded!.phase).toBe("execute");
    expect(loaded!.metadata).toEqual({ step: 3 });
  });

  test("returns null for missing ID", async () => {
    const loaded = await loadCheckpoint("nonexistent-id", opts());
    expect(loaded).toBeNull();
  });

  test("returns null for empty directory", async () => {
    const loaded = await loadCheckpoint("any-id", opts());
    expect(loaded).toBeNull();
  });
});

// =============================================================================
// listCheckpoints (T-10.3)
// =============================================================================

describe("listCheckpoints", () => {
  test("lists all checkpoints sorted by createdAt desc", async () => {
    await createCheckpoint("observe", 1, "Task A", [], {}, opts());
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await createCheckpoint("build", 4, "Task B", [], {}, opts());

    const all = await listCheckpoints(undefined, opts());
    expect(all.length).toBe(2);
    // Most recent first
    expect(all[0].phase).toBe("build");
    expect(all[1].phase).toBe("observe");
  });

  test("filters by completed: false", async () => {
    const r1 = await createCheckpoint("observe", 1, "Task A", [], {}, opts());
    await createCheckpoint("build", 4, "Task B", [], {}, opts());

    if (r1.ok) await completeCheckpoint(r1.checkpointId, opts());

    const incomplete = await listCheckpoints({ completed: false }, opts());
    expect(incomplete.length).toBe(1);
    expect(incomplete[0].phase).toBe("build");
  });

  test("filters by completed: true", async () => {
    const r1 = await createCheckpoint("observe", 1, "Task A", [], {}, opts());
    await createCheckpoint("build", 4, "Task B", [], {}, opts());

    if (r1.ok) await completeCheckpoint(r1.checkpointId, opts());

    const completed = await listCheckpoints({ completed: true }, opts());
    expect(completed.length).toBe(1);
    expect(completed[0].phase).toBe("observe");
  });

  test("returns empty array for missing directory", async () => {
    const result = await listCheckpoints(undefined, {
      checkpointsDir: join(tempDir, "nonexistent"),
    });
    expect(result).toEqual([]);
  });
});

// =============================================================================
// detectIncompleteCheckpoint (T-10.4)
// =============================================================================

describe("detectIncompleteCheckpoint", () => {
  test("finds most recent incomplete checkpoint", async () => {
    await createCheckpoint("observe", 1, "Task A", [], {}, opts());
    await new Promise((r) => setTimeout(r, 10));
    await createCheckpoint("think", 2, "Task A continued", testCriteria, {}, opts());

    const incomplete = await detectIncompleteCheckpoint(opts());
    expect(incomplete).not.toBeNull();
    expect(incomplete!.phase).toBe("think");
  });

  test("returns null when no incomplete checkpoints", async () => {
    const r1 = await createCheckpoint("observe", 1, "Task A", [], {}, opts());
    if (r1.ok) await completeCheckpoint(r1.checkpointId, opts());

    const incomplete = await detectIncompleteCheckpoint(opts());
    expect(incomplete).toBeNull();
  });

  test("ignores completed checkpoints", async () => {
    const r1 = await createCheckpoint("observe", 1, "Completed task", [], {}, opts());
    if (r1.ok) await completeCheckpoint(r1.checkpointId, opts());
    await new Promise((r) => setTimeout(r, 10));
    const r2 = await createCheckpoint("build", 4, "Active task", [], {}, opts());

    const incomplete = await detectIncompleteCheckpoint(opts());
    expect(incomplete).not.toBeNull();
    expect(incomplete!.phase).toBe("build");
  });
});

// =============================================================================
// completeCheckpoint (T-10.5)
// =============================================================================

describe("completeCheckpoint", () => {
  test("marks checkpoint as completed", async () => {
    const r = await createCheckpoint("verify", 6, "Verify all ISC", testCriteria, {}, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const result = await completeCheckpoint(r.checkpointId, opts());
    expect(result.ok).toBe(true);

    const loaded = await loadCheckpoint(r.checkpointId, opts());
    expect(loaded!.completed).toBe(true);
  });

  test("clears seed.json checkpointRef", async () => {
    const r = await createCheckpoint("learn", 7, "Capture learnings", [], {}, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Verify ref was set
    let seedContent = await readFile(seedPath, "utf-8");
    expect(JSON.parse(seedContent).state.checkpointRef).toBe(r.checkpointId);

    await completeCheckpoint(r.checkpointId, opts());

    seedContent = await readFile(seedPath, "utf-8");
    expect(JSON.parse(seedContent).state.checkpointRef).toBeUndefined();
  });

  test("returns error for missing checkpoint", async () => {
    const result = await completeCheckpoint("nonexistent-id", opts());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });
});

// =============================================================================
// cleanupCheckpoints (T-10.6)
// =============================================================================

describe("cleanupCheckpoints", () => {
  test("deletes checkpoints older than cutoff", async () => {
    // Create a checkpoint and manually backdate it
    const r = await createCheckpoint("observe", 1, "Old task", [], {}, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Backdate the checkpoint to 60 days ago
    const files = await readdir(checkpointsDir);
    const ckptFile = files.find((f) => f.startsWith("ckpt-"))!;
    const content = await readFile(join(checkpointsDir, ckptFile), "utf-8");
    const ckpt = JSON.parse(content);
    ckpt.createdAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
    await writeFile(join(checkpointsDir, ckptFile), JSON.stringify(ckpt, null, 2));

    const result = await cleanupCheckpoints(30, opts());
    expect(result.deleted).toBe(1);

    const remaining = (await readdir(checkpointsDir)).filter((f) => f.startsWith("ckpt-"));
    expect(remaining.length).toBe(0);
  });

  test("preserves recent checkpoints", async () => {
    await createCheckpoint("observe", 1, "Recent task", [], {}, opts());

    const result = await cleanupCheckpoints(30, opts());
    expect(result.deleted).toBe(0);

    const remaining = (await readdir(checkpointsDir)).filter((f) => f.startsWith("ckpt-"));
    expect(remaining.length).toBe(1);
  });

  test("clears stale checkpointRef from seed.json", async () => {
    const r = await createCheckpoint("observe", 1, "Old task", [], {}, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Backdate
    const files = await readdir(checkpointsDir);
    const ckptFile = files.find((f) => f.startsWith("ckpt-"))!;
    const content = await readFile(join(checkpointsDir, ckptFile), "utf-8");
    const ckpt = JSON.parse(content);
    ckpt.createdAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
    await writeFile(join(checkpointsDir, ckptFile), JSON.stringify(ckpt, null, 2));

    // Verify ref exists
    let seedContent = await readFile(seedPath, "utf-8");
    expect(JSON.parse(seedContent).state.checkpointRef).toBe(r.checkpointId);

    await cleanupCheckpoints(30, opts());

    seedContent = await readFile(seedPath, "utf-8");
    expect(JSON.parse(seedContent).state.checkpointRef).toBeUndefined();
  });
});
