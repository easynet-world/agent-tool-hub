import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolHub } from "../src/tool-hub/ToolHub.js";

describe("ToolHub multi-root discovery", () => {
  let rootA: string;
  let rootB: string;

  beforeEach(async () => {
    rootA = await mkdtemp(join(tmpdir(), "toolhub-root-a-"));
    rootB = await mkdtemp(join(tmpdir(), "toolhub-root-b-"));

    await mkdir(join(rootA, "alpha", "mcp"), { recursive: true });
    await writeFile(
      join(rootA, "alpha", "mcp", "mcp.json"),
      JSON.stringify({ command: "node", args: ["alpha"] }),
    );

    await mkdir(join(rootB, "beta", "mcp"), { recursive: true });
    await writeFile(
      join(rootB, "beta", "mcp", "mcp.json"),
      JSON.stringify({ command: "node", args: ["beta"] }),
    );
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  it("loads tools from multiple roots and refreshes dynamically", async () => {
    const hub = createToolHub({
      roots: [rootA],
      namespace: "local",
      n8nMode: "api",
    });

    await hub.initAllTools();
    expect(hub.getRegistry().list()).toContain("local/alpha-mcp");

    await hub.addRoots([rootB], true);
    const names = hub.getRegistry().list();
    expect(names).toContain("local/alpha-mcp");
    expect(names).toContain("local/beta-mcp");
  });

  it("setRoots replaces discovered tools", async () => {
    const hub = createToolHub({
      roots: [rootA],
      namespace: "local",
      n8nMode: "api",
    });

    await hub.initAllTools();
    expect(hub.getRegistry().list()).toContain("local/alpha-mcp");

    await hub.setRoots([rootB], true);
    const names = hub.getRegistry().list();
    expect(names).toContain("local/beta-mcp");
    expect(names).not.toContain("local/alpha-mcp");
  });
});
