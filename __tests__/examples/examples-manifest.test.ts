import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";

const root = join(process.cwd(), "examples", "groups");

describe("examples manifests", () => {
  it("loads example tools via inference", async () => {
    const scanner = new DirectoryScanner({
      roots: [
        { path: join(root, "web"), namespace: "examples" },
        { path: join(root, "utils"), namespace: "examples" },
        { path: join(root, "dev"), namespace: "examples" },
        { path: join(root, "notify"), namespace: "examples" },
      ],
    });
    const specs = await scanner.scan();

    const byKind = specs.reduce<Record<string, number>>((acc, spec) => {
      acc[spec.kind] = (acc[spec.kind] ?? 0) + 1;
      return acc;
    }, {});

    expect(byKind.langchain).toBe(8);
    expect(byKind.mcp).toBe(3);
    expect(byKind.skill).toBe(5);
    expect(byKind.n8n).toBe(1);

    const n8nSpec = specs.find((spec) => spec.kind === "n8n");
    expect(n8nSpec?.impl).toBeTruthy();
    const workflow = n8nSpec!.impl as { nodes?: unknown[] };
    expect(Array.isArray(workflow.nodes)).toBe(true);
    expect(workflow.nodes!.length).toBeGreaterThan(0);

    const skillSpec = specs.find((spec) => spec.kind === "skill");
    expect(skillSpec?.impl).toBeTruthy();
  });
});
