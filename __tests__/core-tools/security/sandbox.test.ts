import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSandboxedPath } from "../../../src/core-tools/security/sandbox.js";

describe("resolveSandboxedPath", () => {
  let sandboxRoot: string;

  beforeEach(async () => {
    sandboxRoot = await realpath(await mkdtemp(join(tmpdir(), "sandbox-test-")));
    await mkdir(join(sandboxRoot, "subdir"), { recursive: true });
    await writeFile(join(sandboxRoot, "test.txt"), "hello");
    await writeFile(join(sandboxRoot, "subdir", "nested.txt"), "nested");
  });

  afterEach(async () => {
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it("resolves a valid relative path", async () => {
    const result = await resolveSandboxedPath("test.txt", sandboxRoot);
    expect(result).toBe(join(sandboxRoot, "test.txt"));
  });

  it("resolves a nested relative path", async () => {
    const result = await resolveSandboxedPath("subdir/nested.txt", sandboxRoot);
    expect(result).toBe(join(sandboxRoot, "subdir", "nested.txt"));
  });

  it("resolves a non-existing file (for write targets)", async () => {
    const result = await resolveSandboxedPath("subdir/new-file.txt", sandboxRoot);
    expect(result).toBe(join(sandboxRoot, "subdir", "new-file.txt"));
  });

  it("throws on path traversal with ../", async () => {
    await expect(
      resolveSandboxedPath("../../../etc/passwd", sandboxRoot),
    ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
  });

  it("throws on path traversal with subdir/../../../", async () => {
    await expect(
      resolveSandboxedPath("subdir/../../../etc/passwd", sandboxRoot),
    ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
  });

  it("throws on absolute path outside sandbox", async () => {
    await expect(
      resolveSandboxedPath("/etc/passwd", sandboxRoot),
    ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
  });

  it("allows the sandbox root itself", async () => {
    const result = await resolveSandboxedPath(".", sandboxRoot);
    expect(result).toBe(sandboxRoot);
  });

  it("throws on symlink escape", async () => {
    await symlink("/tmp", join(sandboxRoot, "escape-link"));
    await expect(
      resolveSandboxedPath("escape-link/something", sandboxRoot),
    ).rejects.toMatchObject({ kind: "PATH_OUTSIDE_SANDBOX" });
  });

  it("allows symlink within sandbox", async () => {
    await symlink(
      join(sandboxRoot, "subdir"),
      join(sandboxRoot, "link-to-subdir"),
    );
    const result = await resolveSandboxedPath("link-to-subdir/nested.txt", sandboxRoot);
    expect(result).toBe(join(sandboxRoot, "subdir", "nested.txt"));
  });
});
