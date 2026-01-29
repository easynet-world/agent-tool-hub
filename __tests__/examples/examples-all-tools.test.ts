/**
 * Tests for all example tools: page-access (LangChain), system-time (Skill), web-search (MCP).
 * Ensures each tool in examples/tools is discoverable and testable.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DirectoryScanner } from "../../src/discovery/DirectoryScanner.js";

const EXAMPLES_TOOLS_ROOT = join(process.cwd(), "examples", "tools");

vi.mock("@langchain/core/tools", () => {
  class StructuredTool {
    constructor(fields: Record<string, unknown> = {}) {
      Object.assign(this, fields);
    }
    async invoke(input: unknown) {
      return (this as any)._call(input);
    }
  }
  return { StructuredTool };
});

vi.mock("zod", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    chain.describe = () => chain;
    chain.optional = () => chain;
    chain.default = () => chain;
    return chain;
  };
  return {
    z: {
      object: (s: object) => ({ ...makeChain(), shape: s }),
      string: () => makeChain(),
      number: () => makeChain(),
      enum: () => makeChain(),
    },
  };
});

describe("examples: all tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers page-access, filesystem (LangChain), system-time, yahoo-finance (Skill), web-search (MCP)", async () => {
    const scanner = new DirectoryScanner({
      roots: [{ path: EXAMPLES_TOOLS_ROOT, namespace: "tools" }],
    });
    const specs = await scanner.scan();
    expect(specs.length).toBeGreaterThanOrEqual(5);
    const names = specs.map((s) => s.name);
    expect(names.some((n) => n.includes("page_access") || n === "tools/page_access")).toBe(true);
    expect(names.some((n) => n.includes("filesystem"))).toBe(true);
    expect(names).toContain("system-time-skill");
    expect(names.some((n) => n.includes("search"))).toBe(true);
    expect(names.some((n) => n.includes("yahoo-finance"))).toBe(true);
    expect(specs.some((s) => s.kind === "langchain")).toBe(true);
    expect(specs.some((s) => s.kind === "skill")).toBe(true);
    expect(specs.some((s) => s.kind === "mcp")).toBe(true);
  });

  it("page-access (LangChain): fetches URL and returns text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body>Hello</body></html>",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import(
      pathToFileURL(join(EXAMPLES_TOOLS_ROOT, "page-access/langchain/page-access.js")).href
    );
    const tool = (mod as { default?: { invoke: (x: unknown) => Promise<unknown> } }).default;
    expect(tool).toBeDefined();
    const result = await tool!.invoke({ url: "https://example.com", maxLength: 1000 });
    expect(result).toBe("<html><body>Hello</body></html>");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("page-access (LangChain): handles HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })));
    const mod = await import(
      pathToFileURL(join(EXAMPLES_TOOLS_ROOT, "page-access/langchain/page-access.js")).href
    );
    const tool = (mod as { default?: { invoke: (x: unknown) => Promise<unknown> } }).default;
    await expect(tool!.invoke({ url: "https://example.com/missing" })).rejects.toThrow("HTTP 404");
  });

  it("system-time (Skill): returns iso, epochMs, timezone, formatted", async () => {
    const mod = await import(
      pathToFileURL(join(EXAMPLES_TOOLS_ROOT, "system-time/skill/handler.js")).href
    );
    const handler = (mod as { default?: (args: unknown) => Promise<{ result: unknown }> }).default;
    expect(handler).toBeDefined();
    const output = await handler!({});
    expect(output.result).toHaveProperty("iso");
    expect(output.result).toHaveProperty("epochMs");
    expect(output.result).toHaveProperty("timezone");
    expect(output.result).toHaveProperty("formatted");
    expect(typeof (output.result as { epochMs: number }).epochMs).toBe("number");
  });

  it("system-time (Skill): format locale returns formatted string", async () => {
    const mod = await import(
      pathToFileURL(join(EXAMPLES_TOOLS_ROOT, "system-time/skill/handler.js")).href
    );
    const handler = (mod as { default?: (args: unknown) => Promise<{ result: unknown }> }).default;
    const output = await handler!({ format: "locale" });
    expect((output.result as { iso: string }).iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("web-search (MCP): mcp.json has valid command and args", async () => {
    const raw = await readFile(join(EXAMPLES_TOOLS_ROOT, "web-search/mcp/mcp.json"), "utf-8");
    const config = JSON.parse(raw) as { command?: string; args?: string[] };
    expect(config.command).toBe("npx");
    expect(Array.isArray(config.args)).toBe(true);
    expect(config.args).toContain("open-websearch@latest");
  });

});
