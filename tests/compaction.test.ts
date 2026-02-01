import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  generatePeriodSummary,
  formatCompactionMessage,
  initEventIndex,
  indexEvent,
  indexEvents,
  removeIndexEntries,
  insertSummary,
  querySummaries,
  rebuildIndex,
  findEligiblePeriods,
  isAlreadyArchived,
  archivePeriod,
  removeSourceFiles,
  compactEvents,
  resolveArchiveDir,
  periodSummarySchema,
} from "../src/compaction";
import { type SystemEvent, appendEvent } from "../src/events";

// =============================================================================
// Helpers
// =============================================================================

let tempDir: string;
let eventsDir: string;
let archiveDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pai-compact-test-"));
  eventsDir = join(tempDir, "events");
  archiveDir = join(tempDir, "archive");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(eventsDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeEvent(overrides: Partial<SystemEvent> & { timestamp: string }): SystemEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess-1",
    type: "session_start",
    data: {},
    ...overrides,
  };
}

async function seedEvents(
  dir: string,
  months: string[],
  eventsPerDay: number = 3,
): Promise<SystemEvent[]> {
  const allEvents: SystemEvent[] = [];
  for (const month of months) {
    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr, 10);
    const m = parseInt(monthStr, 10);
    const lastDay = new Date(year, m, 0).getDate();

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`;
      for (let i = 0; i < eventsPerDay; i++) {
        const types: SystemEvent["type"][] = [
          "session_start", "skill_invoked", "isc_verified",
          "learning_extracted", "error", "session_end",
        ];
        const event = makeEvent({
          timestamp: `${dateStr}T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
          type: types[i % types.length],
          sessionId: `sess-${d}-${i}`,
          data: types[i % types.length] === "skill_invoked"
            ? { skill: `skill-${(i % 3) + 1}` }
            : types[i % types.length] === "error"
              ? { error: `err-${(i % 2) + 1}` }
              : {},
        });
        allEvents.push(event);
        await appendEvent(event, dir);
      }
    }
  }
  return allEvents;
}

// =============================================================================
// generatePeriodSummary (T-9.2) — Pure function
// =============================================================================

describe("generatePeriodSummary", () => {
  test("counts events by type correctly", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z", type: "session_start" }),
      makeEvent({ timestamp: "2025-10-01T11:00:00.000Z", type: "session_start" }),
      makeEvent({ timestamp: "2025-10-01T12:00:00.000Z", type: "skill_invoked", data: { skill: "test" } }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.eventCounts["session_start"]).toBe(2);
    expect(summary.eventCounts["skill_invoked"]).toBe(1);
    expect(summary.eventCount).toBe(3);
  });

  test("identifies top skill patterns", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z", type: "skill_invoked", data: { skill: "alpha" } }),
      makeEvent({ timestamp: "2025-10-01T11:00:00.000Z", type: "skill_invoked", data: { skill: "alpha" } }),
      makeEvent({ timestamp: "2025-10-01T12:00:00.000Z", type: "skill_invoked", data: { skill: "beta" } }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.topPatterns.skills[0]).toEqual({ name: "alpha", count: 2 });
    expect(summary.topPatterns.skills[1]).toEqual({ name: "beta", count: 1 });
  });

  test("identifies top error patterns", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z", type: "error", data: { error: "timeout" } }),
      makeEvent({ timestamp: "2025-10-01T11:00:00.000Z", type: "error", data: { error: "timeout" } }),
      makeEvent({ timestamp: "2025-10-01T12:00:00.000Z", type: "error", data: { error: "auth" } }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.topPatterns.errors[0]).toEqual({ name: "timeout", count: 2 });
  });

  test("calculates day-of-week distribution", () => {
    // 2025-10-01 is a Wednesday
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" }),
      makeEvent({ timestamp: "2025-10-01T11:00:00.000Z" }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.timeDistribution.byDayOfWeek["Wed"]).toBe(2);
  });

  test("calculates hourly distribution", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T08:00:00.000Z" }),
      makeEvent({ timestamp: "2025-10-01T08:30:00.000Z" }),
      makeEvent({ timestamp: "2025-10-01T14:00:00.000Z" }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.timeDistribution.byHour["08"]).toBe(2);
    expect(summary.timeDistribution.byHour["14"]).toBe(1);
  });

  test("calculates session statistics", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z", sessionId: "s1" }),
      makeEvent({ timestamp: "2025-10-01T11:00:00.000Z", sessionId: "s1" }),
      makeEvent({ timestamp: "2025-10-01T12:00:00.000Z", sessionId: "s1" }),
      makeEvent({ timestamp: "2025-10-02T10:00:00.000Z", sessionId: "s2" }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.sessionStats.totalSessions).toBe(2);
    expect(summary.sessionStats.avgEventsPerSession).toBe(2);
    expect(summary.sessionStats.longestSession.sessionId).toBe("s1");
    expect(summary.sessionStats.longestSession.eventCount).toBe(3);
  });

  test("detects zero-activity days", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" }),
      makeEvent({ timestamp: "2025-10-03T10:00:00.000Z" }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.anomalies.zeroDays).toContain("2025-10-02");
    expect(summary.anomalies.zeroDays).not.toContain("2025-10-01");
  });

  test("detects high-count anomaly days", () => {
    // Create 30 events on day 1, 1 event on each other day (2-10)
    const events: SystemEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(makeEvent({ timestamp: `2025-10-01T${String(i % 24).padStart(2, "0")}:00:00.000Z` }));
    }
    for (let d = 2; d <= 10; d++) {
      events.push(makeEvent({ timestamp: `2025-10-${String(d).padStart(2, "0")}T10:00:00.000Z` }));
    }
    const summary = generatePeriodSummary("2025-10", events);
    const highDates = summary.anomalies.highCountDays.map((h) => h.date);
    expect(highDates).toContain("2025-10-01");
  });

  test("handles empty event array", () => {
    const summary = generatePeriodSummary("2025-10", []);
    expect(summary.eventCount).toBe(0);
    expect(summary.sessionStats.totalSessions).toBe(0);
    expect(summary.anomalies.zeroDays.length).toBe(31); // October has 31 days
  });

  test("handles single event", () => {
    const events = [makeEvent({ timestamp: "2025-10-15T10:00:00.000Z" })];
    const summary = generatePeriodSummary("2025-10", events);
    expect(summary.eventCount).toBe(1);
    expect(summary.sessionStats.totalSessions).toBe(1);
  });

  test("validates against periodSummarySchema", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" }),
    ];
    const summary = generatePeriodSummary("2025-10", events);
    const parsed = periodSummarySchema.safeParse(summary);
    expect(parsed.success).toBe(true);
  });
});

// =============================================================================
// formatCompactionMessage (T-9.3)
// =============================================================================

describe("formatCompactionMessage", () => {
  test("returns null when periodsProcessed is 0", () => {
    const result = formatCompactionMessage({
      ok: true, periodsProcessed: 0, periodsSkipped: 0,
      eventsArchived: 0, summariesCreated: 0, warnings: [],
    });
    expect(result).toBeNull();
  });

  test("formats single period message", () => {
    const result = formatCompactionMessage({
      ok: true, periodsProcessed: 1, periodsSkipped: 0,
      eventsArchived: 142, summariesCreated: 1, warnings: [],
    });
    expect(result).toContain("142 events");
    expect(result).toContain("1 period");
  });

  test("formats multiple period message", () => {
    const result = formatCompactionMessage({
      ok: true, periodsProcessed: 3, periodsSkipped: 0,
      eventsArchived: 500, summariesCreated: 3, warnings: [],
    });
    expect(result).toContain("500 events");
    expect(result).toContain("3 periods");
  });

  test("formats error message", () => {
    const result = formatCompactionMessage({
      ok: false, error: "disk full",
    });
    expect(result).toBe("Compaction warning: disk full");
  });
});

// =============================================================================
// resolveArchiveDir (T-9.1)
// =============================================================================

describe("resolveArchiveDir", () => {
  test("returns default ~/.pai/archive/ path", () => {
    const result = resolveArchiveDir();
    expect(result).toContain(".pai");
    expect(result).toContain("archive");
  });

  test("returns resolved custom path", () => {
    const result = resolveArchiveDir("/custom/archive");
    expect(result).toBe("/custom/archive");
  });
});

// =============================================================================
// initEventIndex (T-9.4)
// =============================================================================

describe("initEventIndex", () => {
  test("creates database with correct schema", () => {
    const db = initEventIndex(eventsDir);
    // Verify tables exist
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("summaries");
    expect(tableNames).toContain("meta");
    db.close();
  });

  test("is idempotent — open twice without error", () => {
    const db1 = initEventIndex(eventsDir);
    db1.close();
    const db2 = initEventIndex(eventsDir);
    const tables = db2.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(3);
    db2.close();
  });

  test("stores schema version", () => {
    const db = initEventIndex(eventsDir);
    const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("1");
    db.close();
  });
});

// =============================================================================
// SQLite CRUD (T-9.5)
// =============================================================================

describe("SQLite CRUD", () => {
  let db: Database;

  beforeEach(() => {
    db = initEventIndex(eventsDir);
  });

  afterEach(() => {
    db.close();
  });

  test("indexEvent inserts event row", () => {
    const event = makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" });
    indexEvent(db, event);
    const row = db.query("SELECT * FROM events WHERE id = ?").get(event.id) as { id: string; type: string };
    expect(row.id).toBe(event.id);
    expect(row.type).toBe("session_start");
  });

  test("indexEvents batch inserts within transaction", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" }),
      makeEvent({ timestamp: "2025-10-01T11:00:00.000Z" }),
      makeEvent({ timestamp: "2025-10-01T12:00:00.000Z" }),
    ];
    indexEvents(db, events);
    const count = db.query("SELECT COUNT(*) as c FROM events").get() as { c: number };
    expect(count.c).toBe(3);
  });

  test("removeIndexEntries deletes by period", () => {
    const events = [
      makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" }),
      makeEvent({ timestamp: "2025-10-15T10:00:00.000Z" }),
      makeEvent({ timestamp: "2025-11-01T10:00:00.000Z" }),
    ];
    indexEvents(db, events);
    const deleted = removeIndexEntries(db, "2025-10");
    expect(deleted).toBe(2);
    const remaining = db.query("SELECT COUNT(*) as c FROM events").get() as { c: number };
    expect(remaining.c).toBe(1);
  });

  test("insertSummary stores summary with JSON data", () => {
    const events = [makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" })];
    const summary = generatePeriodSummary("2025-10", events);
    insertSummary(db, summary);
    const row = db.query("SELECT * FROM summaries WHERE period = '2025-10'").get() as { event_count: number };
    expect(row.event_count).toBe(1);
  });

  test("querySummaries retrieves and parses summaries", () => {
    const events = [makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" })];
    const summary = generatePeriodSummary("2025-10", events);
    insertSummary(db, summary);
    const results = querySummaries(db, "2025-10");
    expect(results.length).toBe(1);
    expect(results[0].period).toBe("2025-10");
    expect(results[0].eventCount).toBe(1);
  });

  test("querySummaries returns all when no period filter", () => {
    const s1 = generatePeriodSummary("2025-10", [makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" })]);
    const s2 = generatePeriodSummary("2025-11", [makeEvent({ timestamp: "2025-11-01T10:00:00.000Z" })]);
    insertSummary(db, s1);
    insertSummary(db, s2);
    const results = querySummaries(db);
    expect(results.length).toBe(2);
  });
});

// =============================================================================
// rebuildIndex (T-9.6)
// =============================================================================

describe("rebuildIndex", () => {
  test("rebuilds index matching JSONL content", async () => {
    await seedEvents(eventsDir, ["2025-10"], 2);

    await rebuildIndex(eventsDir);

    const db = new Database(join(eventsDir, "index.db"));
    const count = db.query("SELECT COUNT(*) as c FROM events").get() as { c: number };
    // October has 31 days × 2 events = 62
    expect(count.c).toBe(62);
    db.close();
  });

  test("handles empty events directory", async () => {
    await rebuildIndex(eventsDir);
    const db = new Database(join(eventsDir, "index.db"));
    const count = db.query("SELECT COUNT(*) as c FROM events").get() as { c: number };
    expect(count.c).toBe(0);
    db.close();
  });
});

// =============================================================================
// findEligiblePeriods (T-9.7)
// =============================================================================

describe("findEligiblePeriods", () => {
  test("identifies months fully past cutoff", async () => {
    await seedEvents(eventsDir, ["2025-08", "2025-09"], 1);
    // Cutoff: 2025-10-01 means anything before Oct 1 is eligible
    const cutoff = new Date("2025-10-01T00:00:00.000Z");
    const eligible = await findEligiblePeriods(eventsDir, cutoff);
    expect(eligible).toEqual(["2025-08", "2025-09"]);
  });

  test("excludes months with recent events", async () => {
    await seedEvents(eventsDir, ["2025-08", "2025-10"], 1);
    const cutoff = new Date("2025-10-01T00:00:00.000Z");
    const eligible = await findEligiblePeriods(eventsDir, cutoff);
    expect(eligible).toEqual(["2025-08"]);
    expect(eligible).not.toContain("2025-10");
  });

  test("returns empty for all-recent events", async () => {
    await seedEvents(eventsDir, ["2025-10"], 1);
    const cutoff = new Date("2025-10-01T00:00:00.000Z");
    const eligible = await findEligiblePeriods(eventsDir, cutoff);
    expect(eligible).toEqual([]);
  });

  test("handles empty directory", async () => {
    const eligible = await findEligiblePeriods(eventsDir, new Date());
    expect(eligible).toEqual([]);
  });

  test("handles missing directory", async () => {
    const eligible = await findEligiblePeriods(join(tempDir, "nonexistent"), new Date());
    expect(eligible).toEqual([]);
  });
});

// =============================================================================
// isAlreadyArchived + archivePeriod (T-9.8)
// =============================================================================

describe("archivePeriod", () => {
  test("copies JSONL files to archive/YYYY/", async () => {
    await seedEvents(eventsDir, ["2025-10"], 1);
    const events = [makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" })];
    const summary = generatePeriodSummary("2025-10", events);

    const files = (await readdir(eventsDir)).filter((f) => f.startsWith("events-2025-10"));
    const result = await archivePeriod("2025-10", files, eventsDir, archiveDir, summary);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filesArchived).toBe(files.length);
    }
    const archivedFiles = await readdir(join(archiveDir, "2025"));
    expect(archivedFiles.length).toBeGreaterThan(0);
  });

  test("writes summary JSON to archive/YYYY/", async () => {
    const events = [makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" })];
    await appendEvent(events[0], eventsDir);
    const summary = generatePeriodSummary("2025-10", events);

    await archivePeriod("2025-10", ["events-2025-10-01.jsonl"], eventsDir, archiveDir, summary);

    const summaryContent = await readFile(join(archiveDir, "2025", "summary-2025-10.json"), "utf-8");
    const parsed = JSON.parse(summaryContent);
    expect(parsed.period).toBe("2025-10");
  });

  test("preserves original file contents", async () => {
    const event = makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" });
    await appendEvent(event, eventsDir);

    const originalContent = await readFile(join(eventsDir, "events-2025-10-01.jsonl"), "utf-8");
    const summary = generatePeriodSummary("2025-10", [event]);
    await archivePeriod("2025-10", ["events-2025-10-01.jsonl"], eventsDir, archiveDir, summary);

    const archivedContent = await readFile(join(archiveDir, "2025", "events-2025-10-01.jsonl"), "utf-8");
    expect(archivedContent).toBe(originalContent);
  });

  test("skips already-archived files", async () => {
    const event = makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" });
    await appendEvent(event, eventsDir);
    const summary = generatePeriodSummary("2025-10", [event]);

    // Archive twice
    await archivePeriod("2025-10", ["events-2025-10-01.jsonl"], eventsDir, archiveDir, summary);
    const result = await archivePeriod("2025-10", ["events-2025-10-01.jsonl"], eventsDir, archiveDir, summary);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // File already existed, so 0 new files archived
      expect(result.filesArchived).toBe(0);
    }
  });
});

describe("isAlreadyArchived", () => {
  test("returns true when summary file exists", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(archiveDir, "2025"), { recursive: true });
    await writeFile(join(archiveDir, "2025", "summary-2025-10.json"), "{}");
    expect(await isAlreadyArchived(archiveDir, "2025-10")).toBe(true);
  });

  test("returns false when no summary file", async () => {
    expect(await isAlreadyArchived(archiveDir, "2025-10")).toBe(false);
  });
});

// =============================================================================
// removeSourceFiles (T-9.9)
// =============================================================================

describe("removeSourceFiles", () => {
  test("removes listed files", async () => {
    const event = makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" });
    await appendEvent(event, eventsDir);

    const result = await removeSourceFiles(eventsDir, ["events-2025-10-01.jsonl"]);
    expect(result.removed).toBe(1);
    expect(result.warnings).toHaveLength(0);

    const files = await readdir(eventsDir);
    expect(files).not.toContain("events-2025-10-01.jsonl");
  });

  test("counts successfully removed files", async () => {
    await appendEvent(makeEvent({ timestamp: "2025-10-01T10:00:00.000Z" }), eventsDir);
    await appendEvent(makeEvent({ timestamp: "2025-10-02T10:00:00.000Z" }), eventsDir);

    const result = await removeSourceFiles(eventsDir, [
      "events-2025-10-01.jsonl",
      "events-2025-10-02.jsonl",
    ]);
    expect(result.removed).toBe(2);
  });

  test("adds warning for files that cannot be removed", async () => {
    const result = await removeSourceFiles(eventsDir, ["nonexistent.jsonl"]);
    expect(result.removed).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("nonexistent.jsonl");
  });
});

// =============================================================================
// compactEvents — Integration (T-9.10)
// =============================================================================

describe("compactEvents", () => {
  test("compacts eligible periods end-to-end", async () => {
    await seedEvents(eventsDir, ["2025-08"], 2);

    const result = await compactEvents({
      eventsDir,
      archiveDir,
      cutoffDays: 0, // Everything is eligible
      maxPeriodsPerRun: 10,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(1);
      expect(result.eventsArchived).toBe(62); // 31 days × 2
      expect(result.summariesCreated).toBe(1);
    }

    // Verify archive exists
    const archiveFiles = await readdir(join(archiveDir, "2025"));
    expect(archiveFiles).toContain("summary-2025-08.json");

    // Verify source files removed
    const eventFiles = (await readdir(eventsDir)).filter((f) => f.startsWith("events-2025-08"));
    expect(eventFiles).toHaveLength(0);
  });

  test("skips already-archived periods", async () => {
    await seedEvents(eventsDir, ["2025-08"], 1);

    // First run
    await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });

    // Re-seed (simulating source files returning — unusual but tests idempotency check)
    // Actually, source files are gone. Second run should find nothing eligible.
    const result = await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(0);
    }
  });

  test("respects maxPeriodsPerRun limit", async () => {
    await seedEvents(eventsDir, ["2025-07", "2025-08", "2025-09"], 1);

    const result = await compactEvents({
      eventsDir,
      archiveDir,
      cutoffDays: 0,
      maxPeriodsPerRun: 2,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(2);
    }
  });

  test("returns correct CompactionResult counts", async () => {
    await seedEvents(eventsDir, ["2025-08"], 1);

    const result = await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(1);
      expect(result.periodsSkipped).toBe(0);
      expect(result.eventsArchived).toBe(31);
      expect(result.summariesCreated).toBe(1);
      expect(result.warnings).toHaveLength(0);
    }
  });

  test("is idempotent — run 3x, same final state", async () => {
    await seedEvents(eventsDir, ["2025-08"], 1);

    await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });
    await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });
    const result = await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(0); // Nothing left to do
    }

    // Archive still has exactly one summary
    const archiveFiles = await readdir(join(archiveDir, "2025"));
    const summaries = archiveFiles.filter((f) => f.startsWith("summary-"));
    expect(summaries).toHaveLength(1);
  });

  test("leaves active window untouched", async () => {
    // Seed old + recent events
    await seedEvents(eventsDir, ["2025-08"], 1); // old
    await appendEvent(
      makeEvent({ timestamp: new Date().toISOString() }),
      eventsDir,
    ); // recent

    const filesBefore = (await readdir(eventsDir)).filter((f) => f.endsWith(".jsonl"));
    const recentFiles = filesBefore.filter((f) => !f.startsWith("events-2025-08"));

    await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });

    const filesAfter = (await readdir(eventsDir)).filter((f) => f.endsWith(".jsonl"));
    // Recent files should still be there
    for (const f of recentFiles) {
      expect(filesAfter).toContain(f);
    }
  });

  test("handles empty events directory", async () => {
    const result = await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(0);
    }
  });

  test("handles no eligible periods", async () => {
    // Seed only today's events — not old enough
    await appendEvent(
      makeEvent({ timestamp: new Date().toISOString() }),
      eventsDir,
    );

    const result = await compactEvents({ eventsDir, archiveDir, cutoffDays: 90 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.periodsProcessed).toBe(0);
    }
  });

  test("SQLite index updated after compaction", async () => {
    await seedEvents(eventsDir, ["2025-08"], 1);

    // Build index before compaction
    await rebuildIndex(eventsDir);

    await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });

    const db = new Database(join(eventsDir, "index.db"));
    // Old events should be removed from index
    const eventCount = db.query("SELECT COUNT(*) as c FROM events WHERE timestamp LIKE '2025-08%'").get() as { c: number };
    expect(eventCount.c).toBe(0);

    // Summary should be inserted
    const summaryCount = db.query("SELECT COUNT(*) as c FROM summaries WHERE period = '2025-08'").get() as { c: number };
    expect(summaryCount.c).toBe(1);

    db.close();
  });
});

// =============================================================================
// Performance
// =============================================================================

describe("Performance", () => {
  test("compacting 500 events completes in < 5s", async () => {
    // ~16 events/day × 31 days ≈ 500 events
    await seedEvents(eventsDir, ["2025-08"], 16);

    const start = performance.now();
    const result = await compactEvents({ eventsDir, archiveDir, cutoffDays: 0 });
    const elapsed = performance.now() - start;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.eventsArchived).toBeGreaterThanOrEqual(400);
    }
    expect(elapsed).toBeLessThan(5000);
  });
});
