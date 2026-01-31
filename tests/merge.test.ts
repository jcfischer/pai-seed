import { describe, expect, test } from "bun:test";
import { deepMerge, isPlainObject } from "../src/merge";
import { createDefaultSeed } from "../src/defaults";

// =============================================================================
// F-002 T-2.1: isPlainObject tests
// =============================================================================

describe("isPlainObject", () => {
  test("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject({ nested: { deep: true } })).toBe(true);
  });

  test("returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  test("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  test("returns false for primitives", () => {
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

// =============================================================================
// F-002 T-2.2: deepMerge tests
// =============================================================================

describe("deepMerge", () => {
  test("empty existing + full defaults returns defaults", () => {
    const defaults = { a: 1, b: "hello", c: { nested: true } };
    const result = deepMerge({}, defaults);
    expect(result).toEqual(defaults);
  });

  test("full existing + empty defaults returns existing", () => {
    const existing = { a: 1, b: "hello", c: { nested: true } };
    const result = deepMerge(existing, {});
    expect(result).toEqual(existing);
  });

  test("partial existing: missing fields filled from defaults", () => {
    const existing = { a: 1 };
    const defaults = { a: 99, b: "default", c: false };
    const result = deepMerge(existing, defaults);
    expect(result).toEqual({ a: 1, b: "default", c: false });
  });

  test("nested objects merge recursively (3+ levels deep)", () => {
    const existing = {
      level1: {
        level2: {
          existingKey: "keep",
        },
      },
    };
    const defaults = {
      level1: {
        level2: {
          existingKey: "default",
          newKey: "added",
          level3: {
            deep: true,
          },
        },
        newLevel2Key: "added",
      },
    };
    const result = deepMerge(existing, defaults);
    expect(result).toEqual({
      level1: {
        level2: {
          existingKey: "keep",
          newKey: "added",
          level3: {
            deep: true,
          },
        },
        newLevel2Key: "added",
      },
    });
  });

  test("arrays NOT merged: existing array wins over default array", () => {
    const existing = { tags: ["user-tag"] };
    const defaults = { tags: ["default-tag-1", "default-tag-2"] };
    const result = deepMerge(existing, defaults);
    expect(result.tags).toEqual(["user-tag"]);
  });

  test("arrays NOT merged: empty existing array stays empty", () => {
    const existing = { items: [] as string[] };
    const defaults = { items: ["default1", "default2"] };
    const result = deepMerge(existing, defaults);
    expect(result.items).toEqual([]);
  });

  test("unknown keys in existing are preserved", () => {
    const existing = { known: "value", unknownExtra: "preserved" };
    const defaults = { known: "default" };
    const result = deepMerge(existing, defaults);
    expect(result).toEqual({ known: "value", unknownExtra: "preserved" });
  });

  test("primitives: existing value wins", () => {
    const existing = { count: 42, name: "custom" };
    const defaults = { count: 0, name: "default" };
    const result = deepMerge(existing, defaults);
    expect(result.count).toBe(42);
    expect(result.name).toBe("custom");
  });

  test("null values treated as primitives (existing null wins)", () => {
    const existing = { value: null };
    const defaults = { value: { nested: true } };
    const result = deepMerge(
      existing as Record<string, unknown>,
      defaults as Record<string, unknown>,
    );
    expect(result.value).toBeNull();
  });

  test("returns new object (does not mutate inputs)", () => {
    const existing = { a: 1, nested: { b: 2 } };
    const defaults = { a: 0, nested: { b: 0, c: 3 } };

    const existingCopy = JSON.parse(JSON.stringify(existing));
    const defaultsCopy = JSON.parse(JSON.stringify(defaults));

    const result = deepMerge(existing, defaults);

    // Inputs unchanged
    expect(existing).toEqual(existingCopy);
    expect(defaults).toEqual(defaultsCopy);

    // Result is a new reference
    expect(result).not.toBe(existing);
    expect(result).not.toBe(defaults);
    expect(result.nested).not.toBe(existing.nested);
    expect(result.nested).not.toBe(defaults.nested);
  });

  // ---- Real-world seed scenarios ----

  test("real-world: seed missing state gets it from defaults", () => {
    const defaults = createDefaultSeed() as unknown as Record<string, unknown>;
    const existing = {
      version: "1.0.0",
      identity: {
        principalName: "Alice",
        aiName: "Nova",
        catchphrase: "Nova online.",
        voiceId: "custom-voice",
        preferences: {
          responseStyle: "concise",
          timezone: "Europe/Zurich",
          locale: "de-CH",
        },
      },
      learned: {
        patterns: [],
        insights: [],
        selfKnowledge: [],
      },
      // state is missing entirely
    };

    const result = deepMerge(
      existing as unknown as Record<string, unknown>,
      defaults,
    );

    // Identity preserved
    expect((result.identity as Record<string, unknown>).principalName).toBe("Alice");
    // State filled from defaults
    expect(result.state).toBeDefined();
    const state = result.state as Record<string, unknown>;
    expect(state.proposals).toEqual([]);
    expect(state.activeProjects).toEqual([]);
  });

  test("real-world: seed with custom patterns keeps them", () => {
    const defaults = createDefaultSeed() as unknown as Record<string, unknown>;
    const existingPatterns = [
      {
        id: "p1",
        content: "User prefers TypeScript",
        source: "session-1",
        extractedAt: "2025-01-01T00:00:00Z",
        confirmed: true,
        confirmedAt: "2025-01-02T00:00:00Z",
        tags: ["tech"],
      },
    ];
    const existing = {
      version: "1.0.0",
      identity: (defaults.identity as Record<string, unknown>),
      learned: {
        patterns: existingPatterns,
        insights: [],
        selfKnowledge: [],
      },
      state: (defaults.state as Record<string, unknown>),
    };

    const result = deepMerge(
      existing as unknown as Record<string, unknown>,
      defaults,
    );

    // User's patterns array preserved (not overwritten by empty default)
    const learned = result.learned as Record<string, unknown>;
    expect(learned.patterns).toEqual(existingPatterns);
  });

  test("both inputs empty returns empty object", () => {
    const result = deepMerge({}, {});
    expect(result).toEqual({});
  });
});
