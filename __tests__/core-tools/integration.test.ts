import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PTCRuntime } from "../../src/core/PTCRuntime.js";
import { ToolRegistry } from "../../src/registry/ToolRegistry.js";
import { registerCoreTools } from "../../src/core-tools/CoreToolsModule.js";

describe("Core Tools Integration (via PTCRuntime)", () => {
  let sandboxRoot: string;
  let runtime: PTCRuntime;

  beforeEach(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), "integration-test-"));
    const registry = new ToolRegistry();
    const coreAdapter = registerCoreTools(registry, {
      sandboxRoot,
      allowedHosts: ["api.example.com"],
    });

    runtime = new PTCRuntime({ registry });
    runtime.registerAdapter(coreAdapter);
  });

  afterEach(async () => {
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  it("registers all 15 core tools", () => {
    const registry = runtime.getRegistry();
    const coreTools = registry.search({ kind: "core" });
    expect(coreTools).toHaveLength(15);
  });

  it("executes core/fs.readText through pipeline", async () => {
    await writeFile(join(sandboxRoot, "test.txt"), "hello from integration");

    const result = await runtime.invoke(
      { tool: "core/fs.readText", args: { path: "test.txt" }, purpose: "integration test" },
      { requestId: "r1", taskId: "t1", permissions: ["read:fs"] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).text).toBe("hello from integration");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("executes core/fs.writeText through pipeline", async () => {
    const result = await runtime.invoke(
      {
        tool: "core/fs.writeText",
        args: { path: "written.txt", text: "integration write" },
        purpose: "write test",
      },
      { requestId: "r2", taskId: "t2", permissions: ["write:fs"] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).bytes).toBe(Buffer.byteLength("integration write"));
  });

  it("executes core/fs.listDir through pipeline", async () => {
    await writeFile(join(sandboxRoot, "a.txt"), "a");
    await writeFile(join(sandboxRoot, "b.txt"), "b");

    const result = await runtime.invoke(
      { tool: "core/fs.listDir", args: { path: "." }, purpose: "list test" },
      { requestId: "r3", taskId: "t3", permissions: ["read:fs"] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).totalEntries).toBeGreaterThanOrEqual(2);
  });

  it("executes core/fs.sha256 through pipeline", async () => {
    await writeFile(join(sandboxRoot, "hash.txt"), "test data");

    const result = await runtime.invoke(
      { tool: "core/fs.sha256", args: { path: "hash.txt" }, purpose: "hash test" },
      { requestId: "r4", taskId: "t4", permissions: ["read:fs"] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).sha256).toHaveLength(64);
  });

  it("executes core/util.hash.sha256Text through pipeline", async () => {
    const result = await runtime.invoke(
      {
        tool: "core/util.hash.sha256Text",
        args: { text: "hello" },
        purpose: "text hash test",
      },
      { requestId: "r5", taskId: "t5", permissions: [] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("executes core/util.text.truncate through pipeline", async () => {
    const result = await runtime.invoke(
      {
        tool: "core/util.text.truncate",
        args: { text: "hello world this is long", maxChars: 10 },
        purpose: "truncate test",
      },
      { requestId: "r6", taskId: "t6", permissions: [] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).truncated).toBe(true);
    expect((result.result as any).text.length).toBeLessThanOrEqual(10);
  });

  it("executes core/util.time.now through pipeline", async () => {
    const result = await runtime.invoke(
      { tool: "core/util.time.now", args: {}, purpose: "time test" },
      { requestId: "r7", taskId: "t7", permissions: [] },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).iso).toBeTruthy();
    expect((result.result as any).epochMs).toBeGreaterThan(0);
  });

  it("denies access when capabilities are missing", async () => {
    await writeFile(join(sandboxRoot, "secret.txt"), "secret");

    const result = await runtime.invoke(
      { tool: "core/fs.readText", args: { path: "secret.txt" }, purpose: "unauthorized" },
      { requestId: "r8", taskId: "t8", permissions: [] }, // No read:fs permission
    );

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("POLICY_DENIED");
  });

  it("denies deletePath without danger:destructive permission", async () => {
    await writeFile(join(sandboxRoot, "file.txt"), "x");

    const result = await runtime.invoke(
      {
        tool: "core/fs.deletePath",
        args: { path: "file.txt", confirm: true },
        purpose: "delete test",
      },
      { requestId: "r9", taskId: "t9", permissions: ["write:fs"] }, // Missing danger:destructive
    );

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("POLICY_DENIED");
  });

  it("allows deletePath with proper permissions", async () => {
    await writeFile(join(sandboxRoot, "doomed.txt"), "goodbye");

    const result = await runtime.invoke(
      {
        tool: "core/fs.deletePath",
        args: { path: "doomed.txt", confirm: true },
        purpose: "delete test",
      },
      {
        requestId: "r10",
        taskId: "t10",
        permissions: ["write:fs", "danger:destructive"],
      },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).deleted).toBe(true);
  });

  it("records metrics for invocations", async () => {
    await writeFile(join(sandboxRoot, "metrics.txt"), "data");

    await runtime.invoke(
      { tool: "core/fs.readText", args: { path: "metrics.txt" }, purpose: "metrics" },
      { requestId: "r11", taskId: "t11", permissions: ["read:fs"] },
    );

    const metrics = runtime.getMetrics();
    const counters = metrics.getAllCounters();
    expect(counters.length).toBeGreaterThan(0);
  });

  it("validates input schema", async () => {
    const result = await runtime.invoke(
      {
        tool: "core/fs.readText",
        args: { notAPath: 123 }, // Missing required 'path'
        purpose: "schema fail",
      },
      { requestId: "r12", taskId: "t12", permissions: ["read:fs"] },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("INPUT_SCHEMA_INVALID");
  });

  it("supports dry-run mode", async () => {
    const result = await runtime.invoke(
      {
        tool: "core/fs.writeText",
        args: { path: "dry.txt", text: "should not write" },
        purpose: "dry run",
      },
      { requestId: "r13", taskId: "t13", permissions: ["write:fs"], dryRun: true },
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).dryRun).toBe(true);
  });
});
