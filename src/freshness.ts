import type { Learning, SeedConfig } from "./schema";
import { loadSeed, writeSeed } from "./loader";
import { writeSeedWithCommit } from "./git";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CUTOFF_DAYS = 90;
const MS_PER_DAY = 86_400_000;

// =============================================================================
// T-15.1: Staleness Detection
// =============================================================================

export function isStale(
  learning: Learning,
  cutoffDays: number = DEFAULT_CUTOFF_DAYS,
  now: Date = new Date(),
): boolean {
  const referenceDate = learning.confirmedAt ?? learning.extractedAt;
  const age = now.getTime() - new Date(referenceDate).getTime();
  return age > cutoffDays * MS_PER_DAY;
}

export type StaleLearning = {
  learning: Learning;
  category: "pattern" | "insight" | "selfKnowledge";
  daysSinceConfirmed: number;
};

export function getStaleLearnings(
  seed: SeedConfig,
  cutoffDays: number = DEFAULT_CUTOFF_DAYS,
  now: Date = new Date(),
): StaleLearning[] {
  const stale: StaleLearning[] = [];

  const categories: Array<{
    items: Learning[];
    category: StaleLearning["category"];
  }> = [
    { items: seed.learned.patterns, category: "pattern" },
    { items: seed.learned.insights, category: "insight" },
    { items: seed.learned.selfKnowledge, category: "selfKnowledge" },
  ];

  for (const { items, category } of categories) {
    for (const learning of items) {
      if (isStale(learning, cutoffDays, now)) {
        const ref = learning.confirmedAt ?? learning.extractedAt;
        const age = now.getTime() - new Date(ref).getTime();
        stale.push({
          learning,
          category,
          daysSinceConfirmed: Math.floor(age / MS_PER_DAY),
        });
      }
    }
  }

  // Sort by staleness (oldest first)
  stale.sort((a, b) => b.daysSinceConfirmed - a.daysSinceConfirmed);

  return stale;
}

// =============================================================================
// T-15.2: Freshness Stats
// =============================================================================

export type FreshnessStats = {
  patterns: { fresh: number; stale: number; total: number };
  insights: { fresh: number; stale: number; total: number };
  selfKnowledge: { fresh: number; stale: number; total: number };
  total: { fresh: number; stale: number; total: number };
};

export function getFreshnessStats(
  seed: SeedConfig,
  cutoffDays: number = DEFAULT_CUTOFF_DAYS,
  now: Date = new Date(),
): FreshnessStats {
  function countCategory(items: Learning[]) {
    let stale = 0;
    for (const item of items) {
      if (isStale(item, cutoffDays, now)) stale++;
    }
    return { fresh: items.length - stale, stale, total: items.length };
  }

  const patterns = countCategory(seed.learned.patterns);
  const insights = countCategory(seed.learned.insights);
  const selfKnowledge = countCategory(seed.learned.selfKnowledge);

  return {
    patterns,
    insights,
    selfKnowledge,
    total: {
      fresh: patterns.fresh + insights.fresh + selfKnowledge.fresh,
      stale: patterns.stale + insights.stale + selfKnowledge.stale,
      total: patterns.total + insights.total + selfKnowledge.total,
    },
  };
}

// =============================================================================
// T-15.3: Freshness Score
// =============================================================================

export function freshnessScore(
  learning: Learning,
  cutoffDays: number = DEFAULT_CUTOFF_DAYS,
  now: Date = new Date(),
): number {
  const referenceDate = learning.confirmedAt ?? learning.extractedAt;
  const age = now.getTime() - new Date(referenceDate).getTime();
  const daysSince = age / MS_PER_DAY;
  const score = 1 - daysSince / cutoffDays;
  return Math.max(0, Math.min(1, score));
}

// =============================================================================
// T-15.4: Reconfirm Learning
// =============================================================================

export type ReconfirmResult =
  | { ok: true; learning: Learning }
  | { ok: false; error: string };

export async function reconfirmLearning(
  id: string,
  seedPath?: string,
): Promise<ReconfirmResult> {
  const loadResult = await loadSeed(seedPath);
  if (!loadResult.ok) {
    return { ok: false, error: loadResult.error.message };
  }

  const config = { ...loadResult.config };
  const learned = { ...config.learned };
  const now = new Date().toISOString();
  let found: Learning | undefined;

  // Search all categories
  learned.patterns = learned.patterns.map((l) => {
    if (l.id === id) {
      const updated = { ...l, confirmedAt: now };
      found = updated;
      return updated;
    }
    return l;
  });

  if (!found) {
    learned.insights = learned.insights.map((l) => {
      if (l.id === id) {
        const updated = { ...l, confirmedAt: now };
        found = updated;
        return updated;
      }
      return l;
    });
  }

  if (!found) {
    learned.selfKnowledge = learned.selfKnowledge.map((l) => {
      if (l.id === id) {
        const updated = { ...l, confirmedAt: now };
        found = updated;
        return updated;
      }
      return l;
    });
  }

  if (!found) {
    return { ok: false, error: `Learning not found: ${id}` };
  }

  config.learned = learned;

  const writeResult = await writeSeedWithCommit(
    config,
    `Update: reconfirmed learning ${id}`,
    seedPath,
  );

  if (!writeResult.ok) {
    // Fallback to plain write if git not available
    const plainWrite = await writeSeed(config, seedPath);
    if (!plainWrite.ok) {
      return { ok: false, error: plainWrite.error.message };
    }
  }

  return { ok: true, learning: found };
}

// =============================================================================
// T-15.5: Review Prompt Generation
// =============================================================================

export function generateReviewPrompt(
  seed: SeedConfig,
  cutoffDays: number = DEFAULT_CUTOFF_DAYS,
  now: Date = new Date(),
): string | null {
  const stale = getStaleLearnings(seed, cutoffDays, now);
  if (stale.length === 0) return null;

  const categoryLabels: Record<StaleLearning["category"], string> = {
    pattern: "Patterns",
    insight: "Insights",
    selfKnowledge: "Self-Knowledge",
  };

  // Group by category
  const grouped = new Map<StaleLearning["category"], StaleLearning[]>();
  for (const item of stale) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const lines: string[] = [
    `Identity Review: ${stale.length} learning${stale.length === 1 ? "" : "s"} may be stale (>${cutoffDays} days since confirmed).`,
    "",
  ];

  for (const [category, items] of grouped) {
    lines.push(`${categoryLabels[category]}:`);
    for (const item of items) {
      lines.push(`  [${item.learning.id}] ${item.learning.content} (${item.daysSinceConfirmed}d ago)`);
    }
    lines.push("");
  }

  lines.push('Use "pai-seed refresh <id>" to re-confirm or "pai-seed forget <id>" to remove.');

  return lines.join("\n");
}
