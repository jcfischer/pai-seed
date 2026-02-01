import { z } from "zod";
import { nanoid } from "nanoid";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { loadSeed, writeSeed } from "./loader";
import { logEvent } from "./events";

// =============================================================================
// T-10.1: Schemas
// =============================================================================

export const iscCriterionSnapshotSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const checkpointStateSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  phase: z.string().min(1),
  phaseNumber: z.number().min(1).max(7),
  createdAt: z.string().datetime(),
  completed: z.boolean(),
  taskSummary: z.string(),
  iscCriteria: z.array(iscCriterionSnapshotSchema),
  metadata: z.record(z.unknown()),
});

// =============================================================================
// T-10.1: Types
// =============================================================================

export type IscCriterionSnapshot = z.infer<typeof iscCriterionSnapshotSchema>;
export type CheckpointState = z.infer<typeof checkpointStateSchema>;

export type CheckpointResult =
  | { ok: true; checkpointId: string; file: string }
  | { ok: false; error: string };

export type CheckpointOptions = {
  checkpointsDir?: string;
  seedPath?: string;
  eventsDir?: string;
};

export type ListCheckpointsFilter = {
  completed?: boolean;
};

// =============================================================================
// T-10.1: resolveCheckpointsDir - Pure function
// =============================================================================

export function resolveCheckpointsDir(dir?: string): string {
  if (dir) return resolve(dir);
  return join(homedir(), ".pai", "checkpoints");
}

// =============================================================================
// Internal helpers
// =============================================================================

const CKPT_FILE_PATTERN = /^ckpt-.*\.json$/;

function safeTimestamp(iso: string): string {
  return iso.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

function checkpointFilename(timestamp: string, phase: string): string {
  const safeTs = safeTimestamp(timestamp);
  const safePhase = phase.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return `ckpt-${safeTs}-${safePhase}.json`;
}

// =============================================================================
// T-10.2: createCheckpoint
// =============================================================================

export async function createCheckpoint(
  phase: string,
  phaseNumber: number,
  taskSummary: string,
  iscCriteria: IscCriterionSnapshot[],
  metadata: Record<string, unknown>,
  options?: CheckpointOptions,
): Promise<CheckpointResult> {
  try {
    const dir = resolveCheckpointsDir(options?.checkpointsDir);
    await mkdir(dir, { recursive: true });

    const id = nanoid();
    const createdAt = new Date().toISOString();

    const state: CheckpointState = {
      id,
      sessionId: process.env.PAI_SESSION_ID ?? "unknown",
      phase,
      phaseNumber,
      createdAt,
      completed: false,
      taskSummary,
      iscCriteria,
      metadata,
    };

    const filename = checkpointFilename(createdAt, phase);
    const filePath = join(dir, filename);
    const tmpPath = filePath + ".tmp";

    // Atomic write
    await writeFile(tmpPath, JSON.stringify(state, null, 2));
    await rename(tmpPath, filePath);

    // Update seed.json checkpointRef
    try {
      const seedResult = await loadSeed(options?.seedPath);
      if (seedResult.ok) {
        const updated = { ...seedResult.config };
        updated.state = { ...updated.state, checkpointRef: id };
        await writeSeed(updated, options?.seedPath);
      }
    } catch {
      // Non-fatal — seed update is best-effort
    }

    // Log event
    try {
      await logEvent(
        "custom",
        { action: "checkpoint_created", checkpointId: id, phase, phaseNumber },
        undefined,
        options?.eventsDir,
      );
    } catch {
      // Non-fatal
    }

    return { ok: true, checkpointId: id, file: filename };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// =============================================================================
// T-10.3: loadCheckpoint + listCheckpoints
// =============================================================================

export async function loadCheckpoint(
  checkpointId: string,
  options?: CheckpointOptions,
): Promise<CheckpointState | null> {
  const dir = resolveCheckpointsDir(options?.checkpointsDir);

  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    return null;
  }

  for (const name of fileNames) {
    if (!CKPT_FILE_PATTERN.test(name)) continue;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      const raw = JSON.parse(content);
      const parsed = checkpointStateSchema.safeParse(raw);
      if (parsed.success && parsed.data.id === checkpointId) {
        return parsed.data;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function listCheckpoints(
  filter?: ListCheckpointsFilter,
  options?: CheckpointOptions,
): Promise<CheckpointState[]> {
  const dir = resolveCheckpointsDir(options?.checkpointsDir);

  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    return [];
  }

  const checkpoints: CheckpointState[] = [];

  for (const name of fileNames) {
    if (!CKPT_FILE_PATTERN.test(name)) continue;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      const raw = JSON.parse(content);
      const parsed = checkpointStateSchema.safeParse(raw);
      if (!parsed.success) continue;

      const ckpt = parsed.data;
      if (filter?.completed !== undefined && ckpt.completed !== filter.completed) {
        continue;
      }
      checkpoints.push(ckpt);
    } catch {
      continue;
    }
  }

  // Sort by createdAt descending (most recent first)
  checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return checkpoints;
}

// =============================================================================
// T-10.4: detectIncompleteCheckpoint
// =============================================================================

export async function detectIncompleteCheckpoint(
  options?: CheckpointOptions,
): Promise<CheckpointState | null> {
  const incomplete = await listCheckpoints({ completed: false }, options);
  return incomplete.length > 0 ? incomplete[0] : null;
}

// =============================================================================
// T-10.5: completeCheckpoint
// =============================================================================

export async function completeCheckpoint(
  checkpointId: string,
  options?: CheckpointOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = resolveCheckpointsDir(options?.checkpointsDir);

    let fileNames: string[];
    try {
      fileNames = await readdir(dir);
    } catch {
      return { ok: false, error: "Checkpoints directory not found" };
    }

    // Find the file containing this checkpoint
    let targetFile: string | null = null;
    let checkpoint: CheckpointState | null = null;

    for (const name of fileNames) {
      if (!CKPT_FILE_PATTERN.test(name)) continue;
      try {
        const content = await readFile(join(dir, name), "utf-8");
        const raw = JSON.parse(content);
        const parsed = checkpointStateSchema.safeParse(raw);
        if (parsed.success && parsed.data.id === checkpointId) {
          targetFile = name;
          checkpoint = parsed.data;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!targetFile || !checkpoint) {
      return { ok: false, error: `Checkpoint ${checkpointId} not found` };
    }

    // Mark as completed
    const updated: CheckpointState = { ...checkpoint, completed: true };
    const filePath = join(dir, targetFile);
    const tmpPath = filePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(updated, null, 2));
    await rename(tmpPath, filePath);

    // Clear seed.json checkpointRef
    try {
      const seedResult = await loadSeed(options?.seedPath);
      if (seedResult.ok && seedResult.config.state.checkpointRef === checkpointId) {
        const updatedSeed = { ...seedResult.config };
        updatedSeed.state = { ...updatedSeed.state, checkpointRef: undefined };
        await writeSeed(updatedSeed, options?.seedPath);
      }
    } catch {
      // Non-fatal
    }

    // Log event
    try {
      await logEvent(
        "custom",
        { action: "checkpoint_completed", checkpointId },
        undefined,
        options?.eventsDir,
      );
    } catch {
      // Non-fatal
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// =============================================================================
// T-10.6: cleanupCheckpoints
// =============================================================================

export async function cleanupCheckpoints(
  olderThanDays: number = 30,
  options?: CheckpointOptions,
): Promise<{ deleted: number }> {
  const dir = resolveCheckpointsDir(options?.checkpointsDir);
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

  const all = await listCheckpoints(undefined, options);
  let deleted = 0;

  // Find files to delete
  let fileNames: string[];
  try {
    fileNames = await readdir(dir);
  } catch {
    return { deleted: 0 };
  }

  const oldIds = new Set(
    all.filter((c) => new Date(c.createdAt) < cutoff).map((c) => c.id),
  );

  for (const name of fileNames) {
    if (!CKPT_FILE_PATTERN.test(name)) continue;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      const raw = JSON.parse(content);
      const parsed = checkpointStateSchema.safeParse(raw);
      if (parsed.success && oldIds.has(parsed.data.id)) {
        await rm(join(dir, name));
        deleted++;
      }
    } catch {
      continue;
    }
  }

  // Clear stale checkpointRef
  if (deleted > 0) {
    try {
      const seedResult = await loadSeed(options?.seedPath);
      if (seedResult.ok && seedResult.config.state.checkpointRef) {
        if (oldIds.has(seedResult.config.state.checkpointRef)) {
          const updatedSeed = { ...seedResult.config };
          updatedSeed.state = { ...updatedSeed.state, checkpointRef: undefined };
          await writeSeed(updatedSeed, options?.seedPath);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return { deleted };
}
