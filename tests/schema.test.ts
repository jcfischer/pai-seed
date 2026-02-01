import { describe, expect, test } from "bun:test";
import {
  learningSchema,
  proposalSchema,
  preferencesSchema,
  identityLayerSchema,
  learnedLayerSchema,
  stateLayerSchema,
  seedConfigSchema,
  type Learning,
  type Proposal,
  type IdentityLayer,
  type SeedConfig,
} from "../src/schema";

// =============================================================================
// Fixture helpers
// =============================================================================

function validLearning(): Learning {
  return {
    id: "learn_001",
    content: "Prefers TypeScript over Python",
    source: "session_2026-01-15",
    extractedAt: "2026-01-15T10:30:00Z",
    confirmed: true,
    confirmedAt: "2026-01-15T10:35:00Z",
    tags: ["language", "preference"],
  };
}

function validProposal(): Proposal {
  return {
    id: "prop_001",
    type: "pattern",
    content: "Uses Bun runtime exclusively",
    source: "session_2026-01-16",
    extractedAt: "2026-01-16T09:00:00Z",
    status: "pending",
  };
}

function validIdentity(): IdentityLayer {
  return {
    principalName: "Jens-Christian",
    aiName: "Ivy",
    catchphrase: "Ivy here, ready to go.",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    preferences: {
      responseStyle: "adaptive",
      timezone: "Europe/Zurich",
      locale: "en-US",
    },
  };
}

function validSeedConfig(): SeedConfig {
  return {
    version: "1.0.0",
    identity: validIdentity(),
    learned: { patterns: [], insights: [], selfKnowledge: [] },
    state: { proposals: [], activeProjects: [] },
  };
}

// =============================================================================
// T-5.2: Schema unit tests
// =============================================================================

describe("learningSchema", () => {
  test("parses a valid learning entry", () => {
    const result = learningSchema.safeParse(validLearning());
    expect(result.success).toBe(true);
  });

  test("parses learning without optional confirmedAt", () => {
    const learning = { ...validLearning() };
    delete (learning as Record<string, unknown>).confirmedAt;
    const result = learningSchema.safeParse(learning);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confirmedAt).toBeUndefined();
    }
  });

  test("rejects empty content string", () => {
    const result = learningSchema.safeParse({ ...validLearning(), content: "" });
    expect(result.success).toBe(false);
  });

  test("rejects empty source string", () => {
    const result = learningSchema.safeParse({ ...validLearning(), source: "" });
    expect(result.success).toBe(false);
  });

  test("rejects non-ISO datetime for extractedAt", () => {
    const result = learningSchema.safeParse({
      ...validLearning(),
      extractedAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-ISO datetime for confirmedAt", () => {
    const result = learningSchema.safeParse({
      ...validLearning(),
      confirmedAt: "January 15, 2026",
    });
    expect(result.success).toBe(false);
  });

  test("accepts empty tags array", () => {
    const result = learningSchema.safeParse({ ...validLearning(), tags: [] });
    expect(result.success).toBe(true);
  });

  test("rejects tags as non-array", () => {
    const result = learningSchema.safeParse({
      ...validLearning(),
      tags: "not-an-array",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing confirmed boolean", () => {
    const data = { ...validLearning() };
    delete (data as Record<string, unknown>).confirmed;
    const result = learningSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("proposalSchema", () => {
  test("parses a valid proposal", () => {
    const result = proposalSchema.safeParse(validProposal());
    expect(result.success).toBe(true);
  });

  test("accepts all valid type enum values", () => {
    for (const type of ["pattern", "insight", "self_knowledge"]) {
      const result = proposalSchema.safeParse({ ...validProposal(), type });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid type enum value", () => {
    const result = proposalSchema.safeParse({
      ...validProposal(),
      type: "unknown_type",
    });
    expect(result.success).toBe(false);
  });

  test("accepts all valid status enum values", () => {
    for (const status of ["pending", "accepted", "rejected"]) {
      const result = proposalSchema.safeParse({ ...validProposal(), status });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid status enum value", () => {
    const result = proposalSchema.safeParse({
      ...validProposal(),
      status: "in_progress",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty content", () => {
    const result = proposalSchema.safeParse({ ...validProposal(), content: "" });
    expect(result.success).toBe(false);
  });

  test("rejects empty source", () => {
    const result = proposalSchema.safeParse({ ...validProposal(), source: "" });
    expect(result.success).toBe(false);
  });
});

describe("preferencesSchema", () => {
  test("parses valid preferences", () => {
    const result = preferencesSchema.safeParse({
      responseStyle: "concise",
      timezone: "America/New_York",
      locale: "de-CH",
    });
    expect(result.success).toBe(true);
  });

  test("accepts all responseStyle enum values", () => {
    for (const style of ["concise", "detailed", "adaptive"]) {
      const result = preferencesSchema.safeParse({
        responseStyle: style,
        timezone: "UTC",
        locale: "en-US",
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid responseStyle", () => {
    const result = preferencesSchema.safeParse({
      responseStyle: "ultra-verbose",
      timezone: "UTC",
      locale: "en-US",
    });
    expect(result.success).toBe(false);
  });
});

describe("identityLayerSchema", () => {
  test("parses valid identity", () => {
    const result = identityLayerSchema.safeParse(validIdentity());
    expect(result.success).toBe(true);
  });

  test("rejects missing principalName", () => {
    const data = { ...validIdentity() };
    delete (data as Record<string, unknown>).principalName;
    const result = identityLayerSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects empty principalName", () => {
    const result = identityLayerSchema.safeParse({
      ...validIdentity(),
      principalName: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty aiName", () => {
    const result = identityLayerSchema.safeParse({
      ...validIdentity(),
      aiName: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty catchphrase", () => {
    const result = identityLayerSchema.safeParse({
      ...validIdentity(),
      catchphrase: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts empty voiceId (not min-constrained)", () => {
    const result = identityLayerSchema.safeParse({
      ...validIdentity(),
      voiceId: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("learnedLayerSchema", () => {
  test("parses with empty arrays", () => {
    const result = learnedLayerSchema.safeParse({
      patterns: [],
      insights: [],
      selfKnowledge: [],
    });
    expect(result.success).toBe(true);
  });

  test("parses with populated arrays", () => {
    const result = learnedLayerSchema.safeParse({
      patterns: [validLearning()],
      insights: [validLearning()],
      selfKnowledge: [validLearning()],
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid learning in patterns array", () => {
    const result = learnedLayerSchema.safeParse({
      patterns: [{ id: "bad", content: "" }],
      insights: [],
      selfKnowledge: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-array for patterns", () => {
    const result = learnedLayerSchema.safeParse({
      patterns: "not-an-array",
      insights: [],
      selfKnowledge: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("stateLayerSchema", () => {
  test("parses with all optional fields absent", () => {
    const result = stateLayerSchema.safeParse({
      proposals: [],
      activeProjects: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lastSessionId).toBeUndefined();
      expect(result.data.lastSessionAt).toBeUndefined();
      expect(result.data.checkpointRef).toBeUndefined();
    }
  });

  test("parses with all optional fields present", () => {
    const result = stateLayerSchema.safeParse({
      lastSessionId: "sess_001",
      lastSessionAt: "2026-01-30T18:45:00Z",
      proposals: [validProposal()],
      activeProjects: ["project-a"],
      checkpointRef: "checkpoint_001",
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid datetime for lastSessionAt", () => {
    const result = stateLayerSchema.safeParse({
      lastSessionAt: "last-tuesday",
      proposals: [],
      activeProjects: [],
    });
    expect(result.success).toBe(false);
  });

  test("parses with proposals in each status", () => {
    const statuses = ["pending", "accepted", "rejected"] as const;
    const proposals = statuses.map((status, i) => ({
      ...validProposal(),
      id: `prop_${i}`,
      status,
    }));
    const result = stateLayerSchema.safeParse({
      proposals,
      activeProjects: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("seedConfigSchema", () => {
  test("parses a complete valid seed", () => {
    const result = seedConfigSchema.safeParse(validSeedConfig());
    expect(result.success).toBe(true);
  });

  test("rejects missing version", () => {
    const data = { ...validSeedConfig() };
    delete (data as Record<string, unknown>).version;
    const result = seedConfigSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects non-semver version string", () => {
    const result = seedConfigSchema.safeParse({
      ...validSeedConfig(),
      version: "v1.0",
    });
    expect(result.success).toBe(false);
  });

  test("rejects version with prefix", () => {
    const result = seedConfigSchema.safeParse({
      ...validSeedConfig(),
      version: "v1.0.0",
    });
    expect(result.success).toBe(false);
  });

  test("accepts valid semver versions", () => {
    for (const version of ["1.0.0", "0.1.0", "10.20.30", "1.2.3"]) {
      const result = seedConfigSchema.safeParse({
        ...validSeedConfig(),
        version,
      });
      expect(result.success).toBe(true);
    }
  });

  test("allows unknown top-level keys with passthrough", () => {
    const data = {
      ...validSeedConfig(),
      futureField: "some-value",
      anotherField: 42,
    };
    const result = seedConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("composes all three layers correctly", () => {
    const data = {
      version: "1.0.0",
      identity: validIdentity(),
      learned: {
        patterns: [validLearning()],
        insights: [],
        selfKnowledge: [],
      },
      state: {
        lastSessionId: "sess_001",
        proposals: [validProposal()],
        activeProjects: ["pai-seed"],
      },
    };
    const result = seedConfigSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("type compilation: SeedConfig type is usable", () => {
    // This test verifies TypeScript types compile correctly
    const config: SeedConfig = validSeedConfig();
    expect(config.version).toBe("1.0.0");
    expect(config.identity.principalName).toBe("Jens-Christian");
    expect(config.learned.patterns).toEqual([]);
    expect(config.state.proposals).toEqual([]);
  });

  test("parses valid-seed.json fixture", async () => {
    const fixture = await import("./fixtures/valid-seed.json");
    const result = seedConfigSchema.safeParse(fixture.default);
    expect(result.success).toBe(true);
  });

  test("parses valid-seed-minimal.json fixture", async () => {
    const fixture = await import("./fixtures/valid-seed-minimal.json");
    const result = seedConfigSchema.safeParse(fixture.default);
    expect(result.success).toBe(true);
  });
});
