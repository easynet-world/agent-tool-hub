/**
 * Slim entry: LLM client + ReActAgent only (no ToolHub/n8n/MCP).
 * Use for examples or apps that only need OpenAICompatibleClient and ReActAgent.
 */

export {
  createOpenAICompatibleClient,
  OpenAICompatibleClient,
} from "./llm/OpenAICompatibleClient.js";
export type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  OpenAICompatibleClientConfig,
  OpenAIToolDefinition,
  AssistantMessageWithToolCalls,
  ChatWithToolsResult,
} from "./llm/OpenAICompatibleClient.js";

export { ReActAgent } from "./llm/ReActAgent.js";
export type {
  ReActAgentToolHub,
  ReActAgentRunOptions,
  ReActAgentRunResult,
} from "./llm/ReActAgent.js";
