import { z } from "zod";
import { nanoid } from "nanoid";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, readFile, appendFile } from "node:fs/promises";

// =============================================================================
// F-026: Schemas
// =============================================================================

export const observationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["pattern", "insight", "self_knowledge"]),
  content: z.string().min(1),
  context: z.string().optional(),
  sessionId: z.string().min(1),
  observedAt: z.string().datetime(),
});

// =============================================================================
// F-026: Types
// =============================================================================

export type Observation = z.infer<typeof observationSchema>;

export type WriteObservationInput = {
  type: "pattern" | "insight" | "self_knowledge";
  content: string;
  context?: string;
  sessionId: string;
};

export type WriteObservationResult =
  | { ok: true; id: string; file: string }
  | { ok: false; error: string };

// =============================================================================
// F-026 FR-1: resolveObservationsDir
// =============================================================================

export function resolveObservationsDir(obsDir?: string): string {
  if (obsDir) return resolve(obsDir);
  return join(homedir(), ".pai", "observations");
}

// =============================================================================
// F-026 FR-1: writeObservation — Append to session buffer
// =============================================================================

/**
 * Write an observation to the session-scoped JSONL buffer.
 * Creates the directory and file if needed.
 * Never throws — returns error result.
 */
export async function writeObservation(
  input: WriteObservationInput,
  obsDir?: string,
): Promise<WriteObservationResult> {
  try {
    const id = `obs_${nanoid()}`;
    const observation: Observation = {
      id,
      type: input.type,
      content: input.content,
      ...(input.context ? { context: input.context } : {}),
      sessionId: input.sessionId,
      observedAt: new Date().toISOString(),
    };

    // Validate
    const parsed = observationSchema.safeParse(observation);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    const dir = resolveObservationsDir(obsDir);
    await mkdir(dir, { recursive: true });

    const filename = `${input.sessionId}.jsonl`;
    const filepath = join(dir, filename);

    await appendFile(filepath, JSON.stringify(observation) + "\n", "utf-8");

    return { ok: true, id, file: filepath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-026 FR-2: readObservations — Read session buffer
// =============================================================================

/**
 * Read all observations from a session's buffer file.
 * Returns empty array if file doesn't exist or is empty.
 * Skips malformed lines silently.
 */
export async function readObservations(
  sessionId: string,
  obsDir?: string,
): Promise<Observation[]> {
  try {
    const dir = resolveObservationsDir(obsDir);
    const filepath = join(dir, `${sessionId}.jsonl`);

    let content: string;
    try {
      content = await readFile(filepath, "utf-8");
    } catch {
      return []; // File doesn't exist
    }

    const observations: Observation[] = [];

    for (const line of content.trim().split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = observationSchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          observations.push(parsed.data);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return observations;
  } catch {
    return [];
  }
}
