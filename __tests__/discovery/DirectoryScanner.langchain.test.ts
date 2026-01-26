import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";
import { createTestRoot, cleanupTestRoot } from "./DirectoryScanner.test-helpers.js";

describe("DirectoryScanner - LangChain tools", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(toolsRoot);
  });

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
