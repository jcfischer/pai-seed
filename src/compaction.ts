import { z } from "zod";
import { nanoid } from "nanoid";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  mkdir,
  readdir,
  writeFile,
  copyFile,
  rename,
  rm,
  access,
} from "node:fs/promises";
import { Database } from "bun:sqlite";
import { type SystemEvent, systemEventSchema, readEvents, resolveEventsDir } from "./events";

// =============================================================================
// T-9.1: Schemas
// =============================================================================

export const timeDistributionSchema = z.object({
  byDayOfWeek: z.record(z.number()),
  byHour: z.record(z.number()),
});

export const sessionStatsSchema = z.object({
  totalSessions: z.number(),
  avgEventsPerSession: z.number(),
  longestSession: z.object({
    sessionId: z.string(),
    eventCount: z.number(),
  }),
});

export const anomalySchema = z.object({
  zeroDays: z.array(z.string()),
  highCountDays: z.array(
    z.object({
      date: z.string(),
      count: z.number(),
    }),
  ),
});

export const periodSummarySchema = z.object({
  id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  createdAt: z.string().datetime(),
  eventCount: z.number(),
  eventCounts: z.record(z.number()),
  topPatterns: z.object({
    skills: z.array(z.object({ name: z.string(), count: z.number() })),
    errors: z.array(z.object({ name: z.string(), count: z.number() })),
  }),
  timeDistribution: timeDistributionSchema,
  sessionStats: sessionStatsSchema,
  anomalies: anomalySchema,
  sourceFiles: z.array(z.string()),
});

// =============================================================================
// T-9.1: Types
// =============================================================================

export type TimeDistribution = z.infer<typeof timeDistributionSchema>;
export type SessionStats = z.infer<typeof sessionStatsSchema>;
export type Anomaly = z.infer<typeof anomalySchema>;
export type PeriodSummary = z.infer<typeof periodSummarySchema>;

export type CompactionResult =
  | {
      ok: true;
      periodsProcessed: number;
      periodsSkipped: number;
      eventsArchived: number;
      summariesCreated: number;
      warnings: string[];
    }
  | { ok: false; error: string };

export type CompactionOptions = {
  eventsDir?: string;
  archiveDir?: string;
  cutoffDays?: number;
  maxPeriodsPerRun?: number;
};

type ArchiveResult =
  | { ok: true; filesArchived: number }
  | { ok: false; error: string };

// =============================================================================
// T-9.1: resolveArchiveDir - Pure function
// =============================================================================

export function resolveArchiveDir(archiveDir?: string): string {
  if (archiveDir) return resolve(archiveDir);
  return join(homedir(), ".pai", "archive");
}

// =============================================================================
// T-9.2: generatePeriodSummary - Pure function
// =============================================================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function daysInMonth(period: string): string[] {
  const [yearStr, monthStr] = period.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
  const days: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    days.push(`${yearStr}-${monthStr}-${String(d).padStart(2, "0")}`);
  }
  return days;
}

function topN(
  entries: Map<string, number>,
  n: number,
): { name: string; count: number }[] {
  return [...entries.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

export function generatePeriodSummary(
  period: string,
  events: SystemEvent[],
): PeriodSummary {
  // Event counts by type
  const eventCounts: Record<string, number> = {};
  for (const e of events) {
    eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
  }

  // Top skill patterns
  const skillCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === "skill_invoked" && typeof e.data.skill === "string") {
      skillCounts.set(e.data.skill, (skillCounts.get(e.data.skill) ?? 0) + 1);
    }
  }

  // Top error patterns
  const errorCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === "error" && typeof e.data.error === "string") {
      errorCounts.set(e.data.error, (errorCounts.get(e.data.error) ?? 0) + 1);
    }
  }

  // Time distribution: by day of week
  const byDayOfWeek: Record<string, number> = {};
  const byHour: Record<string, number> = {};
  for (const e of events) {
    const d = new Date(e.timestamp);
    const dayName = DAY_NAMES[d.getUTCDay()];
    byDayOfWeek[dayName] = (byDayOfWeek[dayName] ?? 0) + 1;
    const hour = String(d.getUTCHours()).padStart(2, "0");
    byHour[hour] = (byHour[hour] ?? 0) + 1;
  }

  // Session stats
  const sessionMap = new Map<string, number>();
  for (const e of events) {
    sessionMap.set(e.sessionId, (sessionMap.get(e.sessionId) ?? 0) + 1);
  }
  const totalSessions = sessionMap.size;
  const avgEventsPerSession =
    totalSessions > 0 ? Math.round((events.length / totalSessions) * 100) / 100 : 0;

  let longestSessionId = "";
  let longestCount = 0;
  for (const [sid, count] of sessionMap) {
    if (count > longestCount) {
      longestSessionId = sid;
      longestCount = count;
    }
  }

  // Anomaly detection: zero days and high-count days
  const allDays = daysInMonth(period);
  const dailyCounts = new Map<string, number>();
  for (const day of allDays) {
    dailyCounts.set(day, 0);
  }
  for (const e of events) {
    const day = e.timestamp.slice(0, 10);
    if (dailyCounts.has(day)) {
      dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
    }
  }

  const zeroDays: string[] = [];
  const counts: number[] = [];
  for (const [day, count] of dailyCounts) {
    if (count === 0) zeroDays.push(day);
    counts.push(count);
  }

  const highCountDays: { date: string; count: number }[] = [];
  if (counts.length > 0) {
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance =
      counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
    const stddev = Math.sqrt(variance);
    const threshold = mean + 2 * stddev;

    if (stddev > 0) {
      for (const [day, count] of dailyCounts) {
        if (count > threshold) {
          highCountDays.push({ date: day, count });
        }
      }
    }
  }

  // Source files
  const sourceFileSet = new Set<string>();
  for (const e of events) {
    sourceFileSet.add(`events-${e.timestamp.slice(0, 10)}.jsonl`);
  }

  return {
    id: nanoid(),
    period,
    createdAt: new Date().toISOString(),
    eventCount: events.length,
    eventCounts,
    topPatterns: {
      skills: topN(skillCounts, 10),
      errors: topN(errorCounts, 10),
    },
    timeDistribution: { byDayOfWeek, byHour },
    sessionStats: {
      totalSessions,
      avgEventsPerSession,
      longestSession: {
        sessionId: longestSessionId || "none",
        eventCount: longestCount,
      },
    },
    anomalies: { zeroDays, highCountDays },
    sourceFiles: [...sourceFileSet].sort(),
  };
}

// =============================================================================
// T-9.3: formatCompactionMessage - Pure function
// =============================================================================

export function formatCompactionMessage(
  result: CompactionResult,
): string | null {
  if (!result.ok) {
    return `Compaction warning: ${result.error}`;
  }
  if (result.periodsProcessed === 0) {
    return null;
  }
  // We need period info — derive from warnings or just use counts
  return `Compacted ${result.eventsArchived} events (${result.periodsProcessed} period${result.periodsProcessed > 1 ? "s" : ""}) → archive`;
}

// =============================================================================
// T-9.4: initEventIndex - SQLite
// =============================================================================

const INDEX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

  CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    event_count INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_summaries_period ON summaries(period);

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export function initEventIndex(eventsDir: string): Database {
  const dbPath = join(eventsDir, "index.db");
  let db: Database;
  try {
    db = new Database(dbPath);
  } catch {
    // Corrupt — delete and retry
    try {
      const fs = require("node:fs");
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
    db = new Database(dbPath);
  }

  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");
  for (const stmt of INDEX_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    db.run(stmt);
  }
  db.run("INSERT OR IGNORE INTO meta VALUES ('schema_version', '1')");

  return db;
}

// =============================================================================
// T-9.5: SQLite CRUD operations
// =============================================================================

export function indexEvent(db: Database, event: SystemEvent): void {
  db.run(
    "INSERT OR IGNORE INTO events (id, timestamp, session_id, type) VALUES (?, ?, ?, ?)",
    [event.id, event.timestamp, event.sessionId, event.type],
  );
}

export function indexEvents(db: Database, events: SystemEvent[]): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO events (id, timestamp, session_id, type) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const event of events) {
      insert.run(event.id, event.timestamp, event.sessionId, event.type);
    }
  });
  tx();
}

export function removeIndexEntries(db: Database, period: string): number {
  const result = db.run(
    "DELETE FROM events WHERE timestamp LIKE ?",
    [`${period}%`],
  );
  return result.changes;
}

export function insertSummary(db: Database, summary: PeriodSummary): void {
  db.run(
    "INSERT OR REPLACE INTO summaries (id, period, created_at, event_count, data) VALUES (?, ?, ?, ?, ?)",
    [
      summary.id,
      summary.period,
      summary.createdAt,
      summary.eventCount,
      JSON.stringify(summary),
    ],
  );
}

export function querySummaries(
  db: Database,
  period?: string,
): PeriodSummary[] {
  let rows: { data: string }[];
  if (period) {
    rows = db.query("SELECT data FROM summaries WHERE period = ?").all(period) as { data: string }[];
  } else {
    rows = db.query("SELECT data FROM summaries ORDER BY period").all() as { data: string }[];
  }

  const summaries: PeriodSummary[] = [];
  for (const row of rows) {
    try {
      const parsed = periodSummarySchema.safeParse(JSON.parse(row.data));
      if (parsed.success) {
        summaries.push(parsed.data);
      }
    } catch {
      continue;
    }
  }
  return summaries;
}

// =============================================================================
// T-9.6: rebuildIndex
// =============================================================================

const JSONL_FILE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export async function rebuildIndex(eventsDir: string): Promise<void> {
  const dbPath = join(eventsDir, "index.db");
  try {
    await rm(dbPath, { force: true });
  } catch {
    // ignore
  }

  const db = initEventIndex(eventsDir);

  let fileNames: string[];
  try {
    fileNames = await readdir(eventsDir);
  } catch {
    db.close();
    return;
  }

  const eventFiles = fileNames.filter((f) => JSONL_FILE_PATTERN.test(f)).sort();

  const insert = db.prepare(
    "INSERT OR IGNORE INTO events (id, timestamp, session_id, type) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const fileName of eventFiles) {
      // Read synchronously inside transaction for performance
      const fs = require("node:fs");
      let content: string;
      try {
        content = fs.readFileSync(join(eventsDir, fileName), "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n").filter((l: string) => l.trim() !== "");
      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          const parsed = systemEventSchema.safeParse(raw);
          if (parsed.success) {
            const e = parsed.data;
            insert.run(e.id, e.timestamp, e.sessionId, e.type);
          }
        } catch {
          continue;
        }
      }
    }
  });
  tx();

  db.close();
}

// =============================================================================
// T-9.7: findEligiblePeriods
// =============================================================================

export async function findEligiblePeriods(
  eventsDir: string,
  cutoffDate: Date,
): Promise<string[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(eventsDir);
  } catch {
    return [];
  }

  // Group files by YYYY-MM period, track latest date per period
  const periodLatest = new Map<string, string>();
  for (const name of fileNames) {
    const match = name.match(JSONL_FILE_PATTERN);
    if (!match) continue;
    const date = match[1]; // YYYY-MM-DD
    const period = date.slice(0, 7); // YYYY-MM
    const current = periodLatest.get(period);
    if (!current || date > current) {
      periodLatest.set(period, date);
    }
  }

  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const eligible: string[] = [];
  for (const [period, latestDate] of periodLatest) {
    if (latestDate < cutoffStr) {
      eligible.push(period);
    }
  }

  return eligible.sort();
}

// =============================================================================
// T-9.8: archivePeriod + isAlreadyArchived
// =============================================================================

export async function isAlreadyArchived(
  archiveDir: string,
  period: string,
): Promise<boolean> {
  const year = period.slice(0, 4);
  const summaryPath = join(archiveDir, year, `summary-${period}.json`);
  try {
    await access(summaryPath);
    return true;
  } catch {
    return false;
  }
}

export async function archivePeriod(
  period: string,
  sourceFiles: string[],
  eventsDir: string,
  archiveDir: string,
  summary: PeriodSummary,
): Promise<ArchiveResult> {
  const year = period.slice(0, 4);
  const archiveYearDir = join(archiveDir, year);

  try {
    await mkdir(archiveYearDir, { recursive: true });

    let filesArchived = 0;
    for (const fileName of sourceFiles) {
      const src = join(eventsDir, fileName);
      const dest = join(archiveYearDir, fileName);
      try {
        await access(dest);
        // Already exists — skip
      } catch {
        await copyFile(src, dest);
        filesArchived++;
      }
    }

    // Write summary atomically: tmp + rename
    const summaryPath = join(archiveYearDir, `summary-${period}.json`);
    const tmpPath = summaryPath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(summary, null, 2));
    await rename(tmpPath, summaryPath);

    return { ok: true, filesArchived };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// =============================================================================
// T-9.9: removeSourceFiles
// =============================================================================

export async function removeSourceFiles(
  eventsDir: string,
  filenames: string[],
): Promise<{ removed: number; warnings: string[] }> {
  let removed = 0;
  const warnings: string[] = [];

  for (const filename of filenames) {
    try {
      await rm(join(eventsDir, filename));
      removed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not remove ${filename}: ${message}`);
    }
  }

  return { removed, warnings };
}

// =============================================================================
// T-9.10: compactEvents - Orchestrator
// =============================================================================

export async function compactEvents(
  options?: CompactionOptions,
): Promise<CompactionResult> {
  try {
    const eventsDir = resolveEventsDir(options?.eventsDir);
    const archiveDir = resolveArchiveDir(options?.archiveDir);
    const cutoffDays = options?.cutoffDays ?? 90;
    const maxPeriodsPerRun = options?.maxPeriodsPerRun ?? 3;

    const cutoffDate = new Date(Date.now() - cutoffDays * 86_400_000);

    const eligible = await findEligiblePeriods(eventsDir, cutoffDate);
    if (eligible.length === 0) {
      return {
        ok: true,
        periodsProcessed: 0,
        periodsSkipped: 0,
        eventsArchived: 0,
        summariesCreated: 0,
        warnings: [],
      };
    }

    let db: Database;
    try {
      db = initEventIndex(eventsDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `SQLite init failed: ${message}` };
    }

    let periodsProcessed = 0;
    let periodsSkipped = 0;
    let eventsArchived = 0;
    let summariesCreated = 0;
    const warnings: string[] = [];

    try {
      for (const period of eligible.slice(0, maxPeriodsPerRun)) {
        // Check if already archived
        if (await isAlreadyArchived(archiveDir, period)) {
          periodsSkipped++;
          continue;
        }

        try {
          // Read events for this period
          const [yearStr, monthStr] = period.split("-");
          const year = parseInt(yearStr, 10);
          const month = parseInt(monthStr, 10);
          const since = new Date(Date.UTC(year, month - 1, 1));
          const until = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

          const events = await readEvents({
            eventsDir,
            since,
            until,
          });

          if (events.length === 0) {
            periodsSkipped++;
            continue;
          }

          // Generate summary
          const summary = generatePeriodSummary(period, events);

          // Archive files
          const archiveResult = await archivePeriod(
            period,
            summary.sourceFiles,
            eventsDir,
            archiveDir,
            summary,
          );

          if (!archiveResult.ok) {
            warnings.push(`Archive failed for ${period}: ${archiveResult.error}`);
            continue;
          }

          // Update SQLite index
          removeIndexEntries(db, period);
          insertSummary(db, summary);

          // Remove source files
          const removeResult = await removeSourceFiles(
            eventsDir,
            summary.sourceFiles,
          );
          if (removeResult.warnings.length > 0) {
            warnings.push(...removeResult.warnings);
          }

          periodsProcessed++;
          eventsArchived += events.length;
          summariesCreated++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to compact ${period}: ${message}`);
        }
      }
    } finally {
      db.close();
    }

    return {
      ok: true,
      periodsProcessed,
      periodsSkipped,
      eventsArchived,
      summariesCreated,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
