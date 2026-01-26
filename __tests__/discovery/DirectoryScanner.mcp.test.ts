import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";
import { createTestRoot, cleanupTestRoot } from "./DirectoryScanner.test-helpers.js";

describe("DirectoryScanner - MCP tools", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(toolsRoot);
  });

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
