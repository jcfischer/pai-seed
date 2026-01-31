import { describe, expect, test } from "bun:test";
import { validateSeed } from "../src/validate";
import type { Learning, Proposal } from "../src/schema";

// =============================================================================
// Fixture helpers
// =============================================================================

function validMinimalSeed() {
  return {
    version: "1.0.0",
    identity: {
      principalName: "User",
      aiName: "PAI",
      catchphrase: "PAI here, ready to go.",
      voiceId: "default",
      preferences: {
        responseStyle: "adaptive" as const,
        timezone: "UTC",
        locale: "en-US",
      },
    },
    learned: {
      patterns: [] as Learning[],
      insights: [] as Learning[],
      selfKnowledge: [] as Learning[],
    },
    state: {
      proposals: [] as Proposal[],
      activeProjects: [] as string[],
    },
  };
}

// =============================================================================
// T-5.3: Validation unit tests
// =============================================================================

describe("validateSeed", () => {
  // ---- Happy path ----

  test("valid full seed returns valid: true", async () => {
    const fixture = await import("./fixtures/valid-seed.json");
    const result = validateSeed(fixture.default);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.version).toBe("1.0.0");
      expect(result.config.identity.principalName).toBe("Daniel");
      expect(result.config.learned.patterns.length).toBe(3);
      expect(result.config.state.proposals.length).toBe(3);
    }
  });

  test("valid minimal seed returns valid: true", async () => {
    const fixture = await import("./fixtures/valid-seed-minimal.json");
    const result = validateSeed(fixture.default);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.learned.patterns).toEqual([]);
      expect(result.config.state.proposals).toEqual([]);
    }
  });

  test("valid inline seed returns config with correct type", () => {
    const result = validateSeed(validMinimalSeed());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.version).toBe("1.0.0");
    }
  });

  // ---- Version pre-checks ----

  test("missing version field returns error", async () => {
    const fixture = await import("./fixtures/invalid-missing-version.json");
    const result = validateSeed(fixture.default);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].path).toBe("$.version");
      expect(result.errors[0].code).toBe("missing_field");
      expect(result.errors[0].message).toContain("Missing required field");
    }
  });

  test("non-string version returns error", () => {
    const data = { ...validMinimalSeed(), version: 100 };
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$.version");
      expect(result.errors[0].code).toBe("invalid_type");
    }
  });

  test("non-semver version returns format error", () => {
    const data = { ...validMinimalSeed(), version: "v1.0" };
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$.version");
      expect(result.errors[0].code).toBe("invalid_format");
      expect(result.errors[0].message).toContain("Invalid version format");
    }
  });

  test("major version mismatch returns migration error", () => {
    const data = { ...validMinimalSeed(), version: "2.0.0" };
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$.version");
      expect(result.errors[0].code).toBe("version_mismatch");
      expect(result.errors[0].message).toContain("requires migration");
      expect(result.errors[0].message).toContain("1.x.x");
    }
  });

  test("version 0.x.x returns migration error (major mismatch)", () => {
    const data = { ...validMinimalSeed(), version: "0.9.0" };
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("version_mismatch");
    }
  });

  // ---- Null / undefined / type guard ----

  test("null input returns error", () => {
    const result = validateSeed(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$");
      expect(result.errors[0].code).toBe("invalid_type");
      expect(result.errors[0].message).toContain("non-null object");
    }
  });

  test("undefined input returns error", () => {
    const result = validateSeed(undefined);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("invalid_type");
    }
  });

  test("number input returns error", () => {
    const result = validateSeed(42);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$");
      expect(result.errors[0].message).toContain("number");
    }
  });

  test("string input returns error", () => {
    const result = validateSeed("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$");
      expect(result.errors[0].message).toContain("string");
    }
  });

  test("array input returns error", () => {
    const result = validateSeed([1, 2, 3]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("$");
      expect(result.errors[0].message).toContain("array");
    }
  });

  // ---- Missing required fields (Zod structural) ----

  test("missing identity returns error with JSONPath", () => {
    const data = validMinimalSeed();
    delete (data as Record<string, unknown>).identity;
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const identityError = result.errors.find((e) => e.path === "$.identity");
      expect(identityError).toBeDefined();
    }
  });

  test("missing learned returns error with JSONPath", () => {
    const data = validMinimalSeed();
    delete (data as Record<string, unknown>).learned;
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const learnedError = result.errors.find((e) => e.path === "$.learned");
      expect(learnedError).toBeDefined();
    }
  });

  test("missing nested field returns deep JSONPath", () => {
    const data = validMinimalSeed();
    delete (data.identity as Record<string, unknown>).preferences;
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const prefError = result.errors.find((e) =>
        e.path.includes("identity.preferences")
      );
      expect(prefError).toBeDefined();
    }
  });

  // ---- Wrong types ----

  test("wrong types file produces multiple errors", async () => {
    // The wrong-types fixture has version as number, which hits the pre-check
    const fixture = await import("./fixtures/invalid-wrong-types.json");
    const result = validateSeed(fixture.default);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].path).toBe("$.version");
    }
  });

  test("multiple structural errors are all reported", () => {
    const data = {
      version: "1.0.0",
      identity: {
        principalName: 42, // wrong type
        aiName: "", // too short
        catchphrase: "Hello",
        voiceId: "default",
        preferences: {
          responseStyle: "invalid-style", // wrong enum
          timezone: "UTC",
          locale: "en-US",
        },
      },
      learned: {
        patterns: [],
        insights: [],
        selfKnowledge: [],
      },
      state: {
        proposals: [],
        activeProjects: [],
      },
    };
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Should have at least 3 errors: principalName type, aiName min, responseStyle enum
      expect(result.errors.length).toBeGreaterThanOrEqual(3);

      // Check that different paths are represented
      const paths = result.errors.map((e) => e.path);
      expect(paths.some((p) => p.includes("principalName"))).toBe(true);
      expect(paths.some((p) => p.includes("aiName"))).toBe(true);
      expect(paths.some((p) => p.includes("responseStyle"))).toBe(true);
    }
  });

  // ---- Unknown keys (warnings) ----

  test("unknown top-level keys produce warnings, not errors", () => {
    const data = {
      ...validMinimalSeed(),
      futureFeature: "value",
      anotherFuture: 42,
    };
    const result = validateSeed(data);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(2);
      expect(result.warnings!.some((w) => w.includes("futureFeature"))).toBe(true);
      expect(result.warnings!.some((w) => w.includes("anotherFuture"))).toBe(true);
    }
  });

  test("no unknown keys means no warnings", () => {
    const result = validateSeed(validMinimalSeed());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toBeUndefined();
    }
  });

  // ---- Malformed inner objects ----

  test("invalid learning in patterns array produces deep path", () => {
    const data = validMinimalSeed();
    data.learned.patterns = [
      {
        id: "bad_001",
        content: "", // too short
        source: "test",
        extractedAt: "2026-01-15T10:00:00Z",
        confirmed: true,
        tags: [],
      } as any,
    ];
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const patternError = result.errors.find((e) =>
        e.path.includes("learned.patterns.0.content")
      );
      expect(patternError).toBeDefined();
    }
  });

  test("invalid proposal in state produces deep path", () => {
    const data = validMinimalSeed();
    data.state.proposals = [
      {
        id: "prop_bad",
        type: "invalid_type" as any,
        content: "test",
        source: "test",
        extractedAt: "2026-01-15T10:00:00Z",
        status: "pending",
      },
    ];
    const result = validateSeed(data);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const proposalError = result.errors.find((e) =>
        e.path.includes("state.proposals.0.type")
      );
      expect(proposalError).toBeDefined();
    }
  });

  // ---- Performance (T-5.6) ----

  test("validates large seed (1600 entries) in <50ms", async () => {
    const fixture = await import("./fixtures/large-seed.json");
    const data = fixture.default;

    // Warm-up run
    validateSeed(data);

    // Timed runs
    const iterations = 10;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const result = validateSeed(data);
      expect(result.valid).toBe(true);
    }
    const elapsed = (performance.now() - start) / iterations;

    expect(elapsed).toBeLessThan(50);
  });
});
