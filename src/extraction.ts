import { nanoid } from "nanoid";
import type { Proposal, SeedConfig } from "./schema";
import { loadSeedWithGit, writeSeedWithCommit } from "./git";

// =============================================================================
// F-006: Types
// =============================================================================

export type SignalType = "pattern" | "insight" | "self_knowledge";

export type LearningSignal = {
  type: SignalType;
  content: string;
  matchedPhrase: string;
};

export type WriteProposalsResult =
  | { ok: true; added: number; skipped: number }
  | { ok: false; error: string };

export type ExtractionResult =
  | { ok: true; added: number; total: number }
  | { ok: false; error: string };

// =============================================================================
// F-006: Signal Phrases
// =============================================================================

const SIGNAL_PHRASES: Record<string, SignalType> = {
  "you prefer": "pattern",
  "you like to": "pattern",
  "you always": "pattern",
  "you usually": "pattern",
  "your preference": "pattern",
  "your style": "pattern",
  "you tend to": "pattern",
  "i learned": "insight",
  "i noticed": "insight",
  "i discovered": "insight",
  "key insight": "insight",
  "important finding": "insight",
  "takeaway": "insight",
  "the lesson": "insight",
  "note to self": "self_knowledge",
  "remember that": "self_knowledge",
  "i should remember": "self_knowledge",
  "for next time": "self_knowledge",
  "mental note": "self_knowledge",
  "i need to remember": "self_knowledge",
};

// =============================================================================
// F-006 1: detectLearningSignals — Pure function
// =============================================================================

/**
 * Split text into sentences and detect learning signal phrases.
 *
 * Splitting rules:
 * - Split on `. `, `.\n`, `! `, `? `, `\n` (NOT bare `.`)
 * - Word boundary: char before match must be start-of-string, space, newline, or punctuation
 * - Clean: trim, remove leading punctuation, normalize smart quotes
 * - Skip if cleaned content < 10 characters
 */
export function detectLearningSignals(text: string): LearningSignal[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const sentences = splitSentences(text);
  const signals: LearningSignal[] = [];

  for (const sentence of sentences) {
    const cleaned = cleanSentence(sentence);
    if (cleaned.length < 10) {
      continue;
    }

    const lowerCleaned = cleaned.toLowerCase();

    for (const [phrase, type] of Object.entries(SIGNAL_PHRASES)) {
      const idx = lowerCleaned.indexOf(phrase);
      if (idx === -1) continue;

      // Word boundary check: char before match must be start-of-string,
      // space, newline, or punctuation
      if (idx > 0) {
        const charBefore = lowerCleaned[idx - 1];
        if (!/[\s\n.,;:!?\-\(\)\[\]"']/.test(charBefore)) {
          continue;
        }
      }

      signals.push({
        type,
        content: cleaned,
        matchedPhrase: phrase,
      });
      // Only match first phrase per sentence
      break;
    }
  }

  return signals;
}

// =============================================================================
// F-006 2: extractProposals — Pure function
// =============================================================================

/**
 * Extract Proposal objects from a transcript string.
 *
 * - Calls detectLearningSignals
 * - Maps each signal to a Proposal with nanoid, ISO datetime, status "pending"
 * - Deduplicates by content (case-insensitive)
 * - Default sessionId to "unknown-session"
 */
export function extractProposals(
  transcript: string,
  sessionId?: string,
): Proposal[] {
  const signals = detectLearningSignals(transcript);
  if (signals.length === 0) {
    return [];
  }

  const source = sessionId ?? "unknown-session";
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const proposals: Proposal[] = [];

  for (const signal of signals) {
    const key = signal.content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    proposals.push({
      id: nanoid(),
      type: signal.type,
      content: signal.content,
      source,
      extractedAt: now,
      status: "pending",
    });
  }

  return proposals;
}

// =============================================================================
// F-006 3: writeProposals — I/O function
// =============================================================================

/**
 * Write extracted proposals to the seed file, deduplicating against existing ones.
 *
 * - If empty proposals, return { ok: true, added: 0, skipped: 0 }
 * - loadSeedWithGit(seedPath)
 * - Deduplicate against existing state.proposals (case-insensitive content)
 * - Append new to state.proposals
 * - writeSeedWithCommit(config, "Learn: extracted N proposals", seedPath)
 */
export async function writeProposals(
  proposals: Proposal[],
  seedPath?: string,
): Promise<WriteProposalsResult> {
  if (proposals.length === 0) {
    return { ok: true, added: 0, skipped: 0 };
  }

  try {
    const loadResult = await loadSeedWithGit(seedPath);
    if (!loadResult.ok) {
      return { ok: false, error: loadResult.error.message };
    }

    const config: SeedConfig = loadResult.config;
    const existingContents = new Set(
      config.state.proposals.map((p) => p.content.toLowerCase()),
    );

    let added = 0;
    let skipped = 0;

    for (const proposal of proposals) {
      const key = proposal.content.toLowerCase();
      if (existingContents.has(key)) {
        skipped++;
      } else {
        config.state.proposals.push(proposal);
        existingContents.add(key);
        added++;
      }
    }

    if (added > 0) {
      const commitMsg = `Learn: extracted ${added} proposal${added === 1 ? "" : "s"}`;
      await writeSeedWithCommit(config, commitMsg, seedPath);
    }

    return { ok: true, added, skipped };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// F-006 4: extractionHook — I/O orchestrator
// =============================================================================

/**
 * End-to-end extraction hook: detect signals, create proposals, write to seed.
 *
 * - Call extractProposals; if empty return { ok: true, added: 0, total: 0 }
 * - Call writeProposals
 * - Never throws (wrap in try/catch)
 * - Return { ok: true, added, total }
 */
export async function extractionHook(
  transcript: string,
  sessionId?: string,
  seedPath?: string,
): Promise<ExtractionResult> {
  try {
    const proposals = extractProposals(transcript, sessionId);
    if (proposals.length === 0) {
      return { ok: true, added: 0, total: 0 };
    }

    const total = proposals.length;
    const writeResult = await writeProposals(proposals, seedPath);

    if (!writeResult.ok) {
      return { ok: false, error: writeResult.error };
    }

    return { ok: true, added: writeResult.added, total };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Split text into sentences on `. `, `.\n`, `! `, `? `, `\n`.
 * Does NOT split on bare `.` (preserves URLs, abbreviations, etc.)
 */
function splitSentences(text: string): string[] {
  // Replace sentence-ending patterns with a unique delimiter
  const DELIM = "\x00";
  let processed = text;

  // Order matters: longer patterns first
  processed = processed.replace(/\.\n/g, DELIM);
  processed = processed.replace(/\. /g, DELIM);
  processed = processed.replace(/! /g, DELIM);
  processed = processed.replace(/\? /g, DELIM);
  processed = processed.replace(/\n/g, DELIM);

  return processed
    .split(DELIM)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Clean a sentence: trim, remove leading punctuation, normalize smart quotes.
 */
function cleanSentence(sentence: string): string {
  let cleaned = sentence.trim();

  // Normalize smart quotes to straight quotes
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");

  // Remove leading punctuation (dash, bullet, hash, asterisk, etc.)
  cleaned = cleaned.replace(/^[\s\-\*\#\>\|\+\!\?\.\,\;\:\u2022]+\s*/, "");

  return cleaned.trim();
}
