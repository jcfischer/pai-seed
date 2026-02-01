import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventTypeSchema } from "../src/events";
import { logEvent, readEvents } from "../src/events";
import {
  redactionDataSchema,
  getRedactedIds,
  isRedacted,
  redactEvent,
} from "../src/redaction";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let eventsDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-redact-test-"));
  eventsDir = join(tempDir, "events");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(eventsDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const opts = () => ({ eventsDir });

// =============================================================================
// T-16.1: Redaction Event Type
// =============================================================================

describe("redaction event type", () => {
  test("eventTypeSchema accepts redaction", () => {
    const result = eventTypeSchema.safeParse("redaction");
    expect(result.success).toBe(true);
  });

  test("redactionDataSchema validates correct data", () => {
    const data = { redactedEventId: "evt-123", reason: "PII removal" };
    const result = redactionDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("redactionDataSchema rejects missing redactedEventId", () => {
    const data = { reason: "no id" };
    const result = redactionDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// T-16.2: getRedactedIds and isRedacted
// =============================================================================

describe("getRedactedIds", () => {
  test("returns empty set for no redactions", async () => {
    await logEvent("session_start", {}, "s1", eventsDir);
    const ids = await getRedactedIds(opts());
    expect(ids.size).toBe(0);
  });

  test("finds redacted IDs", async () => {
    const result = await logEvent("session_start", { action: "begin" }, "s1", eventsDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await redactEvent(result.eventId, "test reason", opts());
    const ids = await getRedactedIds(opts());
    expect(ids.has(result.eventId)).toBe(true);
  });
});

describe("isRedacted", () => {
  test("returns true for redacted event", async () => {
    const result = await logEvent("session_start", {}, "s1", eventsDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await redactEvent(result.eventId, undefined, opts());
    const redacted = await isRedacted(result.eventId, opts());
    expect(redacted).toBe(true);
  });

  test("returns false for non-redacted event", async () => {
    const result = await logEvent("session_start", {}, "s1", eventsDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const redacted = await isRedacted(result.eventId, opts());
    expect(redacted).toBe(false);
  });
});

// =============================================================================
// T-16.3: redactEvent
// =============================================================================

describe("redactEvent", () => {
  test("creates redaction marker", async () => {
    const result = await logEvent("skill_invoked", { skill: "test" }, "s1", eventsDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const redactResult = await redactEvent(result.eventId, undefined, opts());
    expect(redactResult.ok).toBe(true);
    if (!redactResult.ok) return;
    expect(redactResult.redactedEventId).toBe(result.eventId);
  });

  test("returns error for nonexistent event", async () => {
    const result = await redactEvent("nonexistent-id", undefined, opts());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });

  test("returns error for already redacted event", async () => {
    const logResult = await logEvent("session_start", {}, "s1", eventsDir);
    expect(logResult.ok).toBe(true);
    if (!logResult.ok) return;

    await redactEvent(logResult.eventId, undefined, opts());
    const second = await redactEvent(logResult.eventId, undefined, opts());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain("already redacted");
  });

  test("includes reason in data", async () => {
    const logResult = await logEvent("error", { msg: "test" }, "s1", eventsDir);
    expect(logResult.ok).toBe(true);
    if (!logResult.ok) return;

    await redactEvent(logResult.eventId, "Contains PII", opts());

    // Read all events including redacted to see the redaction marker
    const events = await readEvents({ eventsDir, includeRedacted: true });
    const redactionEvent = events.find((e) => e.type === "redaction");
    expect(redactionEvent).toBeDefined();
    expect(redactionEvent!.data.reason).toBe("Contains PII");
  });

  test("audit trail: original event preserved in JSONL", async () => {
    const logResult = await logEvent("session_start", { action: "begin" }, "s1", eventsDir);
    expect(logResult.ok).toBe(true);
    if (!logResult.ok) return;

    await redactEvent(logResult.eventId, undefined, opts());

    // Read with includeRedacted to see everything
    const all = await readEvents({ eventsDir, includeRedacted: true });
    const original = all.find((e) => e.id === logResult.eventId);
    expect(original).toBeDefined();
    expect(original!.data.action).toBe("begin");
  });
});

// =============================================================================
// T-16.4: readEvents Filtering
// =============================================================================

describe("readEvents filtering", () => {
  test("excludes redacted events by default", async () => {
    const r1 = await logEvent("session_start", {}, "s1", eventsDir);
    await logEvent("session_end", {}, "s1", eventsDir);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    await redactEvent(r1.eventId, undefined, opts());

    const events = await readEvents({ eventsDir });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("session_end");
  });

  test("includes redacted events when includeRedacted=true", async () => {
    const r1 = await logEvent("session_start", {}, "s1", eventsDir);
    await logEvent("session_end", {}, "s1", eventsDir);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    await redactEvent(r1.eventId, undefined, opts());

    const events = await readEvents({ eventsDir, includeRedacted: true });
    // original + session_end + redaction marker = 3
    expect(events.length).toBe(3);
  });

  test("works with no redactions", async () => {
    await logEvent("session_start", {}, "s1", eventsDir);
    await logEvent("session_end", {}, "s1", eventsDir);

    const events = await readEvents({ eventsDir });
    expect(events.length).toBe(2);
  });
});

// =============================================================================
// T-16.6: Exports
// =============================================================================

describe("exports", () => {
  test("all exports importable from index", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.redactEvent).toBe("function");
    expect(typeof mod.getRedactedIds).toBe("function");
    expect(typeof mod.isRedacted).toBe("function");
    expect(mod.redactionDataSchema).toBeDefined();
  });
});
