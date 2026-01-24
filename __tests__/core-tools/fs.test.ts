import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreToolContext, CoreToolsConfig } from "../../src/core-tools/types.js";
import { readTextHandler } from "../../src/core-tools/fs/readText.js";
import { writeTextHandler } from "../../src/core-tools/fs/writeText.js";
import { listDirHandler } from "../../src/core-tools/fs/listDir.js";
import { sha256Handler } from "../../src/core-tools/fs/sha256.js";
import { searchTextHandler } from "../../src/core-tools/fs/searchText.js";
import { deletePathHandler } from "../../src/core-tools/fs/deletePath.js";

describe("Filesystem Core Tools", () => {
  let sandboxRoot: string;
  let ctx: CoreToolContext;

  beforeEach(async () => {
    sandboxRoot = await realpath(await mkdtemp(join(tmpdir(), "fs-test-")));
    const config: CoreToolsConfig = {
      sandboxRoot,
      allowedHosts: [],
      maxReadBytes: 5 * 1024 * 1024,
      maxHttpBytes: 5 * 1024 * 1024,
      maxDownloadBytes: 100 * 1024 * 1024,
      blockedCidrs: [],
      defaultTimeoutMs: 15000,
      httpUserAgent: "Test/1.0",
      enableAutoWriteLargeResponses: false,
    };
    ctx = {
      execCtx: { requestId: "r1", taskId: "t1", permissions: ["read:fs", "write:fs"] },
      config,
    };
  });

  afterEach(async () => {
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  describe("core/fs.readText", () => {
    it("reads a file successfully", async () => {
      await writeFile(join(sandboxRoot, "hello.txt"), "hello world");
      const result = await readTextHandler({ path: "hello.txt" }, ctx);
      expect(result.result).toEqual({
        path: join(sandboxRoot, "hello.txt"),
        text: "hello world",
        bytes: 11,
      });
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]!.type).toBe("file");
    });

    it("throws on file too large", async () => {
      await writeFile(join(sandboxRoot, "big.txt"), "x".repeat(100));
      const smallCtx = {
        ...ctx,
        config: { ...ctx.config, maxReadBytes: 50 },
      };
      await expect(
        readTextHandler({ path: "big.txt" }, smallCtx),
      ).rejects.toMatchObject({ kind: "FILE_TOO_LARGE" });
    });

    it("throws on path outside sandbox", async () => {
      await expect(
        readTextHandler({ path: "../../../etc/passwd" }, ctx),
      ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
    });

    it("throws on non-existing file", async () => {
      await expect(
        readTextHandler({ path: "nonexist.txt" }, ctx),
      ).rejects.toThrow();
    });

    it("respects custom maxBytes arg", async () => {
      await writeFile(join(sandboxRoot, "medium.txt"), "x".repeat(200));
      await expect(
        readTextHandler({ path: "medium.txt", maxBytes: 100 }, ctx),
      ).rejects.toMatchObject({ kind: "FILE_TOO_LARGE" });
    });
  });

  describe("core/fs.writeText", () => {
    it("writes a new file", async () => {
      const result = await writeTextHandler(
        { path: "output.txt", text: "content here" },
        ctx,
      );
      const output = result.result as { path: string; bytes: number; sha256: string };
      expect(output.path).toBe(join(sandboxRoot, "output.txt"));
      expect(output.bytes).toBe(Buffer.byteLength("content here"));
      expect(output.sha256).toHaveLength(64);

      const written = await readFile(join(sandboxRoot, "output.txt"), "utf-8");
      expect(written).toBe("content here");
    });

    it("creates parent directories with mkdirp=true", async () => {
      const result = await writeTextHandler(
        { path: "deep/nested/dir/file.txt", text: "nested" },
        ctx,
      );
      const output = result.result as { path: string };
      expect(output.path).toBe(join(sandboxRoot, "deep", "nested", "dir", "file.txt"));
    });

    it("refuses overwrite by default", async () => {
      await writeFile(join(sandboxRoot, "existing.txt"), "old");
      await expect(
        writeTextHandler({ path: "existing.txt", text: "new" }, ctx),
      ).rejects.toThrow("already exists");
    });

    it("allows overwrite when flag set", async () => {
      await writeFile(join(sandboxRoot, "existing.txt"), "old");
      const result = await writeTextHandler(
        { path: "existing.txt", text: "new content", overwrite: true },
        ctx,
      );
      const output = result.result as { bytes: number };
      expect(output.bytes).toBe(Buffer.byteLength("new content"));
    });

    it("throws on path outside sandbox", async () => {
      await expect(
        writeTextHandler({ path: "../../escape.txt", text: "bad" }, ctx),
      ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
    });
  });

  describe("core/fs.listDir", () => {
    beforeEach(async () => {
      await writeFile(join(sandboxRoot, "a.txt"), "a");
      await writeFile(join(sandboxRoot, "b.txt"), "b");
      await writeFile(join(sandboxRoot, ".hidden"), "hidden");
      await mkdir(join(sandboxRoot, "subdir"));
      await writeFile(join(sandboxRoot, "subdir", "c.txt"), "c");
    });

    it("lists directory contents", async () => {
      const result = await listDirHandler({ path: "." }, ctx);
      const output = result.result as { entries: any[]; totalEntries: number };
      expect(output.totalEntries).toBeGreaterThanOrEqual(3);
      const names = output.entries.map((e: any) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names).toContain("subdir");
    });

    it("excludes hidden files by default", async () => {
      const result = await listDirHandler({ path: "." }, ctx);
      const output = result.result as { entries: any[] };
      const names = output.entries.map((e: any) => e.name);
      expect(names).not.toContain(".hidden");
    });

    it("includes hidden files when requested", async () => {
      const result = await listDirHandler({ path: ".", includeHidden: true }, ctx);
      const output = result.result as { entries: any[] };
      const names = output.entries.map((e: any) => e.name);
      expect(names).toContain(".hidden");
    });

    it("recurses into subdirectories", async () => {
      const result = await listDirHandler({ path: ".", recursive: true }, ctx);
      const output = result.result as { entries: any[] };
      const names = output.entries.map((e: any) => e.name);
      expect(names).toContain(join("subdir", "c.txt"));
    });

    it("respects maxEntries limit", async () => {
      const result = await listDirHandler({ path: ".", maxEntries: 2 }, ctx);
      const output = result.result as { entries: any[]; truncated: boolean };
      expect(output.entries).toHaveLength(2);
      expect(output.truncated).toBe(true);
    });
  });

  describe("core/fs.sha256", () => {
    it("computes correct SHA-256 hash", async () => {
      await writeFile(join(sandboxRoot, "hash-me.txt"), "hello");
      const result = await sha256Handler({ path: "hash-me.txt" }, ctx);
      const output = result.result as { sha256: string; bytes: number };
      // SHA-256 of "hello"
      expect(output.sha256).toBe(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
      expect(output.bytes).toBe(5);
    });

    it("throws on path outside sandbox", async () => {
      await expect(
        sha256Handler({ path: "../../etc/passwd" }, ctx),
      ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
    });
  });

  describe("core/fs.searchText", () => {
    beforeEach(async () => {
      await writeFile(join(sandboxRoot, "log.txt"), "error: something failed\ninfo: all good\nerror: another failure");
      await writeFile(join(sandboxRoot, "code.ts"), "const foo = 'bar';\nfunction hello() { return 'world'; }");
      await mkdir(join(sandboxRoot, "nested"));
      await writeFile(join(sandboxRoot, "nested", "data.json"), '{"key": "value"}');
    });

    it("finds matches in files", async () => {
      const result = await searchTextHandler({ root: ".", query: "error" }, ctx);
      const output = result.result as { matches: any[]; totalMatches: number };
      expect(output.totalMatches).toBe(2);
      expect(output.matches[0]!.file).toBe("log.txt");
    });

    it("supports regex patterns", async () => {
      const result = await searchTextHandler({ root: ".", query: "error.*fail" }, ctx);
      const output = result.result as { matches: any[]; totalMatches: number };
      expect(output.totalMatches).toBe(2);
    });

    it("respects maxMatches limit", async () => {
      const result = await searchTextHandler({ root: ".", query: "error", maxMatches: 1 }, ctx);
      const output = result.result as { matches: any[]; truncated: boolean };
      expect(output.matches).toHaveLength(1);
      expect(output.truncated).toBe(true);
    });

    it("searches nested directories", async () => {
      const result = await searchTextHandler({ root: ".", query: "key" }, ctx);
      const output = result.result as { matches: any[] };
      const files = output.matches.map((m: any) => m.file);
      expect(files).toContain(join("nested", "data.json"));
    });
  });

  describe("core/fs.deletePath", () => {
    it("deletes a file with confirm=true", async () => {
      await writeFile(join(sandboxRoot, "to-delete.txt"), "bye");
      const result = await deletePathHandler(
        { path: "to-delete.txt", confirm: true },
        ctx,
      );
      const output = result.result as { deleted: boolean; type: string };
      expect(output.deleted).toBe(true);
      expect(output.type).toBe("file");
    });

    it("throws without confirm=true", async () => {
      await writeFile(join(sandboxRoot, "safe.txt"), "keep");
      await expect(
        deletePathHandler({ path: "safe.txt", confirm: false }, ctx),
      ).rejects.toThrow("not confirmed");
    });

    it("deletes directory recursively", async () => {
      await mkdir(join(sandboxRoot, "dir-to-rm", "sub"), { recursive: true });
      await writeFile(join(sandboxRoot, "dir-to-rm", "sub", "f.txt"), "x");
      const result = await deletePathHandler(
        { path: "dir-to-rm", confirm: true, recursive: true },
        ctx,
      );
      const output = result.result as { deleted: boolean; type: string };
      expect(output.deleted).toBe(true);
      expect(output.type).toBe("directory");
    });

    it("prevents deleting sandbox root", async () => {
      await expect(
        deletePathHandler({ path: ".", confirm: true, recursive: true }, ctx),
      ).rejects.toThrow("sandbox root");
    });

    it("throws on path outside sandbox", async () => {
      await expect(
        deletePathHandler({ path: "../../escape", confirm: true }, ctx),
      ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
    });
  });
});
