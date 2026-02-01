import { describe, test, expect } from "bun:test";
import { resolveIdPrefix } from "../src/id-prefix";

const items = [
  { id: "gDo_K4_nHDvrFhoORY7WJ" },
  { id: "gDo_XXXX_different_id" },
  { id: "VzpNopnPiFvo36DKPf_rF" },
  { id: "abc123unique_longid01" },
];

describe("F-018: resolveIdPrefix", () => {
  test("unique prefix resolves to full ID", () => {
    const result = resolveIdPrefix(items, "VzpN");
    expect(result).toEqual({ ok: true, id: "VzpNopnPiFvo36DKPf_rF" });
  });

  test("exact full ID match always works", () => {
    const result = resolveIdPrefix(items, "gDo_K4_nHDvrFhoORY7WJ");
    expect(result).toEqual({ ok: true, id: "gDo_K4_nHDvrFhoORY7WJ" });
  });

  test("ambiguous prefix returns error with matches", () => {
    const result = resolveIdPrefix(items, "gDo_");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ambiguous prefix");
      expect(result.error).toContain("gDo_K4_nHDvr");
      expect(result.error).toContain("gDo_XXXX_dif");
    }
  });

  test("no match returns error", () => {
    const result = resolveIdPrefix(items, "ZZZZ");
    expect(result).toEqual({ ok: false, error: "No item matching 'ZZZZ'" });
  });

  test("prefix too short returns error", () => {
    const result = resolveIdPrefix(items, "gD");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("too short");
      expect(result.error).toContain("minimum 4");
    }
  });

  test("custom minLength", () => {
    const result = resolveIdPrefix(items, "ab", 2);
    expect(result).toEqual({ ok: true, id: "abc123unique_longid01" });
  });

  test("empty items returns not found", () => {
    const result = resolveIdPrefix([], "abcd");
    expect(result).toEqual({ ok: false, error: "No item matching 'abcd'" });
  });

  test("longer prefix disambiguates", () => {
    // "gDo_" is ambiguous but "gDo_K" is unique
    const result = resolveIdPrefix(items, "gDo_K");
    expect(result).toEqual({ ok: true, id: "gDo_K4_nHDvrFhoORY7WJ" });
  });
});
