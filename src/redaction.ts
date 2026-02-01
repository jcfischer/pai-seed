import { z } from "zod";
import { nanoid } from "nanoid";
import { readEvents, appendEvent, type SystemEvent } from "./events";

// =============================================================================
// T-16.1: Redaction Data Schema
// =============================================================================

export const redactionDataSchema = z.object({
  redactedEventId: z.string().min(1),
  reason: z.string().optional(),
});

export type RedactionData = z.infer<typeof redactionDataSchema>;

// =============================================================================
// T-16.1: Result Types
// =============================================================================

export type RedactResult =
  | { ok: true; redactionEventId: string; redactedEventId: string }
  | { ok: false; error: string };

export type RedactionOptions = {
  eventsDir?: string;
};

// =============================================================================
// T-16.2: getRedactedIds
// =============================================================================

export async function getRedactedIds(
  options?: RedactionOptions,
): Promise<Set<string>> {
  const events = await readEvents({
    eventsDir: options?.eventsDir,
    includeRedacted: true,
  });

  const redactedIds = new Set<string>();
  for (const event of events) {
    if (event.type === "redaction" && typeof event.data.redactedEventId === "string") {
      redactedIds.add(event.data.redactedEventId);
    }
  }

  return redactedIds;
}

// =============================================================================
// T-16.2: isRedacted
// =============================================================================

export async function isRedacted(
  eventId: string,
  options?: RedactionOptions,
): Promise<boolean> {
  const ids = await getRedactedIds(options);
  return ids.has(eventId);
}

// =============================================================================
// T-16.3: redactEvent
// =============================================================================

export async function redactEvent(
  eventId: string,
  reason?: string,
  options?: RedactionOptions,
): Promise<RedactResult> {
  // Read all events including redacted to validate
  const allEvents = await readEvents({
    eventsDir: options?.eventsDir,
    includeRedacted: true,
  });

  // Check if event exists
  const targetEvent = allEvents.find((e) => e.id === eventId);
  if (!targetEvent) {
    return { ok: false, error: `Event not found: ${eventId}` };
  }

  // Check if already redacted
  const alreadyRedacted = allEvents.some(
    (e) => e.type === "redaction" && e.data.redactedEventId === eventId,
  );
  if (alreadyRedacted) {
    return { ok: false, error: `Event already redacted: ${eventId}` };
  }

  // Create redaction marker event
  const redactionEvent: SystemEvent = {
    id: nanoid(),
    timestamp: new Date().toISOString(),
    sessionId: process.env.PAI_SESSION_ID ?? "system",
    type: "redaction",
    data: {
      redactedEventId: eventId,
      ...(reason ? { reason } : {}),
    },
  };

  const result = await appendEvent(redactionEvent, options?.eventsDir);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return {
    ok: true,
    redactionEventId: redactionEvent.id,
    redactedEventId: eventId,
  };
}
