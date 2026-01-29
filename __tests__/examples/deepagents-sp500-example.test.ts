/**
 * Tests for the enhanced example (issue #22): DeepAgents + S&P 500.
 * Verifies that the ToolHub config used by the example discovers the tools
 * required for the S&P 500 analysis task (yahoo-finance, filesystem, system-time, web-search).
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { createAgentToolHub } from "../../src/toolhub-runtime.js";

const EXAMPLES_CONFIG = path.join(process.cwd(), "examples", "toolhub.yaml");

describe("enhanced example (DeepAgents S&P 500)", () => {
  afterEach(async () => {});

  it("example config discovers tools required for S&P 500 analysis", async () => {
    const hub = await createAgentToolHub(EXAMPLES_CONFIG);
    const registry = hub.getRegistry();
    const specs = registry.snapshot();
    await hub.shutdown();

    const names = specs.map((s) => s.name);
    expect(specs.length).toBeGreaterThanOrEqual(4);

    expect(names.some((n) => n.includes("yahoo-finance") || n.includes("yahoo_finance"))).toBe(true);
    expect(names.some((n) => n.includes("filesystem"))).toBe(true);
    expect(names.some((n) => n.includes("system-time") || n.includes("system_time"))).toBe(true);
    expect(names.some((n) => n.includes("search") || n.includes("web-search") || n.includes("web_search"))).toBe(true);
  });

  it("example config yields tools with descriptions for agent use", async () => {
    const hub = await createAgentToolHub(EXAMPLES_CONFIG);
    const specs = hub.getRegistry().snapshot();
    await hub.shutdown();

    const yahooSpec = specs.find((s) => s.name.includes("yahoo") && s.name.includes("finance"));
    expect(yahooSpec).toBeDefined();
    expect(yahooSpec?.description).toBeDefined();
    expect(String(yahooSpec?.description).length).toBeGreaterThan(0);
  });
});
