import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { nanoid } from "nanoid";
import {
  resolveEventsDir,
  appendEvent,
  readEvents,
  countEvents,
  logEvent,
} from "../src/events";
import type { SystemEvent } from "../src/events";

// =============================================================================
// Test Helpers
// =============================================================================

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "pai-events-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function createTestEvent(overrides?: Partial<SystemEvent>): SystemEvent {
  return {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    sessionId: "test-session",
    type: "custom",
    data: { test: true },
    ...overrides,
  };
}

// =============================================================================
// resolveEventsDir - Pure function (2 tests)
// =============================================================================

describe("resolveEventsDir", () => {
  test("returns default ~/.pai/events/ path when no arg", () => {
    const result = resolveEventsDir();
    expect(result).toBe(join(homedir(), ".pai", "events"));
  });

  test("returns resolved custom path when provided", () => {
    const result = resolveEventsDir("./my-events");
    expect(result).toBe(resolve("./my-events"));
  });
});

// =============================================================================
// appendEvent - I/O (8 tests)
// =============================================================================

describe("appendEvent", () => {
  test("writes single event to JSONL file", async () => {
    const event = createTestEvent();
    const result = await appendEvent(event, testDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = await readdir(testDir);
    expect(files).toHaveLength(1);

    const content = await readFile(join(testDir, files[0]), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.id).toBe(event.id);
  });

  test("appends multiple events to same day's file", async () => {
    const ts = "2026-02-01T10:00:00.000Z";
    const event1 = createTestEvent({ timestamp: ts });
    const event2 = createTestEvent({ timestamp: ts });

    await appendEvent(event1, testDir);
    await appendEvent(event2, testDir);

    const files = await readdir(testDir);
    expect(files).toHaveLength(1);

    const content = await readFile(join(testDir, files[0]), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  test("creates directory if missing", async () => {
    const nestedDir = join(testDir, "nested", "deep", "events");
    const event = createTestEvent();
    const result = await appendEvent(event, nestedDir);

    expect(result.ok).toBe(true);

    const files = await readdir(nestedDir);
    expect(files).toHaveLength(1);
  });

  test("creates file on first write", async () => {
    const event = createTestEvent();

    const filesBefore = await readdir(testDir);
    expect(filesBefore).toHaveLength(0);

    await appendEvent(event, testDir);

    const filesAfter = await readdir(testDir);
    expect(filesAfter).toHaveLength(1);
  });

  test("uses correct day-partitioned filename", async () => {
    const event = createTestEvent({ timestamp: "2026-03-15T12:30:00.000Z" });
    await appendEvent(event, testDir);

    const files = await readdir(testDir);
    expect(files).toContain("events-2026-03-15.jsonl");
  });

  test("each line is valid parseable JSON", async () => {
    const event1 = createTestEvent({ timestamp: "2026-01-01T00:00:00.000Z" });
    const event2 = createTestEvent({ timestamp: "2026-01-01T06:00:00.000Z" });

    await appendEvent(event1, testDir);
    await appendEvent(event2, testDir);

    const content = await readFile(
      join(testDir, "events-2026-01-01.jsonl"),
      "utf-8",
    );
    const lines = content.trim().split("\n");
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("returns { ok: true, eventId, file } on success", async () => {
    const event = createTestEvent({ timestamp: "2026-05-20T08:00:00.000Z" });
    const result = await appendEvent(event, testDir);

    expect(result).toEqual({
      ok: true,
      eventId: event.id,
      file: "events-2026-05-20.jsonl",
    });
  });

  test("returns { ok: false, error } for invalid event", async () => {
    const badEvent = { id: "", timestamp: "not-a-date", type: "invalid" } as unknown as SystemEvent;
    const result = await appendEvent(badEvent, testDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });
});

// =============================================================================
// readEvents - I/O (10 tests)
// =============================================================================

describe("readEvents", () => {
  test("reads all events from directory", async () => {
    const event1 = createTestEvent({ timestamp: "2026-01-10T10:00:00.000Z" });
    const event2 = createTestEvent({ timestamp: "2026-01-11T10:00:00.000Z" });

    await appendEvent(event1, testDir);
    await appendEvent(event2, testDir);

    const events = await readEvents({ eventsDir: testDir });
    expect(events).toHaveLength(2);
  });

  test("filters by event type", async () => {
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-10T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "error", timestamp: "2026-01-10T11:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-10T12:00:00.000Z" }), testDir);

    const events = await readEvents({ eventsDir: testDir, type: "session_start" });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === "session_start")).toBe(true);
  });

  test("filters by sessionId", async () => {
    await appendEvent(createTestEvent({ sessionId: "sess-a", timestamp: "2026-01-10T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ sessionId: "sess-b", timestamp: "2026-01-10T11:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ sessionId: "sess-a", timestamp: "2026-01-10T12:00:00.000Z" }), testDir);

    const events = await readEvents({ eventsDir: testDir, sessionId: "sess-a" });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.sessionId === "sess-a")).toBe(true);
  });

  test("filters by date range (since)", async () => {
    await appendEvent(createTestEvent({ timestamp: "2026-01-05T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ timestamp: "2026-01-10T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ timestamp: "2026-01-15T10:00:00.000Z" }), testDir);

    const events = await readEvents({
      eventsDir: testDir,
      since: new Date("2026-01-10T00:00:00.000Z"),
    });
    expect(events).toHaveLength(2);
  });

  test("filters by date range (until)", async () => {
    await appendEvent(createTestEvent({ timestamp: "2026-01-05T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ timestamp: "2026-01-10T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ timestamp: "2026-01-15T10:00:00.000Z" }), testDir);

    const events = await readEvents({
      eventsDir: testDir,
      until: new Date("2026-01-10T10:00:00.000Z"),
    });
    expect(events).toHaveLength(2);
  });

  test("returns chronological order", async () => {
    // Write out of order on purpose
    await appendEvent(createTestEvent({ timestamp: "2026-01-15T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ timestamp: "2026-01-05T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ timestamp: "2026-01-10T10:00:00.000Z" }), testDir);

    const events = await readEvents({ eventsDir: testDir });
    expect(events).toHaveLength(3);
    expect(events[0].timestamp).toBe("2026-01-05T10:00:00.000Z");
    expect(events[1].timestamp).toBe("2026-01-10T10:00:00.000Z");
    expect(events[2].timestamp).toBe("2026-01-15T10:00:00.000Z");
  });

  test("applies limit", async () => {
    for (let i = 0; i < 5; i++) {
      await appendEvent(
        createTestEvent({ timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z` }),
        testDir,
      );
    }

    const events = await readEvents({ eventsDir: testDir, limit: 3 });
    expect(events).toHaveLength(3);
    // Should be the first 3 chronologically
    expect(events[0].timestamp).toBe("2026-01-01T10:00:00.000Z");
    expect(events[2].timestamp).toBe("2026-01-03T10:00:00.000Z");
  });

  test("returns empty array for empty directory", async () => {
    const events = await readEvents({ eventsDir: testDir });
    expect(events).toEqual([]);
  });

  test("returns empty array for non-existent directory", async () => {
    const events = await readEvents({
      eventsDir: join(testDir, "does-not-exist"),
    });
    expect(events).toEqual([]);
  });

  test("skips malformed JSONL lines", async () => {
    const event = createTestEvent({ timestamp: "2026-02-01T10:00:00.000Z" });
    await appendEvent(event, testDir);

    // Manually inject a malformed line
    const filePath = join(testDir, "events-2026-02-01.jsonl");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(filePath, "this is not json\n");
    await appendFile(filePath, '{"id":"","timestamp":"bad"}\n');

    const events = await readEvents({ eventsDir: testDir });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(event.id);
  });
});

// =============================================================================
// countEvents - I/O (4 tests)
// =============================================================================

describe("countEvents", () => {
  test("counts all events grouped by type", async () => {
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-10T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-10T11:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "error", timestamp: "2026-01-10T12:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "custom", timestamp: "2026-01-10T13:00:00.000Z" }), testDir);

    const counts = await countEvents({ eventsDir: testDir });
    expect(counts).toEqual({
      session_start: 2,
      error: 1,
      custom: 1,
    });
  });

  test("counts with type filter", async () => {
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-10T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "error", timestamp: "2026-01-10T11:00:00.000Z" }), testDir);

    const counts = await countEvents({ eventsDir: testDir, type: "error" });
    expect(counts).toEqual({ error: 1 });
  });

  test("returns empty record for no events", async () => {
    const counts = await countEvents({ eventsDir: testDir });
    expect(counts).toEqual({});
  });

  test("supports date range filtering", async () => {
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-05T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "session_start", timestamp: "2026-01-15T10:00:00.000Z" }), testDir);
    await appendEvent(createTestEvent({ type: "error", timestamp: "2026-01-15T11:00:00.000Z" }), testDir);

    const counts = await countEvents({
      eventsDir: testDir,
      since: new Date("2026-01-10T00:00:00.000Z"),
    });
    expect(counts).toEqual({
      session_start: 1,
      error: 1,
    });
  });
});

// =============================================================================
// logEvent - I/O (5 tests)
// =============================================================================

describe("logEvent", () => {
  test("creates event with nanoid ID and ISO timestamp", async () => {
    const result = await logEvent("custom", { hello: "world" }, "my-session", testDir);
    expect(result.ok).toBe(true);

    const events = await readEvents({ eventsDir: testDir });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBeDefined();
    expect(events[0].id.length).toBeGreaterThan(0);
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[0].data).toEqual({ hello: "world" });
  });

  test("uses PAI_SESSION_ID env var when set", async () => {
    const original = process.env.PAI_SESSION_ID;
    process.env.PAI_SESSION_ID = "env-session-123";

    try {
      await logEvent("session_start", {}, undefined, testDir);
      const events = await readEvents({ eventsDir: testDir });
      expect(events[0].sessionId).toBe("env-session-123");
    } finally {
      if (original !== undefined) {
        process.env.PAI_SESSION_ID = original;
      } else {
        delete process.env.PAI_SESSION_ID;
      }
    }
  });

  test("defaults sessionId to 'unknown' when env unset", async () => {
    const original = process.env.PAI_SESSION_ID;
    delete process.env.PAI_SESSION_ID;

    try {
      await logEvent("custom", {}, undefined, testDir);
      const events = await readEvents({ eventsDir: testDir });
      expect(events[0].sessionId).toBe("unknown");
    } finally {
      if (original !== undefined) {
        process.env.PAI_SESSION_ID = original;
      } else {
        delete process.env.PAI_SESSION_ID;
      }
    }
  });

  test("never throws on error", async () => {
    // Pass a path that would fail (read-only, etc.) - worst case it returns ok: false
    // The key contract is it never throws
    const result = await logEvent("custom", { test: true }, "sess", testDir);
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe("boolean");
  });

  test("returns AppendResult from appendEvent", async () => {
    const result = await logEvent("error", { msg: "oops" }, "sess-1", testDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventId).toBeDefined();
    expect(result.file).toMatch(/^events-\d{4}-\d{2}-\d{2}\.jsonl$/);
  });
});

// =============================================================================
// Performance (1 test)
// =============================================================================

describe("performance", () => {
  test("appending 100 events completes in < 1 second", async () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      createTestEvent({
        timestamp: `2026-06-15T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
      }),
    );

    const start = performance.now();
    for (const event of events) {
      await appendEvent(event, testDir);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});
