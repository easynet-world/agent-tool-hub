import { describe, it, expect, afterEach, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

const loadTool = async (relativePath: string, fresh = false) => {
  const fullPath = join(process.cwd(), "examples", "tools", relativePath);
  const url = pathToFileURL(fullPath).href;
  const mod = await import(fresh ? `${url}?t=${Date.now()}-${Math.random()}` : url);
  return (mod as { default?: any }).default ?? mod;
};

describe("langchain example tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("page-access fetches URL and returns text", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body>Hello</body></html>",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = await loadTool("page-access/langchain/page-access.js", true);
    const result = await tool.invoke({
      url: "https://example.com",
      maxLength: 1000,
    });
    expect(result).toBe("<html><body>Hello</body></html>");

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com");
  });

  it("page-access handles HTTP errors", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = await loadTool("page-access/langchain/page-access.js", true);
    await expect(
      tool.invoke({ url: "https://example.com/missing" }),
    ).rejects.toThrow("HTTP 404");
  });
});
