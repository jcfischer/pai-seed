/**
 * Generate the large-seed.json fixture for performance testing.
 * Run: bun tests/fixtures/generate-large-seed.ts
 */

function makeLearning(prefix: string, index: number) {
  return {
    id: `${prefix}_${String(index).padStart(4, "0")}`,
    content: `Learning content for ${prefix} item number ${index}. This is a realistic-length string that contains enough text to simulate real-world usage patterns and preferences.`,
    source: `session_2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
    extractedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
    ...(index % 3 === 0
      ? { confirmedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T${String((index + 1) % 24).padStart(2, "0")}:00:00Z` }
      : {}),
    confirmed: index % 3 === 0,
    tags: [`tag-${index % 10}`, `category-${index % 5}`],
  };
}

function makeProposal(index: number) {
  const types = ["pattern", "insight", "self_knowledge"] as const;
  const statuses = ["pending", "accepted", "rejected"] as const;
  return {
    id: `prop_${String(index).padStart(4, "0")}`,
    type: types[index % 3],
    content: `Proposal content number ${index}. This represents a learning candidate extracted from a session that needs user review and confirmation.`,
    source: `session_2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
    extractedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
    status: statuses[index % 3],
  };
}

const seed = {
  version: "1.0.0",
  identity: {
    principalName: "Daniel",
    aiName: "Ivy",
    catchphrase: "Ivy here, ready to go.",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    preferences: {
      responseStyle: "adaptive",
      timezone: "Europe/Zurich",
      locale: "en-US",
    },
  },
  learned: {
    patterns: Array.from({ length: 1000 }, (_, i) => makeLearning("pat", i)),
    insights: Array.from({ length: 500 }, (_, i) => makeLearning("ins", i)),
    selfKnowledge: Array.from({ length: 100 }, (_, i) => makeLearning("sk", i)),
  },
  state: {
    lastSessionId: "sess_perf_test",
    lastSessionAt: "2026-01-30T23:59:00Z",
    proposals: Array.from({ length: 100 }, (_, i) => makeProposal(i)),
    activeProjects: ["pai-seed", "reporter", "ragent", "scuol-notify", "kai-launcher"],
    checkpointRef: "checkpoint_perf_test",
  },
};

const output = JSON.stringify(seed, null, 2);
await Bun.write(
  new URL("./large-seed.json", import.meta.url).pathname,
  output
);

console.log(`Generated large-seed.json (${(output.length / 1024).toFixed(0)} KB)`);
console.log(`  Patterns: ${seed.learned.patterns.length}`);
console.log(`  Insights: ${seed.learned.insights.length}`);
console.log(`  SelfKnowledge: ${seed.learned.selfKnowledge.length}`);
console.log(`  Proposals: ${seed.state.proposals.length}`);
