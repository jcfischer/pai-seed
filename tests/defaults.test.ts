import { describe, expect, test } from "bun:test";
import { createDefaultSeed } from "../src/defaults";
import { validateSeed } from "../src/validate";
import { seedConfigSchema } from "../src/schema";

// =============================================================================
// T-5.4: Default seed tests
// =============================================================================

describe("createDefaultSeed", () => {
  test("returns a seed that validates successfully", () => {
    const seed = createDefaultSeed();
    const result = validateSeed(seed);
    expect(result.valid).toBe(true);
  });

  test("returns a seed that passes Zod schema directly", () => {
    const seed = createDefaultSeed();
    const result = seedConfigSchema.safeParse(seed);
    expect(result.success).toBe(true);
  });

  test("has version 1.0.0", () => {
    const seed = createDefaultSeed();
    expect(seed.version).toBe("1.0.0");
  });

  test("identity has correct default values", () => {
    const seed = createDefaultSeed();
    expect(seed.identity.principalName).toBe("User");
    expect(seed.identity.aiName).toBe("PAI");
    expect(seed.identity.catchphrase).toBe("PAI here, ready to go.");
    expect(seed.identity.voiceId).toBe("default");
  });

  test("preferences have correct default values", () => {
    const seed = createDefaultSeed();
    expect(seed.identity.preferences.responseStyle).toBe("adaptive");
    expect(seed.identity.preferences.timezone).toBe("UTC");
    expect(seed.identity.preferences.locale).toBe("en-US");
  });

  test("learned arrays are all empty", () => {
    const seed = createDefaultSeed();
    expect(seed.learned.patterns).toEqual([]);
    expect(seed.learned.insights).toEqual([]);
    expect(seed.learned.selfKnowledge).toEqual([]);
  });

  test("state has empty proposals and activeProjects", () => {
    const seed = createDefaultSeed();
    expect(seed.state.proposals).toEqual([]);
    expect(seed.state.activeProjects).toEqual([]);
  });

  test("state optional fields are absent", () => {
    const seed = createDefaultSeed();
    expect(seed.state.lastSessionId).toBeUndefined();
    expect(seed.state.lastSessionAt).toBeUndefined();
    expect(seed.state.checkpointRef).toBeUndefined();
  });

  test("returns a fresh instance each call (not shared reference)", () => {
    const seed1 = createDefaultSeed();
    const seed2 = createDefaultSeed();

    // Same values
    expect(seed1).toEqual(seed2);

    // But not the same reference
    expect(seed1).not.toBe(seed2);
    expect(seed1.identity).not.toBe(seed2.identity);
    expect(seed1.learned).not.toBe(seed2.learned);
    expect(seed1.state).not.toBe(seed2.state);
    expect(seed1.learned.patterns).not.toBe(seed2.learned.patterns);

    // Mutation of one doesn't affect the other
    seed1.identity.principalName = "Changed";
    expect(seed2.identity.principalName).toBe("User");
  });
});
