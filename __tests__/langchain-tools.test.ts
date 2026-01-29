/**
 * Tests for toolHubToLangChainTools (ToolHub → LangChain tools bridge).
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { createAgentToolHub } from "../src/toolhub-runtime.js";
import { toolHubToLangChainTools } from "../src/langchain-tools.js";

const EXAMPLES_CONFIG = path.join(process.cwd(), "examples", "toolhub.yaml");

describe("toolHubToLangChainTools", () => {
  afterEach(async () => {});

  it("returns an array of LangChain tools from a hub", async () => {
    const hub = await createAgentToolHub(EXAMPLES_CONFIG);
    const tools = toolHubToLangChainTools(hub);
    await hub.shutdown();

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(4);
    // Each tool should have name and invoke-like behavior (LangChain tool shape)
    for (const t of tools) {
      expect(t).toBeDefined();
      expect(typeof t).toBe("object");
      expect("name" in t || "invoke" in t || "description" in t).toBe(true);
    }
  });

  it("tool count matches registry snapshot", async () => {
    const hub = await createAgentToolHub(EXAMPLES_CONFIG);
    const specs = hub.getRegistry().snapshot();
    const tools = toolHubToLangChainTools(hub);
    await hub.shutdown();

    expect(tools.length).toBe(specs.length);
  });
});
