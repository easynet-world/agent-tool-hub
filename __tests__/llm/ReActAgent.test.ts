import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReActAgent } from "../../src/llm/ReActAgent.js";
import type { ReActAgentToolHub } from "../../src/llm/ReActAgent.js";
import {
  createOpenAICompatibleClient,
  OpenAICompatibleClient,
} from "../../src/llm/OpenAICompatibleClient.js";
import { ToolRegistry } from "../../src/registry/ToolRegistry.js";
import type { ToolSpec } from "../../src/types/ToolSpec.js";

function makeSpec(name: string, description: string): ToolSpec {
  return {
    name,
    version: "1.0.0",
    kind: "core",
    description,
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    capabilities: [],
  };
}

describe("ReActAgent", () => {
  let mockChatWithTools: ReturnType<typeof vi.fn>;
  let llm: OpenAICompatibleClient;
  let registry: ToolRegistry;
  let invokeTool: ReturnType<typeof vi.fn>;
  let hub: ReActAgentToolHub;

  beforeEach(() => {
    mockChatWithTools = vi.fn();
    registry = new ToolRegistry();
    registry.register(makeSpec("echo", "Echo the input"));
    invokeTool = vi.fn().mockResolvedValue({ ok: true, result: "echoed", evidence: [] });

    llm = createOpenAICompatibleClient("https://api.example.com/v1", "gpt-4o-mini");
    (llm as { chatWithTools: typeof mockChatWithTools }).chatWithTools =
      mockChatWithTools;

    hub = {
      getRegistry: () => registry,
      invokeTool,
    };
  });

  describe("constructor", () => {
    it("creates an instance with run method", () => {
      const agent = new ReActAgent(llm, hub);
      expect(agent).toBeInstanceOf(ReActAgent);
      expect(typeof agent.run).toBe("function");
    });
  });

  describe("run", () => {
    it("returns final content when LLM replies without tool_calls", async () => {
      mockChatWithTools.mockResolvedValueOnce({
        message: {
          role: "assistant",
          content: "Here is the answer.",
          tool_calls: undefined,
        },
        raw: {},
      });

      const agent = new ReActAgent(llm, hub);
      const result = await agent.run("What is 2+2?");

      expect(result.content).toBe("Here is the answer.");
      expect(result.steps).toBe(1);
      expect(mockChatWithTools).toHaveBeenCalledTimes(1);
      expect(invokeTool).not.toHaveBeenCalled();
    });

    it("invokes tools and feeds Observation-prefixed results back", async () => {
      mockChatWithTools
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "echo", arguments: '{"x":"hi"}' },
              },
            ],
          },
          raw: {},
        })
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "I got: echoed.",
            tool_calls: undefined,
          },
          raw: {},
        });

      const agent = new ReActAgent(llm, hub);
      const result = await agent.run("Echo hi");

      expect(result.content).toBe("I got: echoed.");
      expect(result.steps).toBe(2);
      expect(mockChatWithTools).toHaveBeenCalledTimes(2);
      expect(invokeTool).toHaveBeenCalledTimes(1);
      expect(invokeTool).toHaveBeenCalledWith("echo", { x: "hi" });
      const toolMsg = mockChatWithTools.mock.calls[1][0].find(
        (m: { role: string }) => m.role === "tool"
      );
      expect(toolMsg.content).toMatch(/^Observation: /);
    });

    it("uses custom systemPrompt and maxSteps", async () => {
      mockChatWithTools.mockResolvedValue({
        message: {
          role: "assistant",
          content: "Final.",
          tool_calls: undefined,
        },
        raw: {},
      });

      const agent = new ReActAgent(llm, hub);
      await agent.run("Hi", {
        systemPrompt: "You are a bot.",
        maxSteps: 5,
      });

      const firstCall = mockChatWithTools.mock.calls[0];
      const messages = firstCall[0];
      expect(messages[0]).toEqual({ role: "system", content: "You are a bot." });
    });

    it("stops after maxSteps and returns last content", async () => {
      mockChatWithTools.mockResolvedValue({
        message: {
          role: "assistant",
          content: "Step",
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "echo", arguments: "{}" },
            },
          ],
        },
        raw: {},
      });

      const agent = new ReActAgent(llm, hub);
      const result = await agent.run("Loop", { maxSteps: 3 });

      expect(result.steps).toBe(3);
      expect(result.content).toBe("Step");
      expect(mockChatWithTools).toHaveBeenCalledTimes(3);
    });

    it("serializes tool failure as Observation with error", async () => {
      invokeTool.mockResolvedValueOnce({
        ok: false,
        error: { message: "Tool error" },
        evidence: [],
      });
      mockChatWithTools
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "echo", arguments: "{}" },
              },
            ],
          },
          raw: {},
        })
        .mockResolvedValueOnce({
          message: {
            role: "assistant",
            content: "Failed.",
            tool_calls: undefined,
          },
          raw: {},
        });

      const agent = new ReActAgent(llm, hub);
      const result = await agent.run("Use echo");

      expect(result.content).toBe("Failed.");
      const toolMsg = mockChatWithTools.mock.calls[1][0].find(
        (m: { role: string }) => m.role === "tool"
      );
      expect(toolMsg.content).toMatch(/^Observation: /);
      expect(toolMsg.content).toContain("Tool error");
    });
  });
});
