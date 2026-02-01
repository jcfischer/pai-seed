import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, rename, readdir, unlink } from "node:fs/promises";
import { nanoid } from "nanoid";

// =============================================================================
// T-13.1: Schemas
// =============================================================================

export const keyMomentSchema = z.object({
  date: z.string().datetime(),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export type KeyMoment = z.infer<typeof keyMomentSchema>;

export const relationshipSchema = z.object({
  name: z.string().min(1),
  firstEncountered: z.string().datetime(),
  lastInteraction: z.string().datetime(),
  context: z.string(),
  keyMoments: z.array(keyMomentSchema),
});

export type Relationship = z.infer<typeof relationshipSchema>;

// =============================================================================
// T-13.1: Result Types
// =============================================================================

export type RelationshipResult =
  | { ok: true; relationship: Relationship }
  | { ok: false; error: string };

export type ListResult =
  | { ok: true; names: string[] }
  | { ok: false; error: string };

export type RelationshipWriteResult =
  | { ok: true }
  | { ok: false; error: string };

export type RelationshipOptions = {
  paiDir?: string;
};

// =============================================================================
// T-13.2: Path Resolution and Slugification
// =============================================================================

export function resolveRelationshipsDir(paiDir?: string): string {
  const dir = paiDir ?? join(homedir(), ".pai");
  return join(dir, "relationships");
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function relFilePath(name: string, options?: RelationshipOptions): string {
  const dir = resolveRelationshipsDir(options?.paiDir);
  return join(dir, `rel_${slugifyName(name)}.json`);
}

// =============================================================================
// T-13.3: Load and Save
// =============================================================================

export async function loadRelationship(
  name: string,
  options?: RelationshipOptions,
): Promise<RelationshipResult> {
  const filePath = relFilePath(name, options);

  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return { ok: false, error: `Relationship not found: ${name}` };
    }

    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `Invalid JSON in relationship file: ${name}` };
    }

    const result = relationshipSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: `Invalid relationship data: ${result.error.message}` };
    }

    return { ok: true, relationship: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveRelationship(
  relationship: Relationship,
  options?: RelationshipOptions,
): Promise<RelationshipWriteResult> {
  const filePath = relFilePath(relationship.name, options);
  const dir = resolveRelationshipsDir(options?.paiDir);

  try {
    await mkdir(dir, { recursive: true });
    const tmpPath = filePath + `.tmp-${nanoid(6)}`;
    await Bun.write(tmpPath, JSON.stringify(relationship, null, 2) + "\n");
    await rename(tmpPath, filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// T-13.4: Add and Remove
// =============================================================================

export async function addRelationship(
  name: string,
  context?: string,
  options?: RelationshipOptions,
): Promise<RelationshipResult> {
  const filePath = relFilePath(name, options);
  const file = Bun.file(filePath);

  if (await file.exists()) {
    return { ok: false, error: `Relationship already exists: ${name}` };
  }

  const now = new Date().toISOString();
  const relationship: Relationship = {
    name,
    firstEncountered: now,
    lastInteraction: now,
    context: context ?? "",
    keyMoments: [],
  };

  const writeResult = await saveRelationship(relationship, options);
  if (!writeResult.ok) return { ok: false, error: writeResult.error };

  return { ok: true, relationship };
}

export async function removeRelationship(
  name: string,
  options?: RelationshipOptions,
): Promise<RelationshipWriteResult> {
  const filePath = relFilePath(name, options);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return { ok: false, error: `Relationship not found: ${name}` };
  }

  try {
    await unlink(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// T-13.5: Update and List
// =============================================================================

export async function updateRelationship(
  name: string,
  updates: Partial<Pick<Relationship, "context" | "lastInteraction">>,
  options?: RelationshipOptions,
): Promise<RelationshipResult> {
  const loadResult = await loadRelationship(name, options);
  if (!loadResult.ok) return loadResult;

  const updated: Relationship = {
    ...loadResult.relationship,
    ...updates,
    lastInteraction: updates.lastInteraction ?? new Date().toISOString(),
  };

  const writeResult = await saveRelationship(updated, options);
  if (!writeResult.ok) return { ok: false, error: writeResult.error };

  return { ok: true, relationship: updated };
}

export async function listRelationships(
  options?: RelationshipOptions,
): Promise<ListResult> {
  const dir = resolveRelationshipsDir(options?.paiDir);

  try {
    const entries = await readdir(dir);
    const names = entries
      .filter((f) => f.startsWith("rel_") && f.endsWith(".json"))
      .map((f) => f.slice(4, -5)) // Remove "rel_" prefix and ".json" suffix
      .sort();

    return { ok: true, names };
  } catch (err) {
    // Directory doesn't exist → no relationships
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, names: [] };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// T-13.6: Key Moments
// =============================================================================

export async function addKeyMoment(
  name: string,
  description: string,
  tags?: string[],
  options?: RelationshipOptions,
): Promise<RelationshipResult> {
  const loadResult = await loadRelationship(name, options);
  if (!loadResult.ok) return loadResult;

  const now = new Date().toISOString();
  const moment: KeyMoment = {
    date: now,
    description,
    ...(tags && tags.length > 0 ? { tags } : {}),
  };

  const updated: Relationship = {
    ...loadResult.relationship,
    lastInteraction: now,
    keyMoments: [...loadResult.relationship.keyMoments, moment],
  };

  const writeResult = await saveRelationship(updated, options);
  if (!writeResult.ok) return { ok: false, error: writeResult.error };

  return { ok: true, relationship: updated };
}
