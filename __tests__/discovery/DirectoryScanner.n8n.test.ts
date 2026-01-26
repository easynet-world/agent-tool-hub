import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";
import { createTestRoot, cleanupTestRoot } from "./DirectoryScanner.test-helpers.js";

describe("DirectoryScanner - n8n tools", () => {
  let toolsRoot: string;

  beforeEach(async () => {
    toolsRoot = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(toolsRoot);
  });

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
