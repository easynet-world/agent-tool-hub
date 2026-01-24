import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";

describe("DirectoryScanner", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await mkdtemp(join(tmpdir(), "scanner-test-"));
  });

  afterEach(async () => {
    await rm(toolsRoot, { recursive: true, force: true });
  });

  describe("MCP tools", () => {
    it("discovers command-based MCP tool", async () => {
      await mkdir(join(toolsRoot, "my-mcp"));
      await writeFile(
        join(toolsRoot, "my-mcp", "tool.json"),
        JSON.stringify({ kind: "mcp", description: "Test MCP" }),
      );
      await writeFile(
        join(toolsRoot, "my-mcp", "mcp.json"),
        JSON.stringify({ command: "npx", args: ["-y", "test-mcp"] }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.name).toBe("dir/my-mcp");
      expect(specs[0]!.kind).toBe("mcp");
      expect(specs[0]!.description).toBe("Test MCP");
      expect(specs[0]!.impl).toEqual({ command: "npx", args: ["-y", "test-mcp"] });
    });

    it("discovers URL-based MCP tool", async () => {
      await mkdir(join(toolsRoot, "remote-mcp"));
      await writeFile(
        join(toolsRoot, "remote-mcp", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "remote-mcp", "mcp.json"),
        JSON.stringify({ url: "https://mcp.example.com" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.endpoint).toBe("https://mcp.example.com");
      expect(specs[0]!.impl).toEqual({ url: "https://mcp.example.com" });
    });

    it("throws on mcp.json missing command and url", async () => {
      await mkdir(join(toolsRoot, "bad-mcp"));
      await writeFile(
        join(toolsRoot, "bad-mcp", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "bad-mcp", "mcp.json"),
        JSON.stringify({ env: { FOO: "bar" } }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("command");
    });

    it("uses custom entryPoint for mcp config", async () => {
      await mkdir(join(toolsRoot, "custom-mcp"));
      await writeFile(
        join(toolsRoot, "custom-mcp", "tool.json"),
        JSON.stringify({ kind: "mcp", entryPoint: "server.json" }),
      );
      await writeFile(
        join(toolsRoot, "custom-mcp", "server.json"),
        JSON.stringify({ command: "node", args: ["server.js"] }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.impl).toEqual({ command: "node", args: ["server.js"] });
    });
  });

  describe("n8n tools", () => {
    it("discovers n8n workflow tool", async () => {
      await mkdir(join(toolsRoot, "my-workflow"));
      await writeFile(
        join(toolsRoot, "my-workflow", "tool.json"),
        JSON.stringify({ kind: "n8n", description: "My workflow" }),
      );
      await writeFile(
        join(toolsRoot, "my-workflow", "workflow.json"),
        JSON.stringify({ id: "wf-123", name: "Test", nodes: [{ id: "n1", type: "webhook" }] }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.kind).toBe("n8n");
      expect(specs[0]!.resourceId).toBe("wf-123");
    });

    it("throws on workflow.json without nodes", async () => {
      await mkdir(join(toolsRoot, "bad-n8n"));
      await writeFile(
        join(toolsRoot, "bad-n8n", "tool.json"),
        JSON.stringify({ kind: "n8n" }),
      );
      await writeFile(
        join(toolsRoot, "bad-n8n", "workflow.json"),
        JSON.stringify({ id: "wf-bad", name: "NoNodes" }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("nodes");
    });
  });

  describe("LangChain tools", () => {
    it("discovers LangChain tool with index.js", async () => {
      await mkdir(join(toolsRoot, "lc-tool"));
      await writeFile(
        join(toolsRoot, "lc-tool", "tool.json"),
        JSON.stringify({ kind: "langchain", description: "LC Tool" }),
      );
      await writeFile(
        join(toolsRoot, "lc-tool", "index.js"),
        `export default { name: "lc", invoke: async (input) => ({ result: input }) };`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.kind).toBe("langchain");
      expect(specs[0]!.impl).toBeDefined();
      expect(typeof (specs[0]!.impl as any).invoke).toBe("function");
    });

    it("discovers multiple LangChain tools in langchain folder", async () => {
      await mkdir(join(toolsRoot, "multi-lc", "langchain"), { recursive: true });
      await writeFile(
        join(toolsRoot, "multi-lc", "langchain", "alpha.js"),
        `export default { name: "alpha", invoke: async (input) => input };`,
      );
      await writeFile(
        join(toolsRoot, "multi-lc", "langchain", "beta.js"),
        `export default { name: "beta", invoke: async (input) => input };`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot], namespace: "local" });
      const specs = await scanner.scan();
      const names = specs.map((spec) => spec.name);

      expect(names).toContain("local/alpha");
      expect(names).toContain("local/beta");
    });

    it("throws on missing entry point", async () => {
      await mkdir(join(toolsRoot, "no-index"));
      await writeFile(
        join(toolsRoot, "no-index", "tool.json"),
        JSON.stringify({ kind: "langchain" }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });

    it("throws on entry point without invoke()", async () => {
      await mkdir(join(toolsRoot, "bad-lc"));
      await writeFile(
        join(toolsRoot, "bad-lc", "tool.json"),
        JSON.stringify({ kind: "langchain" }),
      );
      await writeFile(
        join(toolsRoot, "bad-lc", "index.js"),
        `export default { name: "bad" };`,
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("invoke");
    });

    it("extracts schema from LangChain tool instance", async () => {
      await mkdir(join(toolsRoot, "schema-lc"));
      await writeFile(
        join(toolsRoot, "schema-lc", "tool.json"),
        JSON.stringify({ kind: "langchain" }),
      );
      await writeFile(
        join(toolsRoot, "schema-lc", "index.js"),
        `export default {
          name: "schemaed",
          schema: { type: "object", properties: { x: { type: "number" } } },
          invoke: async (input) => input,
        };`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect((specs[0]!.inputSchema as any).properties.x.type).toBe("number");
    });
  });

  describe("Skill tools", () => {
    it("discovers Skill tool with SKILL.md and handler", async () => {
      await mkdir(join(toolsRoot, "my-skill"));
      await writeFile(
        join(toolsRoot, "my-skill", "tool.json"),
        JSON.stringify({ kind: "skill" }),
      );
      await writeFile(
        join(toolsRoot, "my-skill", "SKILL.md"),
        `---\nname: my-skill\ndescription: My skill description\n---\n\n# My Skill\n\nDo the thing.\n`,
      );
      await writeFile(
        join(toolsRoot, "my-skill", "handler.js"),
        `export default async function(args, ctx) { return { result: args }; }`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.kind).toBe("skill");
      expect(specs[0]!.name).toBe("my-skill");
      expect(specs[0]!.description).toBe("My skill description");
    });

    it("discovers instruction-only Skill (no handler)", async () => {
      await mkdir(join(toolsRoot, "info-skill"));
      await writeFile(
        join(toolsRoot, "info-skill", "tool.json"),
        JSON.stringify({ kind: "skill" }),
      );
      await writeFile(
        join(toolsRoot, "info-skill", "SKILL.md"),
        `---\nname: info-skill\ndescription: Provides information\n---\n\n# Info\n\nHere is info.\n`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.kind).toBe("skill");
      expect(specs[0]!.name).toBe("info-skill");
    });

    it("reports error when SKILL.md is missing", async () => {
      await mkdir(join(toolsRoot, "bad-skill"));
      await writeFile(
        join(toolsRoot, "bad-skill", "tool.json"),
        JSON.stringify({ kind: "skill" }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("SKILL.md");
    });
  });

  describe("General behavior", () => {
    it("infers tool kind without tool.json", async () => {
      await mkdir(join(toolsRoot, "infer-mcp"));
      await writeFile(
        join(toolsRoot, "infer-mcp", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot], namespace: "auto" });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.kind).toBe("mcp");
      expect(specs[0]!.name).toBe("auto/infer-mcp");
    });
    it("discovers tools in nested directories", async () => {
      await mkdir(join(toolsRoot, "nested", "tool-a"), { recursive: true });
      await writeFile(
        join(toolsRoot, "nested", "tool-a", "tool.json"),
        JSON.stringify({ kind: "mcp", name: "nested/tool-a" }),
      );
      await writeFile(
        join(toolsRoot, "nested", "tool-a", "mcp.json"),
        JSON.stringify({ command: "nested-cmd" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.name).toBe("nested/tool-a");
      expect(specs[0]!.kind).toBe("mcp");
    });

    it("skips directories without tool.json", async () => {
      await mkdir(join(toolsRoot, "not-a-tool"));
      await writeFile(join(toolsRoot, "not-a-tool", "readme.md"), "# Not a tool");

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
    });

    it("skips disabled tools", async () => {
      await mkdir(join(toolsRoot, "disabled-tool"));
      await writeFile(
        join(toolsRoot, "disabled-tool", "tool.json"),
        JSON.stringify({ kind: "mcp", enabled: false }),
      );
      await writeFile(
        join(toolsRoot, "disabled-tool", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
    });

    it("uses manifest name override", async () => {
      await mkdir(join(toolsRoot, "dir-name"));
      await writeFile(
        join(toolsRoot, "dir-name", "tool.json"),
        JSON.stringify({ kind: "mcp", name: "custom/name" }),
      );
      await writeFile(
        join(toolsRoot, "dir-name", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs[0]!.name).toBe("custom/name");
    });

    it("respects custom namespace", async () => {
      await mkdir(join(toolsRoot, "my-tool"));
      await writeFile(
        join(toolsRoot, "my-tool", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "my-tool", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot], namespace: "local" });
      const specs = await scanner.scan();

      expect(specs[0]!.name).toBe("local/my-tool");
    });

    it("scans multiple roots", async () => {
      const root2 = await mkdtemp(join(tmpdir(), "scanner-test2-"));
      try {
        await mkdir(join(toolsRoot, "tool-a"));
        await writeFile(
          join(toolsRoot, "tool-a", "tool.json"),
          JSON.stringify({ kind: "mcp" }),
        );
        await writeFile(
          join(toolsRoot, "tool-a", "mcp.json"),
          JSON.stringify({ command: "a" }),
        );

        await mkdir(join(root2, "tool-b"));
        await writeFile(
          join(root2, "tool-b", "tool.json"),
          JSON.stringify({ kind: "mcp" }),
        );
        await writeFile(
          join(root2, "tool-b", "mcp.json"),
          JSON.stringify({ command: "b" }),
        );

        const scanner = new DirectoryScanner({ roots: [toolsRoot, root2] });
        const specs = await scanner.scan();

        expect(specs).toHaveLength(2);
        const names = specs.map((s) => s.name);
        expect(names).toContain("dir/tool-a");
        expect(names).toContain("dir/tool-b");
      } finally {
        await rm(root2, { recursive: true, force: true });
      }
    });

    it("reports invalid JSON in tool.json via onError", async () => {
      await mkdir(join(toolsRoot, "bad-json"));
      await writeFile(join(toolsRoot, "bad-json", "tool.json"), "not json {{{");

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });

    it("reports missing kind field via onError", async () => {
      await mkdir(join(toolsRoot, "no-kind"));
      await writeFile(
        join(toolsRoot, "no-kind", "tool.json"),
        JSON.stringify({ description: "no kind" }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("kind");
    });

    it("reports unknown kind via onError", async () => {
      await mkdir(join(toolsRoot, "unknown-kind"));
      await writeFile(
        join(toolsRoot, "unknown-kind", "tool.json"),
        JSON.stringify({ kind: "comfyui" }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });

    it("continues scanning after individual tool failure", async () => {
      // Bad tool
      await mkdir(join(toolsRoot, "aaa-bad"));
      await writeFile(
        join(toolsRoot, "aaa-bad", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "aaa-bad", "mcp.json"),
        JSON.stringify({}), // Missing command/url
      );

      // Good tool
      await mkdir(join(toolsRoot, "zzz-good"));
      await writeFile(
        join(toolsRoot, "zzz-good", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "zzz-good", "mcp.json"),
        JSON.stringify({ command: "good" }),
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.name).toBe("dir/zzz-good");
      expect(errors).toHaveLength(1);
    });

    it("preserves manifest metadata (tags, capabilities, version, costHints)", async () => {
      await mkdir(join(toolsRoot, "meta-tool"));
      await writeFile(
        join(toolsRoot, "meta-tool", "tool.json"),
        JSON.stringify({
          kind: "mcp",
          version: "2.1.0",
          tags: ["test", "example"],
          capabilities: ["network", "read:web"],
          costHints: { latencyMsP50: 100 },
        }),
      );
      await writeFile(
        join(toolsRoot, "meta-tool", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs[0]!.version).toBe("2.1.0");
      expect(specs[0]!.tags).toEqual(["test", "example"]);
      expect(specs[0]!.capabilities).toEqual(["network", "read:web"]);
      expect(specs[0]!.costHints).toEqual({ latencyMsP50: 100 });
    });

    it("handles non-existent root directory gracefully", async () => {
      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: ["/nonexistent/path/xyz"],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });

    it("ignores files in root (only processes directories)", async () => {
      await writeFile(join(toolsRoot, "readme.txt"), "not a directory");
      await mkdir(join(toolsRoot, "real-tool"));
      await writeFile(
        join(toolsRoot, "real-tool", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "real-tool", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.name).toBe("dir/real-tool");
    });
  });

  describe("Multi-kind toolsets (nested kind-subdirectories)", () => {
    it("discovers multiple kinds within a single toolset directory", async () => {
      // toolset-name/mcp/tool.json + toolset-name/langchain/tool.json
      await mkdir(join(toolsRoot, "my-toolset", "mcp"), { recursive: true });
      await writeFile(
        join(toolsRoot, "my-toolset", "mcp", "tool.json"),
        JSON.stringify({ kind: "mcp", name: "local/my-toolset-mcp" }),
      );
      await writeFile(
        join(toolsRoot, "my-toolset", "mcp", "mcp.json"),
        JSON.stringify({ command: "test-server" }),
      );

      await mkdir(join(toolsRoot, "my-toolset", "langchain"), { recursive: true });
      await writeFile(
        join(toolsRoot, "my-toolset", "langchain", "tool.json"),
        JSON.stringify({ kind: "langchain", name: "local/my-toolset-langchain" }),
      );
      await writeFile(
        join(toolsRoot, "my-toolset", "langchain", "index.js"),
        `export default { name: "my-lc", invoke: async (input) => ({ result: input }) };`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(2);
      const names = specs.map((s) => s.name);
      expect(names).toContain("local/my-toolset-mcp");
      expect(names).toContain("local/my-toolset-langchain");
    });

    it("uses toolset directory name for namespace when no name in manifest", async () => {
      await mkdir(join(toolsRoot, "calculator", "mcp"), { recursive: true });
      await writeFile(
        join(toolsRoot, "calculator", "mcp", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "calculator", "mcp", "mcp.json"),
        JSON.stringify({ command: "calc-server" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot], namespace: "local" });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      // Should use toolset dir name + kind suffix to avoid collisions
      expect(specs[0]!.name).toBe("local/calculator-mcp");
    });

    it("skips nested dirs without tool.json silently", async () => {
      await mkdir(join(toolsRoot, "my-toolset", "docs"), { recursive: true });
      await writeFile(join(toolsRoot, "my-toolset", "docs", "README.md"), "# Docs");

      await mkdir(join(toolsRoot, "my-toolset", "mcp"), { recursive: true });
      await writeFile(
        join(toolsRoot, "my-toolset", "mcp", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "my-toolset", "mcp", "mcp.json"),
        JSON.stringify({ command: "test" }),
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(1);
      expect(specs[0]!.kind).toBe("mcp");
    });

    it("reports errors in nested kind dirs via onError", async () => {
      await mkdir(join(toolsRoot, "my-toolset", "mcp"), { recursive: true });
      await writeFile(
        join(toolsRoot, "my-toolset", "mcp", "tool.json"),
        JSON.stringify({ kind: "mcp" }),
      );
      await writeFile(
        join(toolsRoot, "my-toolset", "mcp", "mcp.json"),
        JSON.stringify({}), // Missing command/url
      );

      const errors: Error[] = [];
      const scanner = new DirectoryScanner({
        roots: [toolsRoot],
        onError: (_dir, err) => errors.push(err),
      });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });

    it("mixes flat tools and nested multi-kind toolsets in same root", async () => {
      // Flat tool (old-style)
      await mkdir(join(toolsRoot, "flat-tool"));
      await writeFile(
        join(toolsRoot, "flat-tool", "tool.json"),
        JSON.stringify({ kind: "mcp", name: "local/flat" }),
      );
      await writeFile(
        join(toolsRoot, "flat-tool", "mcp.json"),
        JSON.stringify({ command: "flat-server" }),
      );

      // Nested multi-kind toolset (new-style)
      await mkdir(join(toolsRoot, "multi-tool", "mcp"), { recursive: true });
      await writeFile(
        join(toolsRoot, "multi-tool", "mcp", "tool.json"),
        JSON.stringify({ kind: "mcp", name: "local/multi-mcp" }),
      );
      await writeFile(
        join(toolsRoot, "multi-tool", "mcp", "mcp.json"),
        JSON.stringify({ command: "multi-server" }),
      );

      await mkdir(join(toolsRoot, "multi-tool", "langchain"), { recursive: true });
      await writeFile(
        join(toolsRoot, "multi-tool", "langchain", "tool.json"),
        JSON.stringify({ kind: "langchain", name: "local/multi-lc" }),
      );
      await writeFile(
        join(toolsRoot, "multi-tool", "langchain", "index.js"),
        `export default { name: "multi", invoke: async (i) => i };`,
      );

      const scanner = new DirectoryScanner({ roots: [toolsRoot] });
      const specs = await scanner.scan();

      expect(specs).toHaveLength(3);
      const names = specs.map((s) => s.name);
      expect(names).toContain("local/flat");
      expect(names).toContain("local/multi-mcp");
      expect(names).toContain("local/multi-lc");
    });
  });
});
