import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreToolContext, CoreToolsConfig } from "../../src/core-tools/types.js";

// Mock dns/promises before imports that use it
vi.mock("node:dns/promises", () => {
  const lookupFn = vi.fn().mockResolvedValue({ address: "203.0.113.50", family: 4 });
  return { lookup: lookupFn, default: { lookup: lookupFn } };
});

// Import handlers after the mock is set up
const { fetchTextHandler } = await import("../../src/core-tools/http/fetchText.js");
const { fetchJsonHandler } = await import("../../src/core-tools/http/fetchJson.js");
const { headHandler } = await import("../../src/core-tools/http/head.js");
const { downloadFileHandler } = await import("../../src/core-tools/http/downloadFile.js");

describe("HTTP Core Tools", () => {
  let sandboxRoot: string;
  let ctx: CoreToolContext;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), "http-test-"));
    const config: CoreToolsConfig = {
      sandboxRoot,
      allowedHosts: ["api.example.com", "*.test.com"],
      maxReadBytes: 5 * 1024 * 1024,
      maxHttpBytes: 1024,
      maxDownloadBytes: 2048,
      blockedCidrs: ["127.0.0.0/8", "10.0.0.0/8"],
      defaultTimeoutMs: 5000,
      httpUserAgent: "TestAgent/1.0",
      enableAutoWriteLargeResponses: false,
    };
    ctx = {
      execCtx: { requestId: "r1", taskId: "t1", permissions: ["network", "write:fs"] },
      config,
    };
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  describe("core/http.fetchText", () => {
    it("fetches text successfully", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        body: createReadableStream("Hello, World!"),
      });

      const result = await fetchTextHandler({ url: "https://api.example.com/data" }, ctx);
      const output = result.result as { url: string; status: number; text: string; bytes: number };
      expect(output.status).toBe(200);
      expect(output.text).toBe("Hello, World!");
      expect(output.bytes).toBe(13);
      expect(result.evidence[0]!.type).toBe("url");
    });

    it("rejects disallowed host", async () => {
      await expect(
        fetchTextHandler({ url: "https://evil.com/steal" }, ctx),
      ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
    });

    it("throws HTTP_TOO_LARGE on large content-length header", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-length": "9999999" }),
        body: createReadableStream("x"),
      });

      await expect(
        fetchTextHandler({ url: "https://api.example.com/big" }, ctx),
      ).rejects.toMatchObject({ kind: "HTTP_TOO_LARGE" });
    });

    it("throws HTTP_TOO_LARGE on body exceeding limit", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({}),
        body: createReadableStream("x".repeat(2000)),
      });

      await expect(
        fetchTextHandler({ url: "https://api.example.com/big-body" }, ctx),
      ).rejects.toMatchObject({ kind: "HTTP_TOO_LARGE" });
    });

    it("throws HTTP_TIMEOUT on abort", async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      });

      await expect(
        fetchTextHandler({ url: "https://api.example.com/slow", timeoutMs: 1000 }, ctx),
      ).rejects.toMatchObject({ kind: "HTTP_TIMEOUT" });
    });

    it("sets User-Agent header", async () => {
      let capturedHeaders: any;
      global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        capturedHeaders = opts?.headers;
        return Promise.resolve({
          status: 200,
          headers: new Headers(),
          body: createReadableStream("ok"),
        });
      });

      await fetchTextHandler({ url: "https://api.example.com/ua" }, ctx);
      expect(capturedHeaders["User-Agent"]).toBe("TestAgent/1.0");
    });

    it("supports POST method with body", async () => {
      let capturedMethod: string | undefined;
      let capturedBody: string | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        capturedMethod = opts?.method;
        capturedBody = opts?.body;
        return Promise.resolve({
          status: 201,
          headers: new Headers(),
          body: createReadableStream("created"),
        });
      });

      await fetchTextHandler(
        { url: "https://api.example.com/post", method: "POST", body: '{"key":"val"}' },
        ctx,
      );
      expect(capturedMethod).toBe("POST");
      expect(capturedBody).toBe('{"key":"val"}');
    });
  });

  describe("core/http.fetchJson", () => {
    it("fetches and parses JSON", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: () => Promise.resolve('{"name":"test","value":42}'),
      });

      const result = await fetchJsonHandler({ url: "https://api.example.com/json" }, ctx);
      const output = result.result as { json: any; status: number };
      expect(output.status).toBe(200);
      expect(output.json).toEqual({ name: "test", value: 42 });
    });

    it("throws on invalid JSON response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve("not json at all"),
      });

      await expect(
        fetchJsonHandler({ url: "https://api.example.com/bad" }, ctx),
      ).rejects.toMatchObject({ kind: "UPSTREAM_ERROR" });
    });

    it("rejects disallowed host", async () => {
      await expect(
        fetchJsonHandler({ url: "https://hacker.org/api" }, ctx),
      ).rejects.toMatchObject({ kind: "HTTP_DISALLOWED_HOST" });
    });
  });

  describe("core/http.head", () => {
    it("sends HEAD request and returns headers", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({
          "content-length": "12345",
          "content-type": "text/html",
          etag: '"abc123"',
        }),
      });

      const result = await headHandler({ url: "https://api.example.com/resource" }, ctx);
      const output = result.result as { status: number; headers: Record<string, string> };
      expect(output.status).toBe(200);
      expect(output.headers["content-length"]).toBe("12345");
      expect(output.headers["etag"]).toBe('"abc123"');
    });

    it("uses HEAD method", async () => {
      let capturedMethod: string | undefined;
      global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        capturedMethod = opts?.method;
        return Promise.resolve({
          status: 200,
          headers: new Headers(),
        });
      });

      await headHandler({ url: "https://api.example.com/head" }, ctx);
      expect(capturedMethod).toBe("HEAD");
    });
  });

  describe("core/http.downloadFile", () => {
    it("downloads file to sandbox", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-length": "5" }),
        body: createReadableStream("hello"),
      });

      const result = await downloadFileHandler(
        { url: "https://api.example.com/file.bin", destPath: "downloaded.bin" },
        ctx,
      );
      const output = result.result as { destPath: string; bytes: number; sha256: string };
      expect(output.bytes).toBe(5);
      expect(output.sha256).toHaveLength(64);

      const content = await readFile(output.destPath, "utf-8");
      expect(content).toBe("hello");
    });

    it("throws HTTP_TOO_LARGE on oversized content-length", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ "content-length": "999999" }),
        body: createReadableStream("x"),
      });

      await expect(
        downloadFileHandler(
          { url: "https://api.example.com/huge", destPath: "huge.bin" },
          ctx,
        ),
      ).rejects.toMatchObject({ kind: "HTTP_TOO_LARGE" });
    });

    it("throws HTTP_TOO_LARGE on body exceeding limit", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({}),
        body: createReadableStream("x".repeat(3000)),
      });

      await expect(
        downloadFileHandler(
          { url: "https://api.example.com/huge2", destPath: "huge2.bin" },
          ctx,
        ),
      ).rejects.toMatchObject({ kind: "HTTP_TOO_LARGE" });
    });

    it("refuses overwrite by default", async () => {
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(join(sandboxRoot, "existing.bin"), "old");

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: createReadableStream("new"),
      });

      await expect(
        downloadFileHandler(
          { url: "https://api.example.com/file.bin", destPath: "existing.bin" },
          ctx,
        ),
      ).rejects.toThrow("already exists");
    });

    it("creates parent directories", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: createReadableStream("data"),
      });

      const result = await downloadFileHandler(
        { url: "https://api.example.com/file.bin", destPath: "deep/nested/file.bin" },
        ctx,
      );
      const output = result.result as { destPath: string };
      const content = await readFile(output.destPath, "utf-8");
      expect(content).toBe("data");
    });

    it("produces both url and file evidence", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: createReadableStream("data"),
      });

      const result = await downloadFileHandler(
        { url: "https://api.example.com/f.bin", destPath: "out.bin" },
        ctx,
      );
      expect(result.evidence).toHaveLength(2);
      expect(result.evidence[0]!.type).toBe("url");
      expect(result.evidence[1]!.type).toBe("file");
    });
  });
});

function createReadableStream(data: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(data);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}
