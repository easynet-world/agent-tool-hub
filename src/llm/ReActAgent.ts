/**
 * ReAct agent: LLM + tool hub, Thought–Action–Observation loop.
 * Use: new ReActAgent(llm, toolHub).run(instruction).
 */

import type { ToolRegistry } from "../registry/ToolRegistry.js";
import type { ToolSpec } from "../types/ToolSpec.js";
import type { ToolResult } from "../types/ToolResult.js";
import type {
  OpenAICompatibleClient,
  OpenAIToolDefinition,
  AssistantMessageWithToolCalls,
  ChatMessage,
} from "./OpenAICompatibleClient.js";

export interface ReActAgentToolHub {
  getRegistry(): ToolRegistry;
  invokeTool(toolName: string, args: unknown): Promise<ToolResult>;
}

export interface ReActAgentRunOptions {
  systemPrompt?: string;
  maxSteps?: number;
  timeoutMs?: number;
}

export interface ReActAgentRunResult {
  content: string;
  steps: number;
}

type AgentMessage =
  | ChatMessage
  | { role: "tool"; content: string; tool_call_id: string }
  | (AssistantMessageWithToolCalls & { role: "assistant" });

const DEFAULT_PROMPT =
  "ReAct: Thought (reason) → Action (use tool or answer) → Observation (tool result). Repeat until you give the final answer. Same language as user.";

export class ReActAgent {
  constructor(
    private readonly llm: OpenAICompatibleClient,
    private readonly toolHub: ReActAgentToolHub
  ) {}

  async run(
    instruction: string,
    options: ReActAgentRunOptions = {}
  ): Promise<ReActAgentRunResult> {
    const maxSteps = options.maxSteps ?? 10;
    const tools = this.getTools();
    const messages: AgentMessage[] = [
      { role: "system", content: options.systemPrompt ?? DEFAULT_PROMPT },
      { role: "user", content: instruction },
    ];
    let steps = 0;
    let lastContent = "";

    while (steps < maxSteps) {
      const { message } = await this.llm.chatWithTools(
        messages,
        tools,
        options.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined
      );
      steps++;
      messages.push({ ...message, role: "assistant" });
      if (message.content) lastContent = message.content;
      if (!message.tool_calls?.length)
        return { content: lastContent, steps };

      for (const tc of message.tool_calls) {
        const args = this.parseArgs(tc.function.arguments);
        const result = await this.toolHub.invokeTool(tc.function.name, args);
        const content = result.ok
          ? JSON.stringify(result.result)
          : JSON.stringify({ ok: false, error: result.error?.message ?? "Tool failed" });
        messages.push({ role: "tool", content: `Observation: ${content}`, tool_call_id: tc.id });
      }
    }
    return { content: lastContent || "Reached max steps.", steps };
  }

  private getTools(): OpenAIToolDefinition[] {
    return this.toolHub.getRegistry().snapshot().map((s: ToolSpec) => ({
      type: "function" as const,
      function: { name: s.name, description: s.description ?? "", parameters: s.inputSchema },
    }));
  }

  private parseArgs(json: string | undefined): unknown {
    if (!json) return {};
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
}
