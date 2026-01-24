import { describe, it, expect, beforeEach } from "vitest";
import { PTCRuntime } from "../src/core/PTCRuntime.js";
import { LangChainAdapter } from "../src/adapters/LangChainAdapter.js";
import type { ToolAdapter } from "../src/types/ToolSpec.js";
import type { ExecContext } from "../src/types/ToolIntent.js";
import {
  calcToolSpec,
  fileWriteToolSpec,
  destructiveToolSpec,
  defaultCtx,
  fullPermCtx,
  makeIntent,
} from "./fixtures/index.js";

describe("PTCRuntime", () => {
  let runtime: PTCRuntime;
  let adapter: LangChainAdapter;

  beforeEach(() => {
    adapter = new LangChainAdapter();
    runtime = new PTCRuntime({
      config: {
        includeRaw: true,
        defaultMaxRetries: 0,
      },
    });
    runtime.registerAdapter(adapter);

    // Register a calculator tool implementation
    adapter.registerTool("test/calculator", {
      async invoke(input: unknown) {
        const { a, b, op } = input as { a: number; b: number; op: string };
        let result: number;
        switch (op) {
          case "+": result = a + b; break;
          case "-": result = a - b; break;
          case "*": result = a * b; break;
          case "/": result = a / b; break;
          default: result = a + b;
        }
        return { result };
      },
    });

    // Register tool specs
    runtime.getRegistry().register(calcToolSpec);
    runtime.getRegistry().register(fileWriteToolSpec);
    runtime.getRegistry().register(destructiveToolSpec);
  });

  describe("successful invocation", () => {
    it("should execute a tool and return ToolResult", async () => {
      const result = await runtime.invoke(
        makeIntent("test/calculator", { a: 2, b: 3, op: "+" }),
        defaultCtx,
      );

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 5 });
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it("should apply default values from schema", async () => {
      const result = await runtime.invoke(
        makeIntent("test/calculator", { a: 10, b: 5 }), // op defaults to "+"
        defaultCtx,
      );

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 15 });
    });

    it("should support multiplication", async () => {
      const result = await runtime.invoke(
        makeIntent("test/calculator", { a: 4, b: 7, op: "*" }),
        defaultCtx,
      );

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 28 });
    });
  });

  describe("error handling", () => {
    it("should return TOOL_NOT_FOUND for unknown tools", async () => {
      const result = await runtime.invoke(
        makeIntent("nonexistent/tool", {}),
        defaultCtx,
      );

      expect(result.ok).toBe(false);
      expect(result.error?.kind).toBe("TOOL_NOT_FOUND");
    });

    it("should return INPUT_SCHEMA_INVALID for bad args", async () => {
      const result = await runtime.invoke(
        makeIntent("test/calculator", { a: "not_a_number", b: "bad" }),
        defaultCtx,
      );

      // AJV coerces strings to numbers if possible, so "not_a_number" fails
      expect(result.ok).toBe(false);
      expect(result.error?.kind).toBe("INPUT_SCHEMA_INVALID");
    });

    it("should return POLICY_DENIED for insufficient permissions", async () => {
      const result = await runtime.invoke(
        makeIntent("test/file_write", { path: "/tmp/test.txt", content: "hi" }),
        { ...defaultCtx, permissions: ["read:web"] }, // Missing write:fs
      );

      expect(result.ok).toBe(false);
      expect(result.error?.kind).toBe("POLICY_DENIED");
    });

    it("should return POLICY_DENIED for destructive tools without permission", async () => {
      const result = await runtime.invoke(
        makeIntent("test/drop_table", { table: "users" }),
        { ...defaultCtx, permissions: ["write:db"] }, // Missing danger:destructive
      );

      expect(result.ok).toBe(false);
      expect(result.error?.kind).toBe("POLICY_DENIED");
    });

    it("should allow destructive tools with explicit permission", async () => {
      adapter.registerTool("test/drop_table", {
        async invoke() {
          return { ok: true };
        },
      });

      const result = await runtime.invoke(
        makeIntent("test/drop_table", { table: "temp_logs" }),
        fullPermCtx,
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("observability", () => {
    it("should log events for each invocation", async () => {
      await runtime.invoke(
        makeIntent("test/calculator", { a: 1, b: 2, op: "+" }),
        defaultCtx,
      );

      const events = runtime.getEventLog().getAll();
      expect(events.length).toBeGreaterThan(0);

      const calledEvent = events.find((e) => e.event.type === "TOOL_CALLED");
      expect(calledEvent).toBeDefined();
      expect(calledEvent!.event.toolName).toBe("test/calculator");
    });

    it("should record metrics", async () => {
      await runtime.invoke(
        makeIntent("test/calculator", { a: 1, b: 1, op: "+" }),
        defaultCtx,
      );

      const metrics = runtime.getMetrics();
      const count = metrics.getCounter("tool_invocations_total", {
        toolName: "test/calculator",
        ok: "true",
      });
      expect(count).toBe(1);
    });

    it("should create trace spans", async () => {
      const ctx = { ...defaultCtx, traceId: "test-trace-123" };
      await runtime.invoke(
        makeIntent("test/calculator", { a: 1, b: 1, op: "+" }),
        ctx,
      );

      const spans = runtime.getTracing().getTrace("test-trace-123");
      expect(spans.length).toBeGreaterThan(0);
      expect(spans[0]!.name).toBe("tool:test/calculator");
      expect(spans[0]!.status).toBe("ok");
    });
  });

  describe("dry-run mode", () => {
    it("should return dry-run result without executing", async () => {
      const ctx: ExecContext = { ...defaultCtx, dryRun: true };
      const result = await runtime.invoke(
        makeIntent("test/calculator", { a: 1, b: 1, op: "+" }),
        ctx,
      );

      expect(result.ok).toBe(true);
      expect((result.result as any).dryRun).toBe(true);
      expect((result.result as any).tool).toBe("test/calculator");
    });
  });

  describe("searchTools and getToolSchema", () => {
    it("should search tools by text", () => {
      const results = runtime.searchTools("calculator");
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("test/calculator");
    });

    it("should get tool schema", () => {
      const schema = runtime.getToolSchema("test/calculator");
      expect(schema).toBeDefined();
      expect(schema!.input).toEqual(calcToolSpec.inputSchema);
      expect(schema!.output).toEqual(calcToolSpec.outputSchema);
    });

    it("should return undefined for unknown tool schema", () => {
      expect(runtime.getToolSchema("unknown")).toBeUndefined();
    });
  });
});
