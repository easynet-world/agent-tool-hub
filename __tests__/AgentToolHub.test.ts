import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { AgentToolHub, createAgentToolHub } from "../src/toolhub-runtime.js";

const FIXTURE_CONFIG = path.join(
  process.cwd(),
  "__tests__",
  "fixtures",
  "cli-toolhub.yaml",
);

describe("AgentToolHub", () => {
  afterEach(async () => {
    // No shared hub to shut down; each test creates its own
  });

  it("constructor with no args uses default config path (toolhub.yaml in cwd)", () => {
    const hub = new AgentToolHub();
    const configPath = hub.getConfigPath();
    expect(configPath).toMatch(/toolhub\.yaml$/);
    expect(path.isAbsolute(configPath)).toBe(true);
  });

  it("constructor with config path resolves to absolute path", () => {
    const hub = new AgentToolHub("foo/toolhub.yaml");
    const configPath = hub.getConfigPath();
    expect(path.isAbsolute(configPath)).toBe(true);
    expect(configPath).toMatch(/foo[\\/]toolhub\.yaml$/);
  });

  it("methods throw before init()", () => {
    const hub = new AgentToolHub(FIXTURE_CONFIG);
    expect(() => hub.listToolMetadata()).toThrow(/not initialized|init\(\)/i);
    expect(() => hub.getRegistry()).toThrow(/not initialized|init\(\)/i);
  });

  it("init() loads config and discovers tools; listToolMetadata works after init", async () => {
    const hub = new AgentToolHub(FIXTURE_CONFIG);
    await hub.init();
    const meta = hub.listToolMetadata();
    expect(Array.isArray(meta)).toBe(true);
    expect(meta.length).toBeGreaterThanOrEqual(0);
    await hub.shutdown();
  });

  it("createAgentToolHub(configPath) returns initialized AgentToolHub", async () => {
    const hub = await createAgentToolHub(FIXTURE_CONFIG);
    expect(hub).toBeInstanceOf(AgentToolHub);
    expect(hub.getConfigPath()).toBe(path.resolve(process.cwd(), FIXTURE_CONFIG));
    const meta = hub.listToolMetadata();
    expect(Array.isArray(meta)).toBe(true);
    await hub.shutdown();
  });

  it("shutdown() clears hub; subsequent calls throw", async () => {
    const hub = new AgentToolHub(FIXTURE_CONFIG);
    await hub.init();
    await hub.shutdown();
    expect(() => hub.listToolMetadata()).toThrow(/not initialized|init\(\)/i);
  });
});
