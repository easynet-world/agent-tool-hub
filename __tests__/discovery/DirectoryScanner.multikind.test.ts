import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";
import { createTestRoot, cleanupTestRoot } from "./DirectoryScanner.test-helpers.js";

describe("DirectoryScanner - Multi-kind toolsets", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(toolsRoot);
  });

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
