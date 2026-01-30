/**
 * Bridge: ToolHub registry → LangChain tools (for use with LangChain agents, e.g. DeepAgents).
 *
 * Requires peer dependencies: langchain, zod. Use this entry when integrating ToolHub
 * with LangChain 1.x agents. Main package entry does not depend on LangChain.
 *
 * @example
 * ```ts
 * import { createAgentToolHub, toolHubToLangChainTools } from "@easynet/agent-tool-hub/langchain-tools";
 * const hub = await createAgentToolHub("toolhub.yaml");
 * // hub.tools is the LangChain tools array
 * const agent = createDeepAgent({ tools: hub.tools, ... });
 * // Or: const tools = toolHubToLangChainTools(hub);
 * ```
 */

import { createAgentToolHub as createAgentToolHubFromRuntime } from "./toolhub-runtime.js";
import { tool } from "langchain";
import { z } from "zod";
import type { ToolSpec } from "./types/ToolSpec.js";
import type { ToolResult } from "./types/ToolResult.js";

/** Minimal interface for a hub that can list tools and invoke them (e.g. ToolHub, AgentToolHub). */
export interface ToolHubLike {
  getRegistry(): { snapshot(): ToolSpec[] };
  invokeTool(name: string, args: unknown): Promise<ToolResult>;
}

const TOOL_ARGS_SCHEMA = z
  .record(z.string(), z.unknown())
  .describe("Tool arguments as key-value object");

/**
 * Extracts a JSON object from tool args. Handles models that send text + JSON
 * (e.g. "Let's fetch.{\"symbol\":\"GOOGL\"}") by finding the last {...} and parsing.
 */
function extractToolArgs(args: unknown): Record<string, unknown> {
  if (args != null && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  const str = typeof args === "string" ? args : String(args ?? "");
  if (!str.trim()) return {};
  // Try parse whole string first
  try {
    const parsed = JSON.parse(str) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  // Find last { ... } and parse
  const lastBrace = str.lastIndexOf("{");
  if (lastBrace === -1) return {};
  try {
    const parsed = JSON.parse(str.slice(lastBrace)) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Sanitize tool name for LLM/API: slashes and chars that some backends mangle become underscores.
 * Invoke still uses the original spec.name.
 */
function toolNameForLLM(name: string): string {
  return name.replace(/[/.-]/g, "_");
}

/**
 * Converts a ToolHub (or AgentToolHub) registry into an array of LangChain tools.
 * Each tool delegates to hub.invokeTool(spec.name, args). Use with LangChain 1.x agents
 * (e.g. createDeepAgent from deepagents). Tool args are normalized: if the model
 * sends text + JSON (e.g. "reasoning{\"symbol\":\"AAPL\"}"), the JSON is extracted.
 * Tool names are sanitized for the LLM (e.g. tools/yahoo-finance → tools_yahoo_finance)
 * so OpenAI-compatible backends that mangle slashes still get a stable, matchable name.
 *
 * @param hub - Instance with getRegistry() and invokeTool(name, args)
 * @returns Array of LangChain tool instances (compatible with agent tools array)
 */
export function toolHubToLangChainTools(hub: ToolHubLike): unknown[] {
  const specs = hub.getRegistry().snapshot();
  return specs.map((spec) => {
    const opts = {
      name: toolNameForLLM(spec.name),
      description: spec.description ?? `Tool: ${spec.name}`,
      schema: TOOL_ARGS_SCHEMA,
    };
    // Cast opts to avoid TS2589 (excessively deep type instantiation) from langchain tool()
    const t = tool(
      async (args: unknown) => {
        const normalized = extractToolArgs(args);
        const result = await hub.invokeTool(spec.name, normalized);
        return result.ok
          ? result.result
          : { error: result.error?.message ?? "Tool failed" };
      },
      opts as Parameters<typeof tool>[1],
    );
    return t as unknown;
  });
}

/**
 * Create an AgentToolHub from a config path and return it with a `.tools` getter
 * that returns LangChain tools. Use with LangChain/DeepAgents agents.
 *
 * @param configPath - Path to toolhub.yaml (or other config file)
 * @returns AgentToolHub instance with `.tools` (array of LangChain tools)
 */
export async function createAgentToolHub(configPath: string) {
  const hub = await createAgentToolHubFromRuntime(configPath);
  return Object.assign(hub, {
    get tools(): unknown[] {
      return toolHubToLangChainTools(hub);
    },
  });
}
