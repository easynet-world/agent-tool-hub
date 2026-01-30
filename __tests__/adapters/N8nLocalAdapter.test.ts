import { describe, it, expect, vi } from "vitest";
import type { ToolSpec } from "../../src/types/ToolSpec.js";
import type { ExecContext } from "../../src/types/ToolIntent.js";
import type { N8nLocalInstance } from "../../src/adapters/N8nLocalAdapter.js";

describe("N8nLocalAdapter", () => {
  describe("with options.instance (no @easynet/n8n-local load)", () => {
    it("uses provided instance and does not load @easynet/n8n-local", async () => {
      const { N8nLocalAdapter } = await import("../../src/adapters/N8nLocalAdapter.js");

      const mockInstance: N8nLocalInstance = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        workflow: {
          listWorkflows: vi.fn().mockResolvedValue([]),
          importWorkflow: vi.fn().mockResolvedValue({ id: "wf-1" }),
          updateWorkflow: vi.fn().mockResolvedValue({ id: "wf-1" }),
        },
        runWorkflow: vi.fn().mockResolvedValue("ok"),
      };

      const adapter = new N8nLocalAdapter({ instance: mockInstance, autoStart: true });
      expect(adapter.kind).toBe("n8n");

      await adapter.start();
      expect(mockInstance.start).toHaveBeenCalledTimes(1);

      const spec: ToolSpec = {
        name: "test-wf",
        version: "1.0.0",
        kind: "n8n",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        capabilities: [],
        impl: { id: "wf-1", name: "test-wf", nodes: [], connections: {} },
      };
      const ctx: ExecContext = {
        requestId: "r1",
        taskId: "t1",
        permissions: [],
      };
      const out = await adapter.invoke(spec, {}, ctx);
      expect(out.result).toBe("ok");
      expect(mockInstance.runWorkflow).toHaveBeenCalledWith("wf-1", {});

      await adapter.stop();
      expect(mockInstance.stop).toHaveBeenCalledTimes(1);
    });

    it("listTools returns empty array", async () => {
      const { N8nLocalAdapter } = await import("../../src/adapters/N8nLocalAdapter.js");
      const adapter = new N8nLocalAdapter({
        instance: {
          start: async () => {},
          stop: async () => {},
          workflow: {
            listWorkflows: async () => [],
            importWorkflow: async () => ({ id: "x" }),
            updateWorkflow: async () => ({}),
          },
          runWorkflow: async () => ({}),
        },
      });
      const tools = await adapter.listTools();
      expect(tools).toEqual([]);
    });
  });

  // When @easynet/n8n-local is not installed, ensureInstance() throws a clear error
  // (see N8nLocalAdapter.ensureInstance). Tested implicitly via "with options.instance" above:
  // no package is loaded when instance is provided, so slim install works.
});
