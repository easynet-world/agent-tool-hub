import { describe, it, expect } from "vitest";
import { CoreAdapter } from "../../src/core-tools/CoreAdapter.js";
import type { CoreToolsConfig } from "../../src/core-tools/types.js";
import type { ToolSpec } from "../../src/types/ToolSpec.js";
import type { ExecContext } from "../../src/types/ToolIntent.js";

const testConfig: CoreToolsConfig = {
  sandboxRoot: "/tmp/test-sandbox",
  allowedHosts: ["example.com"],
  maxReadBytes: 5 * 1024 * 1024,
  maxHttpBytes: 5 * 1024 * 1024,
  maxDownloadBytes: 100 * 1024 * 1024,
  blockedCidrs: ["127.0.0.0/8"],
  defaultTimeoutMs: 15000,
  httpUserAgent: "Test/1.0",
  enableAutoWriteLargeResponses: false,
};

const testCtx: ExecContext = {
  requestId: "req-1",
  taskId: "task-1",
  permissions: ["read:fs"],
};

describe("CoreAdapter", () => {
  it("has kind 'core'", () => {
    const adapter = new CoreAdapter(testConfig);
    expect(adapter.kind).toBe("core");
  });

  it("dispatches to registered handler", async () => {
    const adapter = new CoreAdapter(testConfig);
    adapter.registerHandler("test/tool", async (args, ctx) => ({
      result: { echo: args.input },
      evidence: [
        {
          type: "tool",
          ref: "test/tool",
          summary: "test",
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    const spec: ToolSpec = {
      name: "test/tool",
      version: "1.0.0",
      kind: "core",
      inputSchema: {},
      outputSchema: {},
      capabilities: [],
    };

    const result = await adapter.invoke(spec, { input: "hello" }, testCtx);
    expect(result.result).toEqual({ echo: "hello" });
    expect((result.raw as any).evidence).toHaveLength(1);
  });

  it("throws for unregistered handler", async () => {
    const adapter = new CoreAdapter(testConfig);
    const spec: ToolSpec = {
      name: "missing/tool",
      version: "1.0.0",
      kind: "core",
      inputSchema: {},
      outputSchema: {},
      capabilities: [],
    };

    await expect(adapter.invoke(spec, {}, testCtx)).rejects.toThrow(
      "Core tool handler not found: missing/tool",
    );
  });

  it("unregisters handler", () => {
    const adapter = new CoreAdapter(testConfig);
    adapter.registerHandler("test/tool", async () => ({
      result: {},
      evidence: [],
    }));
    expect(adapter.getRegisteredTools()).toContain("test/tool");

    adapter.unregisterHandler("test/tool");
    expect(adapter.getRegisteredTools()).not.toContain("test/tool");
  });

  it("passes config to handler context", async () => {
    const adapter = new CoreAdapter(testConfig);
    let receivedConfig: CoreToolsConfig | undefined;

    adapter.registerHandler("test/config", async (_args, ctx) => {
      receivedConfig = ctx.config;
      return { result: {}, evidence: [] };
    });

    const spec: ToolSpec = {
      name: "test/config",
      version: "1.0.0",
      kind: "core",
      inputSchema: {},
      outputSchema: {},
      capabilities: [],
    };

    await adapter.invoke(spec, {}, testCtx);
    expect(receivedConfig).toEqual(testConfig);
  });

  it("passes exec context to handler", async () => {
    const adapter = new CoreAdapter(testConfig);
    let receivedCtx: ExecContext | undefined;

    adapter.registerHandler("test/ctx", async (_args, ctx) => {
      receivedCtx = ctx.execCtx;
      return { result: {}, evidence: [] };
    });

    const spec: ToolSpec = {
      name: "test/ctx",
      version: "1.0.0",
      kind: "core",
      inputSchema: {},
      outputSchema: {},
      capabilities: [],
    };

    await adapter.invoke(spec, {}, testCtx);
    expect(receivedCtx).toEqual(testCtx);
  });
});
