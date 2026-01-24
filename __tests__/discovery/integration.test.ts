import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "../../src/registry/ToolRegistry.js";
import { Discovery } from "../../src/registry/Discovery.js";
import {
  createDirectoryDiscoverySource,
  DirectoryToolAdapter,
} from "../../src/discovery/DirectoryDiscoverySource.js";
import { MCPProcessManager } from "../../src/discovery/MCPProcessManager.js";

describe("Directory Discovery Integration", () => {
  let toolsRoot: string;
  let registry: ToolRegistry;
  let discovery: Discovery;

  beforeEach(async () => {
    toolsRoot = await mkdtemp(join(tmpdir(), "disc-integration-"));
    registry = new ToolRegistry();
    discovery = new Discovery(registry);
  });

  afterEach(async () => {
    discovery.dispose();
    await rm(toolsRoot, { recursive: true, force: true });
  });

  it("discovers tools via Discovery.addSource() with autoDiscover", async () => {
    // Create two MCP tools
    await mkdir(join(toolsRoot, "tool-a"));
    await writeFile(
      join(toolsRoot, "tool-a", "tool.json"),
      JSON.stringify({ kind: "mcp", description: "Tool A" }),
    );
    await writeFile(
      join(toolsRoot, "tool-a", "mcp.json"),
      JSON.stringify({ command: "cmd-a" }),
    );

    await mkdir(join(toolsRoot, "tool-b"));
    await writeFile(
      join(toolsRoot, "tool-b", "tool.json"),
      JSON.stringify({ kind: "mcp", description: "Tool B" }),
    );
    await writeFile(
      join(toolsRoot, "tool-b", "mcp.json"),
      JSON.stringify({ url: "https://b.example.com" }),
    );

    const source = createDirectoryDiscoverySource("test-source", {
      roots: [toolsRoot],
      namespace: "test",
      autoDiscover: false, // We'll call refresh manually
    });

    discovery.addSource(source);
    await discovery.refresh("test-source");

    expect(registry.has("test/tool-a")).toBe(true);
    expect(registry.has("test/tool-b")).toBe(true);
    expect(registry.get("test/tool-a")!.kind).toBe("mcp");
    expect(registry.get("test/tool-b")!.endpoint).toBe("https://b.example.com");
  });

  it("removes tools on source removal", async () => {
    await mkdir(join(toolsRoot, "removable"));
    await writeFile(
      join(toolsRoot, "removable", "tool.json"),
      JSON.stringify({ kind: "mcp" }),
    );
    await writeFile(
      join(toolsRoot, "removable", "mcp.json"),
      JSON.stringify({ command: "test" }),
    );

    const source = createDirectoryDiscoverySource("remove-test", {
      roots: [toolsRoot],
      namespace: "rm",
      autoDiscover: false,
    });

    discovery.addSource(source);
    await discovery.refresh("remove-test");
    expect(registry.has("rm/removable")).toBe(true);

    discovery.removeSource("remove-test");
    expect(registry.has("rm/removable")).toBe(false);
  });

  it("refreshes and picks up new tools", async () => {
    const source = createDirectoryDiscoverySource("refresh-test", {
      roots: [toolsRoot],
      namespace: "r",
      autoDiscover: false,
    });
    discovery.addSource(source);

    // Initial scan: empty
    await discovery.refresh("refresh-test");
    expect(registry.size).toBe(0);

    // Add a tool
    await mkdir(join(toolsRoot, "new-tool"));
    await writeFile(
      join(toolsRoot, "new-tool", "tool.json"),
      JSON.stringify({ kind: "mcp" }),
    );
    await writeFile(
      join(toolsRoot, "new-tool", "mcp.json"),
      JSON.stringify({ command: "new" }),
    );

    // Refresh picks it up
    await discovery.refresh("refresh-test");
    expect(registry.has("r/new-tool")).toBe(true);
  });

  it("unregisters tools that disappear on refresh", async () => {
    await mkdir(join(toolsRoot, "ephemeral"));
    await writeFile(
      join(toolsRoot, "ephemeral", "tool.json"),
      JSON.stringify({ kind: "mcp" }),
    );
    await writeFile(
      join(toolsRoot, "ephemeral", "mcp.json"),
      JSON.stringify({ command: "temp" }),
    );

    const source = createDirectoryDiscoverySource("unregister-test", {
      roots: [toolsRoot],
      namespace: "u",
      autoDiscover: false,
    });
    discovery.addSource(source);
    await discovery.refresh("unregister-test");
    expect(registry.has("u/ephemeral")).toBe(true);

    // Remove the tool directory
    await rm(join(toolsRoot, "ephemeral"), { recursive: true });

    // Refresh removes it
    await discovery.refresh("unregister-test");
    expect(registry.has("u/ephemeral")).toBe(false);
  });

  it("discovers mixed tool types", async () => {
    // MCP tool
    await mkdir(join(toolsRoot, "mcp-tool"));
    await writeFile(
      join(toolsRoot, "mcp-tool", "tool.json"),
      JSON.stringify({ kind: "mcp" }),
    );
    await writeFile(
      join(toolsRoot, "mcp-tool", "mcp.json"),
      JSON.stringify({ command: "mcp" }),
    );

    // n8n tool
    await mkdir(join(toolsRoot, "n8n-tool"));
    await writeFile(
      join(toolsRoot, "n8n-tool", "tool.json"),
      JSON.stringify({ kind: "n8n" }),
    );
    await writeFile(
      join(toolsRoot, "n8n-tool", "workflow.json"),
      JSON.stringify({ id: "wf-1", nodes: [{ id: "n1" }] }),
    );

    // LangChain tool
    await mkdir(join(toolsRoot, "lc-tool"));
    await writeFile(
      join(toolsRoot, "lc-tool", "tool.json"),
      JSON.stringify({ kind: "langchain" }),
    );
    await writeFile(
      join(toolsRoot, "lc-tool", "index.js"),
      `export default { invoke: async (x) => x };`,
    );

    // Skill tool (requires SKILL.md)
    await mkdir(join(toolsRoot, "skill-tool"));
    await writeFile(
      join(toolsRoot, "skill-tool", "tool.json"),
      JSON.stringify({ kind: "skill" }),
    );
    await writeFile(
      join(toolsRoot, "skill-tool", "SKILL.md"),
      `---\nname: skill-tool\ndescription: A test skill\n---\n\n# Skill\n`,
    );
    await writeFile(
      join(toolsRoot, "skill-tool", "handler.js"),
      `export default async function(args) { return { result: args }; }`,
    );

    const source = createDirectoryDiscoverySource("mixed", {
      roots: [toolsRoot],
      namespace: "mix",
      autoDiscover: false,
    });
    discovery.addSource(source);
    await discovery.refresh("mixed");

    expect(registry.size).toBe(4);
    expect(registry.get("mix/mcp-tool")!.kind).toBe("mcp");
    expect(registry.get("mix/n8n-tool")!.kind).toBe("n8n");
    expect(registry.get("mix/lc-tool")!.kind).toBe("langchain");
    expect(registry.get("skill-tool")!.kind).toBe("skill");
  });

  it("searchable by kind after discovery", async () => {
    await mkdir(join(toolsRoot, "searchable"));
    await writeFile(
      join(toolsRoot, "searchable", "tool.json"),
      JSON.stringify({ kind: "mcp", tags: ["search-test"] }),
    );
    await writeFile(
      join(toolsRoot, "searchable", "mcp.json"),
      JSON.stringify({ command: "s" }),
    );

    const source = createDirectoryDiscoverySource("search-test", {
      roots: [toolsRoot],
      namespace: "s",
      autoDiscover: false,
    });
    discovery.addSource(source);
    await discovery.refresh("search-test");

    const results = registry.search({ kind: "mcp" });
    expect(results.some((s) => s.name === "s/searchable")).toBe(true);

    const byTag = registry.search({ tags: ["search-test"] });
    expect(byTag).toHaveLength(1);
  });
});

describe("DirectoryToolAdapter", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await mkdtemp(join(tmpdir(), "adapter-test-"));
  });

  afterEach(async () => {
    await rm(toolsRoot, { recursive: true, force: true });
  });

  it("listTools returns discovered specs", async () => {
    await mkdir(join(toolsRoot, "t1"));
    await writeFile(
      join(toolsRoot, "t1", "tool.json"),
      JSON.stringify({ kind: "mcp" }),
    );
    await writeFile(
      join(toolsRoot, "t1", "mcp.json"),
      JSON.stringify({ command: "x" }),
    );

    const adapter = new DirectoryToolAdapter({ roots: [toolsRoot] });
    const specs = await adapter.listTools();

    expect(specs).toHaveLength(1);
  });

  it("invoke throws (not for direct use)", async () => {
    const adapter = new DirectoryToolAdapter({ roots: [toolsRoot] });
    await expect(
      adapter.invoke({} as any, {}, {} as any),
    ).rejects.toThrow("should not be called directly");
  });
});

describe("MCPProcessManager", () => {
  it("returns URL connection info", () => {
    const manager = new MCPProcessManager();
    const info = manager.getConnectionInfo("remote", { url: "https://example.com" });
    expect(info.type).toBe("url");
    expect(info.url).toBe("https://example.com");
  });

  it("returns stdio connection info", () => {
    const manager = new MCPProcessManager();
    const info = manager.getConnectionInfo("local", {
      command: "node",
      args: ["server.js"],
      env: { KEY: "val" },
    });
    expect(info.type).toBe("stdio");
    expect(info.command).toBe("node");
    expect(info.args).toEqual(["server.js"]);
    expect(info.env).toEqual({ KEY: "val" });
  });

  it("caches connection info", () => {
    const manager = new MCPProcessManager();
    const info1 = manager.getConnectionInfo("t", { command: "x" });
    const info2 = manager.getConnectionInfo("t", { command: "y" }); // Different config, same name
    expect(info1).toBe(info2); // Same object (cached)
  });

  it("removes cached info", () => {
    const manager = new MCPProcessManager();
    manager.getConnectionInfo("t", { command: "x" });
    expect(manager.getToolNames()).toContain("t");
    manager.remove("t");
    expect(manager.getToolNames()).not.toContain("t");
  });

  it("dispose clears all", () => {
    const manager = new MCPProcessManager();
    manager.getConnectionInfo("a", { command: "x" });
    manager.getConnectionInfo("b", { url: "http://y" });
    manager.dispose();
    expect(manager.getToolNames()).toHaveLength(0);
  });
});
