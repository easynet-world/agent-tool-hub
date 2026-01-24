import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  const fullPath = join(process.cwd(), "examples", "groups", relativePath);
  const url = pathToFileURL(fullPath).href;
  const mod = await import(fresh ? `${url}?t=${Date.now()}-${Math.random()}` : url);
  return (mod as { default?: any }).default ?? mod;
};

describe("langchain example tools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BRAVE_API_KEY;
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("calculator evaluates expressions", async () => {
    const tool = await loadTool("utils/calculator/langchain/calculator.js");
    const result = await tool.invoke({ expression: "2 + 3 * 4" });
    expect(result).toBe("14");
  });

  it("calculator rejects invalid characters", async () => {
    const tool = await loadTool("utils/calculator/langchain/calculator.js");
    await expect(tool.invoke({ expression: "2 + alert(1)" })).rejects.toThrow(
      "Invalid characters",
    );
  });

  it("filesystem read/write/list works", async () => {
    const writeTool = await loadTool("utils/filesystem/langchain/write.js");
    const readTool = await loadTool("utils/filesystem/langchain/read.js");
    const listTool = await loadTool("utils/filesystem/langchain/list.js");
    const dir = await mkdtemp(join(tmpdir(), "lc-fs-"));
    const filePath = join(dir, "note.txt");

    const writeResult = await writeTool.invoke({
      path: filePath,
      content: "hello",
    });
    expect(JSON.parse(writeResult)).toEqual({ ok: true, path: filePath });

    const readResult = await readTool.invoke({ path: filePath });
    expect(readResult).toBe("hello");

    const listResult = await listTool.invoke({ path: dir });
    const items = JSON.parse(listResult) as Array<{ name: string }>;
    const names = items.map((item) => item.name);
    expect(names).toContain("note.txt");

    const diskContent = await readFile(filePath, "utf-8");
    expect(diskContent).toBe("hello");
  });

  it("filesystem write requires content", async () => {
    const tool = await loadTool("utils/filesystem/langchain/write.js");
    await expect(tool.invoke({ path: "/tmp/example.txt" })).rejects.toThrow(
      "Content is required",
    );
  });

  it("filesystem delete removes files", async () => {
    const writeTool = await loadTool("utils/filesystem/langchain/write.js");
    const deleteTool = await loadTool("utils/filesystem/langchain/delete.js");
    const dir = await mkdtemp(join(tmpdir(), "lc-fs-del-"));
    const filePath = join(dir, "temp.txt");

    await writeTool.invoke({ path: filePath, content: "bye" });
    await deleteTool.invoke({ path: filePath });

    await expect(access(filePath)).rejects.toThrow();
  });

  it("code-review returns issues and score", async () => {
    const tool = await loadTool("dev/code-review/langchain/code-review.js");
    const result = await tool.invoke({ code: "console.log('x');" });
    const parsed = JSON.parse(result);
    expect(parsed.language).toBe("unknown");
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.score).toBeLessThan(10);
  });

  it("brave-search returns results", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "t1", url: "https://example.com", description: "d1" },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = await loadTool("web/brave-search/langchain/brave-search.js", true);
    const result = await tool.invoke({ query: "openai", count: 2 });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("q=openai");
    expect(String(url)).toContain("count=2");
    expect((init as { headers?: Record<string, string> }).headers).toMatchObject({
      "X-Subscription-Token": "test-key",
    });
  });

  it("brave-search requires API key", async () => {
    delete process.env.BRAVE_API_KEY;
    const tool = await loadTool("web/brave-search/langchain/brave-search.js");
    await expect(tool.invoke({ query: "openai" })).rejects.toThrow("BRAVE_API_KEY");
  });

  it("brave-search handles HTTP errors", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = await loadTool("web/brave-search/langchain/brave-search.js", true);
    await expect(tool.invoke({ query: "openai" })).rejects.toThrow(
      "Brave Search API error",
    );
  });

  it("slack-notify sends messages", async () => {
    process.env.SLACK_BOT_TOKEN = "slack-token";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, channel: "C123", ts: "123.456" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = await loadTool("notify/slack-notify/langchain/slack-notify.js", true);
    const result = await tool.invoke({ channel: "#general", message: "hi" });
    const parsed = JSON.parse(result);
    expect(parsed.channel).toBe("C123");
    expect(parsed.ts).toBe("123.456");
  });

  it("slack-notify requires token", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const tool = await loadTool("notify/slack-notify/langchain/slack-notify.js");
    await expect(
      tool.invoke({ channel: "#general", message: "hi" }),
    ).rejects.toThrow("SLACK_BOT_TOKEN");
  });

  it("slack-notify handles API error responses", async () => {
    process.env.SLACK_BOT_TOKEN = "slack-token";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: "not_in_channel" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = await loadTool("notify/slack-notify/langchain/slack-notify.js", true);
    await expect(
      tool.invoke({ channel: "#general", message: "hi" }),
    ).rejects.toThrow("Slack API error");
  });
});
