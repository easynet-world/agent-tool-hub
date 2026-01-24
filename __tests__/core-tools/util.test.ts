import { describe, it, expect } from "vitest";
import type { CoreToolContext, CoreToolsConfig } from "../../src/core-tools/types.js";
import { hashTextHandler } from "../../src/core-tools/util/hashText.js";
import { truncateHandler } from "../../src/core-tools/util/truncate.js";
import { nowHandler } from "../../src/core-tools/util/now.js";

const config: CoreToolsConfig = {
  sandboxRoot: "/tmp/test",
  allowedHosts: [],
  maxReadBytes: 5 * 1024 * 1024,
  maxHttpBytes: 5 * 1024 * 1024,
  maxDownloadBytes: 100 * 1024 * 1024,
  blockedCidrs: [],
  defaultTimeoutMs: 15000,
  httpUserAgent: "Test/1.0",
  enableAutoWriteLargeResponses: false,
};

const ctx: CoreToolContext = {
  execCtx: { requestId: "r1", taskId: "t1", permissions: [] },
  config,
};

describe("Utility Core Tools", () => {
  describe("core/util.hash.sha256Text", () => {
    it("hashes empty string", async () => {
      const result = await hashTextHandler({ text: "" }, ctx);
      const output = result.result as { sha256: string };
      expect(output.sha256).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });

    it("hashes 'hello'", async () => {
      const result = await hashTextHandler({ text: "hello" }, ctx);
      const output = result.result as { sha256: string };
      expect(output.sha256).toBe(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
    });

    it("produces evidence", async () => {
      const result = await hashTextHandler({ text: "test" }, ctx);
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]!.type).toBe("tool");
    });
  });

  describe("core/util.text.truncate", () => {
    it("does not truncate short text", async () => {
      const result = await truncateHandler({ text: "short", maxChars: 100 }, ctx);
      const output = result.result as { text: string; truncated: boolean };
      expect(output.text).toBe("short");
      expect(output.truncated).toBe(false);
    });

    it("truncates long text with default suffix", async () => {
      const result = await truncateHandler({ text: "hello world", maxChars: 8 }, ctx);
      const output = result.result as { text: string; truncated: boolean; originalLength: number };
      expect(output.text).toBe("hello...");
      expect(output.truncated).toBe(true);
      expect(output.originalLength).toBe(11);
    });

    it("uses custom suffix", async () => {
      const result = await truncateHandler(
        { text: "hello world", maxChars: 9, suffix: " [cut]" },
        ctx,
      );
      const output = result.result as { text: string };
      expect(output.text).toBe("hel [cut]");
    });

    it("handles exact boundary", async () => {
      const result = await truncateHandler({ text: "exact", maxChars: 5 }, ctx);
      const output = result.result as { text: string; truncated: boolean };
      expect(output.text).toBe("exact");
      expect(output.truncated).toBe(false);
    });
  });

  describe("core/util.time.now", () => {
    it("returns ISO timestamp", async () => {
      const result = await nowHandler({}, ctx);
      const output = result.result as { iso: string; epochMs: number; timezone: string };
      expect(output.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(output.epochMs).toBeGreaterThan(0);
      expect(output.timezone).toBe("UTC");
    });

    it("supports timezone parameter", async () => {
      const result = await nowHandler({ timezone: "America/New_York" }, ctx);
      const output = result.result as { timezone: string; formatted: string };
      expect(output.timezone).toBe("America/New_York");
      expect(output.formatted).toBeTruthy();
    });

    it("produces evidence", async () => {
      const result = await nowHandler({}, ctx);
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]!.type).toBe("tool");
    });
  });
});
