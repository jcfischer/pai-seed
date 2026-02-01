import { z } from "zod";
import { loadSeed } from "./loader";
import { readEvents, type SystemEvent, type EventType } from "./events";
import type { Learning } from "./schema";

// =============================================================================
// T-12.1: ACR Document Schema
// =============================================================================

export const acrDocumentSchema = z.object({
  sourceId: z.string().min(1),
  content: z.string().min(1),
  source: z.string().min(1),
  lastUpdated: z.string().datetime(),
  metadata: z.record(z.unknown()),
});

export type AcrDocument = z.infer<typeof acrDocumentSchema>;

export type AcrExportOptions = {
  seedPath?: string;
  eventsDir?: string;
  eventWindowDays?: number;
};

export type AcrExportResult =
  | { ok: true; documents: AcrDocument[]; learningCount: number; eventSummaryCount: number }
  | { ok: false; error: string };

// =============================================================================
// T-12.2: exportLearnings
// =============================================================================

function learningToDocument(
  learning: Learning,
  type: "pattern" | "insight" | "self_knowledge",
): AcrDocument {
  const typeLabel =
    type === "self_knowledge"
      ? "Self-knowledge"
      : type.charAt(0).toUpperCase() + type.slice(1);

  return {
    sourceId: `seed:learning:${learning.id}`,
    content: `${typeLabel}: ${learning.content}`,
    source: "seed",
    lastUpdated: learning.confirmedAt ?? learning.extractedAt,
    metadata: {
      type,
      confirmed: learning.confirmed,
      extractedAt: learning.extractedAt,
      confirmedAt: learning.confirmedAt,
      tags: learning.tags,
      learningSource: learning.source,
    },
  };
}

export async function exportLearnings(
  options?: AcrExportOptions,
): Promise<AcrDocument[]> {
  const result = await loadSeed(options?.seedPath);
  if (!result.ok) return [];

  const { config } = result;
  const docs: AcrDocument[] = [];

  for (const p of config.learned.patterns) {
    docs.push(learningToDocument(p, "pattern"));
  }
  for (const i of config.learned.insights) {
    docs.push(learningToDocument(i, "insight"));
  }
  for (const s of config.learned.selfKnowledge) {
    docs.push(learningToDocument(s, "self_knowledge"));
  }

  return docs;
}

// =============================================================================
// T-12.3: exportEventSummaries
// =============================================================================

export async function exportEventSummaries(
  options?: AcrExportOptions,
): Promise<AcrDocument[]> {
  const windowDays = options?.eventWindowDays ?? 90;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  let events: SystemEvent[];
  try {
    events = await readEvents({ eventsDir: options?.eventsDir, since });
  } catch {
    return [];
  }

  if (events.length === 0) return [];

  // Group events by day
  const byDay = new Map<string, SystemEvent[]>();
  for (const event of events) {
    const day = event.timestamp.slice(0, 10); // "YYYY-MM-DD"
    const existing = byDay.get(day) ?? [];
    existing.push(event);
    byDay.set(day, existing);
  }

  const docs: AcrDocument[] = [];

  for (const [day, dayEvents] of byDay) {
    // Count by type
    const typeCounts = new Map<EventType, number>();
    for (const e of dayEvents) {
      typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
    }

    const countParts = Array.from(typeCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");

    const content = `Events on ${day}: ${dayEvents.length} total (${countParts})`;

    // Use latest event timestamp as lastUpdated
    const latestTimestamp = dayEvents
      .map((e) => e.timestamp)
      .sort()
      .pop()!;

    docs.push({
      sourceId: `seed:event:${day}`,
      content,
      source: "seed:events",
      lastUpdated: latestTimestamp,
      metadata: {
        date: day,
        totalEvents: dayEvents.length,
        typeCounts: Object.fromEntries(typeCounts),
      },
    });
  }

  // Sort by date descending
  docs.sort((a, b) => b.sourceId.localeCompare(a.sourceId));

  return docs;
}

// =============================================================================
// T-12.4: exportAllForACR
// =============================================================================

export async function exportAllForACR(
  options?: AcrExportOptions,
): Promise<AcrExportResult> {
  try {
    const [learnings, eventSummaries] = await Promise.all([
      exportLearnings(options),
      exportEventSummaries(options),
    ]);

    return {
      ok: true,
      documents: [...learnings, ...eventSummaries],
      learningCount: learnings.length,
      eventSummaryCount: eventSummaries.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
