import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";

const root = join(process.cwd(), "examples", "tools");

describe("examples manifests", () => {
  it("loads example tools via inference", async () => {
    const scanner = new DirectoryScanner({
      roots: [{ path: root, namespace: "tools" }],
    });
    const specs = await scanner.scan();

    const byKind = specs.reduce<Record<string, number>>((acc, spec) => {
      acc[spec.kind] = (acc[spec.kind] ?? 0) + 1;
      return acc;
    }, {});

    expect(byKind.langchain).toBeGreaterThanOrEqual(1);
    expect(byKind.mcp ?? 0).toBeGreaterThanOrEqual(1);
    expect(byKind.skill).toBeGreaterThanOrEqual(1);

    const n8nSpec = specs.find((spec) => spec.kind === "n8n");
    if (n8nSpec?.impl) {
      const workflow = n8nSpec.impl as { nodes?: unknown[] };
      expect(Array.isArray(workflow.nodes)).toBe(true);
      expect(workflow.nodes!.length).toBeGreaterThan(0);
    }

    const skillSpec = specs.find((spec) => spec.kind === "skill");
    expect(skillSpec?.impl).toBeTruthy();
  });
});
