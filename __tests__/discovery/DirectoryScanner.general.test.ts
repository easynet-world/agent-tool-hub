import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";
import { createTestRoot, cleanupTestRoot } from "./DirectoryScanner.test-helpers.js";

describe("DirectoryScanner - General behavior", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(toolsRoot);
  });

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
