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

describe("examples/tools discovery", () => {
  it("discovers all example tools across kinds", async () => {
    const root = join(process.cwd(), "examples", "tools");
    const errors: Error[] = [];
    const scanner = new DirectoryScanner({
      roots: [{ path: root, namespace: "tools" }],
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

    expect(byKind.langchain).toBeGreaterThanOrEqual(1);
    expect(byKind.mcp ?? 0).toBeGreaterThanOrEqual(1);
    expect(byKind.skill).toBeGreaterThanOrEqual(1);

    const names = specs.map((spec) => spec.name);
    expect(names).toContain("tools/page_access");
    expect(names).toContain("tools/filesystem");
    expect(names.some((n) => n.includes("search") || n.includes("web-search"))).toBe(true);
    expect(names).toContain("system-time-skill");
  });
});
