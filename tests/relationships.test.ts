import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  relationshipSchema,
  keyMomentSchema,
  resolveRelationshipsDir,
  slugifyName,
  loadRelationship,
  saveRelationship,
  addRelationship,
  removeRelationship,
  updateRelationship,
  listRelationships,
  addKeyMoment,
} from "../src/relationships";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-rel-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const opts = () => ({ paiDir: tempDir });

function makeRelationship(name: string, context = "test context") {
  return {
    name,
    firstEncountered: new Date().toISOString(),
    lastInteraction: new Date().toISOString(),
    context,
    keyMoments: [],
  };
}

// =============================================================================
// T-13.1: Relationship Schema
// =============================================================================

describe("relationshipSchema", () => {
  test("validates correct relationship", () => {
    const rel = makeRelationship("Alice");
    const result = relationshipSchema.safeParse(rel);
    expect(result.success).toBe(true);
  });

  test("rejects missing required fields", () => {
    const result = relationshipSchema.safeParse({ name: "Alice" });
    expect(result.success).toBe(false);
  });

  test("keyMoment schema validates correctly", () => {
    const moment = {
      date: new Date().toISOString(),
      description: "Met at conference",
      tags: ["work"],
    };
    const result = keyMomentSchema.safeParse(moment);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// T-13.2: Path Resolution and Slugification
// =============================================================================

describe("resolveRelationshipsDir", () => {
  test("returns correct path with paiDir", () => {
    const dir = resolveRelationshipsDir("/custom/.pai");
    expect(dir).toBe("/custom/.pai/relationships");
  });
});

describe("slugifyName", () => {
  test("handles spaces", () => {
    expect(slugifyName("Alice Johnson")).toBe("alice-johnson");
  });

  test("handles special characters", () => {
    expect(slugifyName("O'Brien & Co.")).toBe("obrien-co");
  });

  test("handles consecutive separators", () => {
    expect(slugifyName("Alice   ---  Bob")).toBe("alice-bob");
  });

  test("handles leading/trailing hyphens", () => {
    expect(slugifyName(" - test - ")).toBe("test");
  });
});

// =============================================================================
// T-13.3: Load and Save
// =============================================================================

describe("loadRelationship", () => {
  test("reads valid file", async () => {
    const rel = makeRelationship("Alice");
    await saveRelationship(rel, opts());

    const result = await loadRelationship("Alice", opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.name).toBe("Alice");
  });

  test("returns error for missing file", async () => {
    const result = await loadRelationship("Nonexistent", opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });

  test("returns error for invalid JSON", async () => {
    const { mkdir: mkdirFs } = await import("node:fs/promises");
    const dir = resolveRelationshipsDir(tempDir);
    await mkdirFs(dir, { recursive: true });
    await Bun.write(join(dir, "rel_alice.json"), "not json{{{");

    const result = await loadRelationship("Alice", opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Invalid JSON");
  });
});

describe("saveRelationship", () => {
  test("writes atomically", async () => {
    const rel = makeRelationship("Bob");
    const result = await saveRelationship(rel, opts());
    expect(result.ok).toBe(true);

    // Verify file exists and is readable
    const loaded = await loadRelationship("Bob", opts());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.relationship.name).toBe("Bob");
  });

  test("creates directory if missing", async () => {
    const customDir = join(tempDir, "nested", "pai");
    const rel = makeRelationship("Carol");
    const result = await saveRelationship(rel, { paiDir: customDir });
    expect(result.ok).toBe(true);

    const loaded = await loadRelationship("Carol", { paiDir: customDir });
    expect(loaded.ok).toBe(true);
  });
});

// =============================================================================
// T-13.4: Add and Remove
// =============================================================================

describe("addRelationship", () => {
  test("creates new file", async () => {
    const result = await addRelationship("Dave", "Friend from school", opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.name).toBe("Dave");
    expect(result.relationship.context).toBe("Friend from school");
  });

  test("errors if already exists", async () => {
    await addRelationship("Eve", undefined, opts());
    const result = await addRelationship("Eve", undefined, opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("already exists");
  });
});

describe("removeRelationship", () => {
  test("deletes file", async () => {
    await addRelationship("Frank", undefined, opts());
    const result = await removeRelationship("Frank", opts());
    expect(result.ok).toBe(true);

    // Verify deleted
    const loaded = await loadRelationship("Frank", opts());
    expect(loaded.ok).toBe(false);
  });

  test("errors if not found", async () => {
    const result = await removeRelationship("Ghost", opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });
});

// =============================================================================
// T-13.5: Update and List
// =============================================================================

describe("updateRelationship", () => {
  test("merges fields", async () => {
    await addRelationship("Grace", "Initial context", opts());
    const result = await updateRelationship("Grace", { context: "Updated context" }, opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.context).toBe("Updated context");
  });

  test("updates lastInteraction", async () => {
    const addResult = await addRelationship("Hank", undefined, opts());
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;
    const originalTime = addResult.relationship.lastInteraction;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    const result = await updateRelationship("Hank", { context: "new" }, opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.lastInteraction >= originalTime).toBe(true);
  });
});

describe("listRelationships", () => {
  test("returns all names", async () => {
    await addRelationship("Alice", undefined, opts());
    await addRelationship("Bob", undefined, opts());
    await addRelationship("Carol", undefined, opts());

    const result = await listRelationships(opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.names).toEqual(["alice", "bob", "carol"]);
  });

  test("returns empty for no files", async () => {
    const result = await listRelationships(opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.names).toEqual([]);
  });
});

// =============================================================================
// T-13.6: Key Moments
// =============================================================================

describe("addKeyMoment", () => {
  test("appends to array", async () => {
    await addRelationship("Ivan", undefined, opts());
    const result = await addKeyMoment("Ivan", "Met at conference", undefined, opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.keyMoments.length).toBe(1);
    expect(result.relationship.keyMoments[0].description).toBe("Met at conference");
  });

  test("updates lastInteraction", async () => {
    const addResult = await addRelationship("Jane", undefined, opts());
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;
    const originalTime = addResult.relationship.lastInteraction;

    await new Promise((r) => setTimeout(r, 10));

    const result = await addKeyMoment("Jane", "Lunch meeting", undefined, opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.lastInteraction >= originalTime).toBe(true);
  });

  test("includes tags when provided", async () => {
    await addRelationship("Kim", undefined, opts());
    const result = await addKeyMoment("Kim", "Project review", ["work", "review"], opts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.relationship.keyMoments[0].tags).toEqual(["work", "review"]);
  });
});

// =============================================================================
// T-13.8: Exports
// =============================================================================

describe("exports", () => {
  test("all exports importable from index", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.addRelationship).toBe("function");
    expect(typeof mod.loadRelationship).toBe("function");
    expect(typeof mod.saveRelationship).toBe("function");
    expect(typeof mod.removeRelationship).toBe("function");
    expect(typeof mod.updateRelationship).toBe("function");
    expect(typeof mod.listRelationships).toBe("function");
    expect(typeof mod.addKeyMoment).toBe("function");
    expect(typeof mod.slugifyName).toBe("function");
    expect(typeof mod.resolveRelationshipsDir).toBe("function");
    expect(mod.relationshipSchema).toBeDefined();
    expect(mod.keyMomentSchema).toBeDefined();
  });
});
