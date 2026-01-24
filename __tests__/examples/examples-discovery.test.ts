import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";

vi.mock("@langchain/core/tools", () => {
  class StructuredTool {
    constructor(fields: Record<string, unknown> = {}) {
      Object.assign(this, fields);
    }

    async invoke(input: unknown) {
      // @ts-expect-error - _call is implemented by subclasses in examples
      return this._call(input);
    }
  }

  return { StructuredTool };
});

vi.mock("zod", () => {
  const makeChain = () => {
    const chain: Record<string, any> = {};
    chain.describe = () => chain;
    chain.optional = () => chain;
    chain.default = () => chain;
    return chain;
  };

  const z = {
    object: (shape: Record<string, unknown>) => ({
      ...makeChain(),
      shape,
    }),
    string: () => makeChain(),
    number: () => makeChain(),
    enum: () => makeChain(),
  };

  return { z };
});

describe("examples/groups discovery", () => {
  it("discovers all example tools across kinds", async () => {
    const root = join(process.cwd(), "examples", "groups");
    const errors: Error[] = [];
    const scanner = new DirectoryScanner({
      roots: [
        { path: join(root, "web"), namespace: "web" },
        { path: join(root, "utils"), namespace: "utils" },
        { path: join(root, "dev"), namespace: "dev" },
        { path: join(root, "notify"), namespace: "notify" },
      ],
      onError: (_dir, err) => errors.push(err),
    });
    const specs = await scanner.scan();
    if (errors.length > 0) {
      throw new Error(`Discovery errors: ${errors.map((err) => err.message).join("; ")}`);
    }

    const byKind = specs.reduce<Record<string, number>>((acc, spec) => {
      acc[spec.kind] = (acc[spec.kind] ?? 0) + 1;
      return acc;
    }, {});

    expect(byKind.langchain).toBe(8);
    expect(byKind.mcp).toBe(3);
    expect(byKind.skill).toBe(5);
    expect(byKind.n8n).toBe(1);

    const names = specs.map((spec) => spec.name);
    expect(names).toContain("web/brave_search");
    expect(names).toContain("utils/calculator");
    expect(names).toContain("utils/filesystem_read");
    expect(names).toContain("utils/filesystem_write");
    expect(names).toContain("utils/filesystem_list");
    expect(names).toContain("utils/filesystem_delete");
    expect(names).toContain("notify/slack_notify");
    expect(names).toContain("dev/code_review");

    expect(names).toContain("web/brave-search-mcp");
    expect(names).toContain("utils/calculator-mcp");
    expect(names).toContain("utils/filesystem-mcp");

    expect(names).toContain("brave-search-skill");
    expect(names).toContain("calculator-skill");
    expect(names).toContain("filesystem-skill");
    expect(names).toContain("slack-notify-skill");
    expect(names).toContain("code-review");
  });
});
