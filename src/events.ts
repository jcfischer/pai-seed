import { z } from "zod";
import { nanoid } from "nanoid";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, readdir, appendFile, readFile } from "node:fs/promises";

// =============================================================================
// Schemas
// =============================================================================

export const eventTypeSchema = z.enum([
  "session_start",
  "session_end",
  "skill_invoked",
  "isc_verified",
  "learning_extracted",
  "proposal_accepted",
  "proposal_rejected",
  "error",
  "custom",
]);

export const systemEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  sessionId: z.string().min(1),
  type: eventTypeSchema,
  data: z.record(z.unknown()),
});

// =============================================================================
// Types
// =============================================================================

export type EventType = z.infer<typeof eventTypeSchema>;
export type SystemEvent = z.infer<typeof systemEventSchema>;

export type AppendResult =
  | { ok: true; eventId: string; file: string }
  | { ok: false; error: string };

export type ReadEventsOptions = {
  eventsDir?: string;
  type?: EventType;
  sessionId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
};

// =============================================================================
// resolveEventsDir - Pure function
// =============================================================================

export function resolveEventsDir(eventsDir?: string): string {
  if (eventsDir) return resolve(eventsDir);
  return join(homedir(), ".pai", "events");
}

// =============================================================================
// appendEvent - I/O
// =============================================================================

export async function appendEvent(
  event: SystemEvent,
  eventsDir?: string,
): Promise<AppendResult> {
  const parsed = systemEventSchema.safeParse(event);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  try {
    const dir = resolveEventsDir(eventsDir);
    await mkdir(dir, { recursive: true });

    const dateStr = event.timestamp.slice(0, 10);
    const filename = `events-${dateStr}.jsonl`;
    const filePath = join(dir, filename);

    const line = JSON.stringify(event) + "\n";
    await appendFile(filePath, line);

    return { ok: true, eventId: event.id, file: filename };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// =============================================================================
// readEvents - I/O
// =============================================================================

const JSONL_FILE_PATTERN = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export async function readEvents(
  options?: ReadEventsOptions,
): Promise<SystemEvent[]> {
  const dir = resolveEventsDir(options?.eventsDir);

  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    return [];
  }

  // Filter to valid event files and extract dates
  const eventFiles: { name: string; date: string }[] = [];
  for (const name of fileNames) {
    const match = name.match(JSONL_FILE_PATTERN);
    if (match) {
      eventFiles.push({ name, date: match[1] });
    }
  }

  // Filter files by date range (from filename)
  const sinceDate = options?.since
    ? options.since.toISOString().slice(0, 10)
    : undefined;
  const untilDate = options?.until
    ? options.until.toISOString().slice(0, 10)
    : undefined;

  const filteredFiles = eventFiles.filter((f) => {
    if (sinceDate && f.date < sinceDate) return false;
    if (untilDate && f.date > untilDate) return false;
    return true;
  });

  // Read and parse all matching files
  const allEvents: SystemEvent[] = [];

  for (const file of filteredFiles) {
    const filePath = join(dir, file.name);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n").filter((line) => line.trim() !== "");

    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const parsed = systemEventSchema.safeParse(raw);
        if (!parsed.success) continue;

        const event = parsed.data;

        // Apply filters
        if (options?.type && event.type !== options.type) continue;
        if (options?.sessionId && event.sessionId !== options.sessionId)
          continue;
        if (options?.since && event.timestamp < options.since.toISOString())
          continue;
        if (options?.until && event.timestamp > options.until.toISOString())
          continue;

        allEvents.push(event);
      } catch {
        // Skip malformed lines
        continue;
      }
    }
  }

  // Sort chronologically (ISO strings sort lexicographically)
  allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Apply limit
  if (options?.limit !== undefined) {
    return allEvents.slice(0, options.limit);
  }

  return allEvents;
}

// =============================================================================
// countEvents - I/O
// =============================================================================

export async function countEvents(
  options?: ReadEventsOptions,
): Promise<Record<string, number>> {
  const events = await readEvents(options);

  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }

  return counts;
}

// =============================================================================
// logEvent - I/O
// =============================================================================

export async function logEvent(
  type: EventType,
  data: Record<string, unknown>,
  sessionId?: string,
  eventsDir?: string,
): Promise<AppendResult> {
  try {
    const event: SystemEvent = {
      id: nanoid(),
      timestamp: new Date().toISOString(),
      sessionId: sessionId ?? process.env.PAI_SESSION_ID ?? "unknown",
      type,
      data,
    };

    return await appendEvent(event, eventsDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
