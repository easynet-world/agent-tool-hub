import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import calculatorHandler from "../../examples/groups/utils/calculator/skill/handler.js";
import filesystemHandler from "../../examples/groups/utils/filesystem/skill/handler.js";
import braveSearchHandler from "../../examples/groups/web/brave-search/skill/handler.js";
import slackNotifyHandler from "../../examples/groups/notify/slack-notify/skill/handler.js";

describe("skill example handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BRAVE_API_KEY;
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("calculator evaluates expressions", async () => {
    const output = await calculatorHandler({ expression: "2 + 3 * 4" });
    expect(output.result).toEqual({ expression: "2 + 3 * 4", result: "14" });
  });

  it("calculator rejects invalid characters", async () => {
    await expect(
      calculatorHandler({ expression: "2 + alert(1)" }),
    ).rejects.toThrow("Invalid characters");
  });

  it("filesystem read/write/list works", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-fs-"));
    const filePath = join(dir, "note.txt");

    const writeResult = await filesystemHandler({
      operation: "write",
      path: filePath,
      content: "hello",
    });
    expect(writeResult.result).toEqual({
      operation: "write",
      path: filePath,
      content: "hello",
    });

    const readResult = await filesystemHandler({ operation: "read", path: filePath });
    expect(readResult.result).toEqual({
      operation: "read",
      path: filePath,
      content: "hello",
    });

    const listResult = await filesystemHandler({ operation: "list", path: dir });
    const names = listResult.result.items.map((item: { name: string }) => item.name);
    expect(names).toContain("note.txt");

    const diskContent = await readFile(filePath, "utf-8");
    expect(diskContent).toBe("hello");
  });

  it("filesystem write requires content", async () => {
    await expect(
      filesystemHandler({ operation: "write", path: "/tmp/example.txt" }),
    ).rejects.toThrow("content is required");
  });

  it("filesystem stat/exists/mkdir/copy/move/delete work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-fs-ops-"));
    const nestedDir = join(dir, "nested", "deep");
    const filePath = join(nestedDir, "source.txt");
    const copyPath = join(dir, "copy.txt");
    const movedPath = join(dir, "moved.txt");

    const mkdirResult = await filesystemHandler({
      operation: "mkdir",
      path: nestedDir,
      recursive: true,
    });
    expect(mkdirResult.result.path).toBe(nestedDir);

    const writeResult = await filesystemHandler({
      operation: "write",
      path: filePath,
      content: "data",
      ensureDir: true,
    });
    expect(writeResult.result.path).toBe(filePath);

    const statResult = await filesystemHandler({ operation: "stat", path: filePath });
    expect(statResult.result.stat.isFile).toBe(true);

    const existsResult = await filesystemHandler({ operation: "exists", path: filePath });
    expect(existsResult.result.exists).toBe(true);

    const copyResult = await filesystemHandler({
      operation: "copy",
      path: filePath,
      target: copyPath,
    });
    expect(copyResult.result.target).toBe(copyPath);

    const moveResult = await filesystemHandler({
      operation: "move",
      path: copyPath,
      target: movedPath,
    });
    expect(moveResult.result.target).toBe(movedPath);

    const deleteResult = await filesystemHandler({
      operation: "delete",
      path: movedPath,
      recursive: true,
    });
    expect(deleteResult.result.path).toBe(movedPath);

    await expect(access(movedPath)).rejects.toThrow();
  });

  it("filesystem rejects unknown operation", async () => {
    await expect(
      filesystemHandler({ operation: "unknown", path: "/tmp/example.txt" }),
    ).rejects.toThrow("Unknown operation");
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

    const output = await braveSearchHandler({ query: "openai", count: 3 });
    expect(output.result.query).toBe("openai");
    expect(output.result.results).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("q=openai");
    expect(String(url)).toContain("count=3");
    expect((init as { headers?: Record<string, string> }).headers).toMatchObject({
      "X-Subscription-Token": "test-key",
    });
  });

  it("brave-search requires API key", async () => {
    delete process.env.BRAVE_API_KEY;
    await expect(braveSearchHandler({ query: "openai" })).rejects.toThrow(
      "BRAVE_API_KEY",
    );
  });

  it("brave-search handles HTTP errors", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(braveSearchHandler({ query: "openai" })).rejects.toThrow(
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

    const output = await slackNotifyHandler({ channel: "#general", message: "hi" });
    expect(output.result).toEqual({ channel: "C123", ts: "123.456" });

    const [_url, init] = fetchMock.mock.calls[0]!;
    expect((init as { headers?: Record<string, string> }).headers).toMatchObject({
      Authorization: "Bearer slack-token",
    });
  });

  it("slack-notify requires token", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    await expect(
      slackNotifyHandler({ channel: "#general", message: "hi" }),
    ).rejects.toThrow("SLACK_BOT_TOKEN");
  });

  it("slack-notify handles API error responses", async () => {
    process.env.SLACK_BOT_TOKEN = "slack-token";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: "not_in_channel" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      slackNotifyHandler({ channel: "#general", message: "hi" }),
    ).rejects.toThrow("Slack API error");
  });
});
