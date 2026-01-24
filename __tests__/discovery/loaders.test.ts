import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMCPTool } from "../../src/discovery/loaders/MCPLoader.js";
import { loadN8nTool } from "../../src/discovery/loaders/N8nLoader.js";
import { loadLangChainTool } from "../../src/discovery/loaders/LangChainLoader.js";
import { loadSkillTool } from "../../src/discovery/loaders/SkillLoader.js";
import { resolveEntryPoint } from "../../src/discovery/loaders/resolveEntry.js";
import { DiscoveryError } from "../../src/discovery/errors.js";
import type { ToolManifest } from "../../src/discovery/types.js";

describe("resolveEntryPoint", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "entry-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves .js extension", async () => {
    await writeFile(join(dir, "index.js"), "");
    const result = await resolveEntryPoint(dir, "index");
    expect(result).toBe(join(dir, "index.js"));
  });

  it("resolves .mjs extension", async () => {
    await writeFile(join(dir, "handler.mjs"), "");
    const result = await resolveEntryPoint(dir, "handler");
    expect(result).toBe(join(dir, "handler.mjs"));
  });

  it("resolves with explicit extension", async () => {
    await writeFile(join(dir, "custom.mjs"), "");
    const result = await resolveEntryPoint(dir, "custom.mjs");
    expect(result).toBe(join(dir, "custom.mjs"));
  });

  it("throws when file not found", async () => {
    await expect(
      resolveEntryPoint(dir, "missing"),
    ).rejects.toThrow("Could not find entry point");
  });

  it("respects priority order (.js before .mjs)", async () => {
    await writeFile(join(dir, "both.js"), "");
    await writeFile(join(dir, "both.mjs"), "");
    const result = await resolveEntryPoint(dir, "both");
    expect(result).toBe(join(dir, "both.js"));
  });
});

describe("MCPLoader", () => {
  let dir: string;
  const baseManifest: ToolManifest = { kind: "mcp" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-loader-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads command-based config", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({ command: "node", args: ["server.js"] }),
    );

    const result = await loadMCPTool(dir, baseManifest);
    expect(result.mcpConfig).toEqual({ command: "node", args: ["server.js"] });
  });

  it("loads URL-based config", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({ url: "https://remote.example.com" }),
    );

    const result = await loadMCPTool(dir, baseManifest);
    expect(result.mcpConfig).toEqual({ url: "https://remote.example.com" });
  });

  it("loads config with env variables", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({ command: "mcp-server", env: { API_KEY: "secret" } }),
    );

    const result = await loadMCPTool(dir, baseManifest);
    expect(result.mcpConfig!.env).toEqual({ API_KEY: "secret" });
  });

  it("throws DiscoveryError on missing file", async () => {
    await expect(loadMCPTool(dir, baseManifest)).rejects.toBeInstanceOf(
      DiscoveryError,
    );
  });

  it("throws DiscoveryError on invalid JSON", async () => {
    await writeFile(join(dir, "mcp.json"), "not{json");
    await expect(loadMCPTool(dir, baseManifest)).rejects.toBeInstanceOf(
      DiscoveryError,
    );
  });

  it("throws DiscoveryError when missing command and url", async () => {
    await writeFile(join(dir, "mcp.json"), JSON.stringify({ env: {} }));
    const err = await loadMCPTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("validate");
  });

  it("loads Cursor-format mcpServers wrapper with command", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "my-server": { command: "npx", args: ["-y", "mcp-tool"] },
        },
      }),
    );

    const result = await loadMCPTool(dir, baseManifest);
    expect(result.mcpConfig).toEqual({ command: "npx", args: ["-y", "mcp-tool"] });
  });

  it("loads Cursor-format mcpServers wrapper with url", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "remote": { url: "https://mcp.example.com" },
        },
      }),
    );

    const result = await loadMCPTool(dir, baseManifest);
    expect(result.mcpConfig).toEqual({ url: "https://mcp.example.com" });
  });

  it("selects matching server name from Cursor-format when manifest has name", async () => {
    const manifest: ToolManifest = { kind: "mcp", name: "local/target" };
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "other": { command: "other-cmd" },
          "target": { command: "target-cmd", args: ["--flag"] },
        },
      }),
    );

    const result = await loadMCPTool(dir, manifest);
    expect(result.mcpConfig).toEqual({ command: "target-cmd", args: ["--flag"] });
  });

  it("falls back to first server in Cursor-format when name does not match", async () => {
    const manifest: ToolManifest = { kind: "mcp", name: "local/nomatch" };
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "first": { command: "first-cmd" },
          "second": { url: "https://second.com" },
        },
      }),
    );

    const result = await loadMCPTool(dir, manifest);
    expect(result.mcpConfig).toEqual({ command: "first-cmd" });
  });

  it("throws DiscoveryError on Cursor-format with empty mcpServers", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({ mcpServers: {} }),
    );

    const err = await loadMCPTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("validate");
  });

  it("loads Cursor-format with env variables", async () => {
    await writeFile(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "with-env": {
            command: "mcp-server",
            args: ["--port", "3000"],
            env: { API_KEY: "secret", NODE_ENV: "production" },
          },
        },
      }),
    );

    const result = await loadMCPTool(dir, baseManifest);
    expect(result.mcpConfig!.command).toBe("mcp-server");
    expect(result.mcpConfig!.args).toEqual(["--port", "3000"]);
    expect(result.mcpConfig!.env).toEqual({ API_KEY: "secret", NODE_ENV: "production" });
  });
});

describe("N8nLoader", () => {
  let dir: string;
  const baseManifest: ToolManifest = { kind: "n8n" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "n8n-loader-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads valid workflow", async () => {
    const workflow = { id: "wf-1", nodes: [{ id: "n1", type: "webhook" }] };
    await writeFile(join(dir, "workflow.json"), JSON.stringify(workflow));

    const result = await loadN8nTool(dir, baseManifest);
    expect(result.workflowDef).toEqual(workflow);
  });

  it("throws DiscoveryError on missing file", async () => {
    await expect(loadN8nTool(dir, baseManifest)).rejects.toBeInstanceOf(
      DiscoveryError,
    );
  });

  it("throws DiscoveryError on invalid JSON", async () => {
    await writeFile(join(dir, "workflow.json"), "bad");
    await expect(loadN8nTool(dir, baseManifest)).rejects.toBeInstanceOf(
      DiscoveryError,
    );
  });

  it("throws DiscoveryError on missing nodes array", async () => {
    await writeFile(join(dir, "workflow.json"), JSON.stringify({ id: "wf" }));
    const err = await loadN8nTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("validate");
  });

  it("respects custom entryPoint", async () => {
    const manifest: ToolManifest = { kind: "n8n", entryPoint: "custom.json" };
    await writeFile(
      join(dir, "custom.json"),
      JSON.stringify({ nodes: [{ id: "n1" }] }),
    );

    const result = await loadN8nTool(dir, manifest);
    expect(result.workflowDef).toBeDefined();
  });
});

describe("LangChainLoader", () => {
  let dir: string;
  const baseManifest: ToolManifest = { kind: "langchain" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lc-loader-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads tool with default export", async () => {
    await writeFile(
      join(dir, "index.js"),
      `export default { name: "test", invoke: async (x) => x };`,
    );

    const result = await loadLangChainTool(dir, baseManifest);
    expect(result.impl).toBeDefined();
    expect(typeof (result.impl as any).invoke).toBe("function");
  });

  it("loads tool with named 'tool' export", async () => {
    await writeFile(
      join(dir, "index.js"),
      `export const tool = { name: "named", invoke: async (x) => x };`,
    );

    const result = await loadLangChainTool(dir, baseManifest);
    expect((result.impl as any).name).toBe("named");
  });

  it("throws DiscoveryError on missing invoke()", async () => {
    await writeFile(
      join(dir, "index.js"),
      `export default { name: "no-invoke" };`,
    );

    const err = await loadLangChainTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("validate");
  });

  it("throws DiscoveryError on missing entry file", async () => {
    const err = await loadLangChainTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("load");
  });

  it("resolves .mjs extension", async () => {
    await writeFile(
      join(dir, "index.mjs"),
      `export default { invoke: async (x) => x };`,
    );

    const result = await loadLangChainTool(dir, baseManifest);
    expect(result.impl).toBeDefined();
  });
});

describe("SkillLoader", () => {
  let dir: string;
  const baseManifest: ToolManifest = { kind: "skill" };
  const skillMdContent = `---\nname: test-skill\ndescription: A test skill\n---\n\n# Test\n`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-loader-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads skill with SKILL.md and handler (default export)", async () => {
    await writeFile(join(dir, "SKILL.md"), skillMdContent);
    await writeFile(
      join(dir, "handler.js"),
      `export default async function(args) { return { result: args }; }`,
    );

    const result = await loadSkillTool(dir, baseManifest);
    expect(result.skillDefinition).toBeDefined();
    expect(result.skillDefinition!.frontmatter.name).toBe("test-skill");
    expect(typeof result.impl).toBe("function");
  });

  it("loads skill with SKILL.md and handler (named export)", async () => {
    await writeFile(join(dir, "SKILL.md"), skillMdContent);
    await writeFile(
      join(dir, "handler.js"),
      `export async function handler(args) { return { result: args }; }`,
    );

    const result = await loadSkillTool(dir, baseManifest);
    expect(result.skillDefinition).toBeDefined();
    expect(typeof result.impl).toBe("function");
  });

  it("loads skill with SKILL.md and no handler (instruction-only)", async () => {
    await writeFile(join(dir, "SKILL.md"), skillMdContent);

    const result = await loadSkillTool(dir, baseManifest);
    expect(result.skillDefinition).toBeDefined();
    expect(result.skillDefinition!.frontmatter.name).toBe("test-skill");
    expect(result.impl).toBeUndefined();
  });

  it("throws DiscoveryError when SKILL.md is missing", async () => {
    const err = await loadSkillTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("load");
  });

  it("throws DiscoveryError when SKILL.md has invalid frontmatter", async () => {
    await writeFile(join(dir, "SKILL.md"), "# No frontmatter here");
    const err = await loadSkillTool(dir, baseManifest).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.phase).toBe("load");
  });
});
