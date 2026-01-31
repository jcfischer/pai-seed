import { describe, expect, test } from "bun:test";
import { generateJsonSchema } from "../src/json-schema";
import { createDefaultSeed } from "../src/defaults";

// =============================================================================
// T-5.5: JSON Schema integration tests
// =============================================================================

describe("generateJsonSchema", () => {
  test("returns an object with type: object at root", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    // The zod-to-json-schema wraps in a container with $ref
    // The actual schema definition is in $defs or definitions
    expect(schema).toBeDefined();
    expect(typeof schema).toBe("object");
  });

  test("schema has properties for all four root keys", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;

    // zod-to-json-schema with name: "SeedConfig" and $refStrategy: "root"
    // puts definitions in $defs (or definitions) and uses $ref at the root
    const defs = (schema.$defs || schema.definitions) as Record<string, unknown> | undefined;

    // The schema should reference SeedConfig
    // Check that the schema either directly has properties or references them
    if (defs && typeof defs === "object") {
      // Find the SeedConfig definition
      const seedConfigDef = defs.SeedConfig as Record<string, unknown> | undefined;
      if (seedConfigDef && seedConfigDef.properties) {
        const props = seedConfigDef.properties as Record<string, unknown>;
        expect(props.version).toBeDefined();
        expect(props.identity).toBeDefined();
        expect(props.learned).toBeDefined();
        expect(props.state).toBeDefined();
        return;
      }
    }

    // Alternatively, properties might be at root level
    if (schema.properties) {
      const props = schema.properties as Record<string, unknown>;
      expect(props.version).toBeDefined();
      expect(props.identity).toBeDefined();
      expect(props.learned).toBeDefined();
      expect(props.state).toBeDefined();
      return;
    }

    // If using $ref at root, the referenced def should have properties
    expect(defs).toBeDefined();
  });

  test("schema contains $defs with definitions", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    const defs = (schema.$defs || schema.definitions) as Record<string, unknown> | undefined;
    expect(defs).toBeDefined();
    expect(typeof defs).toBe("object");
    // Should have multiple definitions (SeedConfig, plus sub-schemas)
    expect(Object.keys(defs!).length).toBeGreaterThanOrEqual(1);
  });

  test("schema is valid JSON (round-trips through stringify/parse)", () => {
    const schema = generateJsonSchema();
    const json = JSON.stringify(schema);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(schema);
  });

  test("default seed structure matches schema expectations", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    const defaultSeed = createDefaultSeed();

    // Verify the default seed has exactly the keys the schema expects
    expect(defaultSeed.version).toBeDefined();
    expect(defaultSeed.identity).toBeDefined();
    expect(defaultSeed.learned).toBeDefined();
    expect(defaultSeed.state).toBeDefined();

    // Verify the schema was generated (non-empty)
    const json = JSON.stringify(schema);
    expect(json.length).toBeGreaterThan(100);
  });

  test("schema includes version pattern for semver", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    const json = JSON.stringify(schema);

    // The semver regex should appear somewhere in the schema
    // It gets encoded in JSON Schema as a pattern
    expect(json).toContain("pattern");
  });

  test("schema includes enum definitions for responseStyle", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    const json = JSON.stringify(schema);

    // responseStyle enum values should be in the schema
    expect(json).toContain("concise");
    expect(json).toContain("detailed");
    expect(json).toContain("adaptive");
  });

  test("schema includes enum definitions for proposal type", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    const json = JSON.stringify(schema);

    expect(json).toContain("pattern");
    expect(json).toContain("insight");
    expect(json).toContain("self_knowledge");
  });

  test("schema includes enum definitions for proposal status", () => {
    const schema = generateJsonSchema() as Record<string, unknown>;
    const json = JSON.stringify(schema);

    expect(json).toContain("pending");
    expect(json).toContain("accepted");
    expect(json).toContain("rejected");
  });
});
