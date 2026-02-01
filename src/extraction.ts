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
// F-017: ACR Semantic Extraction Types
// =============================================================================

export type AcrExtractionResult =
  | {
      ok: true;
      learnings: Array<{
        type: "pattern" | "insight" | "self_knowledge";
        content: string;
        confidence: number;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

export type AcrExtractionOptions = {
  acrBinary?: string;
  timeout?: number;
  confidence?: number;
};

// =============================================================================
// F-019: Content truncation
// =============================================================================

export const MAX_PROPOSAL_CONTENT_LENGTH = 200;

function truncateContent(content: string): string {
  if (content.length <= MAX_PROPOSAL_CONTENT_LENGTH) return content;
  return content.slice(0, MAX_PROPOSAL_CONTENT_LENGTH) + "...";
}

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
      content: truncateContent(signal.content),
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
// F-017: acrLearningsToProposals — Convert ACR learnings to Proposals
// =============================================================================

/**
 * Convert ACR extraction learnings to Proposal objects.
 * Deduplicates by content (case-insensitive).
 */
function acrLearningsToProposals(
  learnings: Array<{
    type: "pattern" | "insight" | "self_knowledge";
    content: string;
    confidence: number;
  }>,
  sessionId?: string,
): Proposal[] {
  const source = sessionId ?? "unknown-session";
  const now = new Date().toISOString();
  const seen = new Set<string>();

  return learnings
    .filter((l) => {
      const key = l.content.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((l) => ({
      id: nanoid(),
      type: l.type,
      content: truncateContent(l.content),
      source,
      extractedAt: now,
      status: "pending" as const,
      method: "acr" as const,
    }));
}

// =============================================================================
// F-019: stripStructuredContent — Pre-filter transcript
// =============================================================================

const FENCED_CODE_BLOCK = /^```[\s\S]*?^```/gm;
const LINE_NUMBER_PREFIX = /^\s*\d+[→│|]\s*.*$/gm;
const TOOL_BLOCKS =
  /<(?:antml:invoke|tool_result|function_results)[\s\S]*?<\/(?:antml:invoke|tool_result|function_results)>/g;
const MULTILINE_JSON = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;

/**
 * Strip structured data regions from transcript text.
 * Replaces code blocks, tool output, and large JSON with [...] placeholders.
 * Removes line-number prefixed lines entirely.
 * Collapses 3+ consecutive newlines to 2.
 */
export function stripStructuredContent(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(FENCED_CODE_BLOCK, " [...] ");
  cleaned = cleaned.replace(LINE_NUMBER_PREFIX, "");
  cleaned = cleaned.replace(TOOL_BLOCKS, " [...] ");
  cleaned = cleaned.replace(MULTILINE_JSON, (match) =>
    match.length > 200 ? " [...] " : match,
  );
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned;
}

// =============================================================================
// F-006/F-017: extractionHook — I/O orchestrator (ACR-first with regex fallback)
// =============================================================================

/**
 * End-to-end extraction hook: pre-filter transcript, try ACR, regex only on ACR failure.
 *
 * Strategy:
 * - Pre-filter transcript via stripStructuredContent() (removes code blocks, JSON, tool output)
 * - Try ACR first via callAcrExtraction() on cleaned transcript
 * - If ACR returns ok:true with learnings above threshold, use them
 * - If ACR returns ok:true with 0 learnings above threshold, accept silence (no fallback)
 * - If ACR returns ok:false (binary not found, timeout, error), fall back to regex on cleaned text
 * - All proposal content truncated to 200 chars
 * - Write proposals to seed, never throws
 */
export async function extractionHook(
  transcript: string,
  sessionId?: string,
  seedPath?: string,
): Promise<ExtractionResult> {
  try {
    let proposals: Proposal[];

    // Pre-filter transcript: strip code blocks, JSON, tool output
    const cleaned = stripStructuredContent(transcript);

    // Try ACR semantic extraction first
    const acrResult = await callAcrExtraction(cleaned);

    if (acrResult.ok) {
      // ACR succeeded — apply confidence filtering
      const threshold = parseFloat(
        process.env.PAI_EXTRACTION_CONFIDENCE || "0.7",
      );
      const filtered = acrResult.learnings.filter(
        (l) => l.confidence >= threshold,
      );

      if (filtered.length > 0) {
        // ACR found high-confidence learnings — use them
        proposals = acrLearningsToProposals(filtered, sessionId);
      } else {
        // ACR succeeded but found nothing above threshold — accept silence
        proposals = [];
      }
    } else {
      // ACR unavailable — regex on pre-filtered transcript
      proposals = extractProposals(cleaned, sessionId);
      for (const p of proposals) {
        p.method = "regex";
      }
    }

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
// F-017: callAcrExtraction — CLI interface to ACR
// =============================================================================

/**
 * Call ACR's semantic extraction endpoint via CLI.
 * Pipes transcript to stdin, parses JSON from stdout.
 * Returns structured result or error (never throws).
 */
export async function callAcrExtraction(
  transcript: string,
  options?: AcrExtractionOptions,
): Promise<AcrExtractionResult> {
  const acrBinary = options?.acrBinary ?? "acr";
  const timeout = options?.timeout ?? 30000;
  const confidence = options?.confidence ??
    parseFloat(process.env.PAI_EXTRACTION_CONFIDENCE || "0.7");

  try {
    // Check if ACR binary exists
    const binaryPath = Bun.which(acrBinary);
    if (!binaryPath) {
      return { ok: false, error: `ACR binary not found: ${acrBinary}` };
    }

    // Spawn ACR process
    const proc = Bun.spawn(
      [acrBinary, "--extract-learnings", "--json", "--confidence", String(confidence)],
      {
        stdin: new Response(transcript).body!,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Race between process completion and timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        proc.kill();
        reject(new Error(`ACR extraction timed out after ${timeout}ms`));
      }, timeout),
    );

    const exitCode = await Promise.race([proc.exited, timeoutPromise]);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      return {
        ok: false,
        error: `ACR extraction failed (exit ${exitCode}): ${stderr.trim() || "unknown error"}`,
      };
    }

    // Parse JSON output
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "ACR returned invalid JSON" };
    }

    // Validate structure
    if (typeof parsed !== "object" || parsed === null || !("ok" in parsed)) {
      return { ok: false, error: "ACR returned unexpected response format" };
    }

    const result = parsed as AcrExtractionResult;
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    // Validate learnings array
    if (!Array.isArray(result.learnings)) {
      return { ok: false, error: "ACR response missing learnings array" };
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
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
