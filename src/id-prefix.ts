// =============================================================================
// F-018: Short ID prefix resolution
// =============================================================================

export type IdPrefixResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Resolve a short ID prefix to a full ID.
 *
 * - Minimum prefix length: minLength (default 4)
 * - Exact full-ID match always wins (even if prefix is short)
 * - If exactly 1 item starts with prefix: return its full ID
 * - If 0 matches: error "No item matching '<prefix>'"
 * - If multiple: error "Ambiguous prefix '<prefix>', matches: ..."
 */
export function resolveIdPrefix(
  items: Array<{ id: string }>,
  prefix: string,
  minLength = 4,
): IdPrefixResult {
  // Exact full-ID match takes priority
  const exact = items.find((item) => item.id === prefix);
  if (exact) {
    return { ok: true, id: exact.id };
  }

  if (prefix.length < minLength) {
    return {
      ok: false,
      error: `ID prefix too short: '${prefix}' (minimum ${minLength} characters)`,
    };
  }

  const matches = items.filter((item) => item.id.startsWith(prefix));

  if (matches.length === 0) {
    return { ok: false, error: `No item matching '${prefix}'` };
  }

  if (matches.length === 1) {
    return { ok: true, id: matches[0].id };
  }

  const ids = matches.map((m) => m.id.slice(0, 12)).join(", ");
  return {
    ok: false,
    error: `Ambiguous prefix '${prefix}', matches: ${ids}`,
  };
}
