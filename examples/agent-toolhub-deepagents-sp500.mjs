/**
 * Enhanced example (issue #22): DeepAgents + LangChain 1.x + S&P 500 analysis.
 *
 * Uses DeepAgents (instead of ReAct) with LangChain 1.x. Task: pick top 20 S&P 500
 * stocks by market cap, perform full analysis and prediction, and generate a report.
 *
 * Prerequisites:
 *   npm install (includes deepagents, langchain, @langchain/openai, zod as devDependencies)
 *   Build: npm run build
 *   Optional: set OPENAI_BASE_URL and OPENAI_MODEL for your LLM (default: local OpenAI-compatible)
 *
 * Run: node examples/agent-toolhub-deepagents-sp500.mjs
 */

import { createAgentToolHub } from "../dist/toolhub-runtime.js";
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// --- ToolHub → LangChain tools (for DeepAgents) ---
function toolHubToLangChainTools(toolHub) {
  const registry = toolHub.getRegistry();
  const specs = registry.snapshot();
  return specs.map((spec) =>
    tool(
      async (args) => {
        const result = await toolHub.invokeTool(spec.name, args ?? {});
        if (result.ok) return result.result;
        return { error: result.error?.message ?? "Tool failed" };
      },
      {
        name: spec.name,
        description: spec.description ?? `Tool: ${spec.name}`,
        schema: z.record(z.string(), z.unknown()).describe("Tool arguments as key-value object"),
      }
    )
  );
}

// --- System prompt: equity analyst + tool usage ---
const SYSTEM_PROMPT = `You are an expert equity analyst. Your task is to identify the top 20 S&P 500 stocks by market capitalization, perform full analysis and prediction for each, and produce a single consolidated report.

## Tools
- **tools/yahoo-finance**: Get current quote data for a stock. Call with \`{ "symbol": "AAPL" }\` (use ticker symbol).
- **tools/web-search**: Search the web for news, fundamentals, or market data. Use for company news and sector outlook.
- **tools/system-time**: Get current date/time (use for "as of" in the report).
- **tools/filesystem**: Read/write files. Use action "write" with path and text to save the final report (e.g. path "sp500-top20-report.html", text = full HTML report).

## Workflow
1. Identify the current top 20 S&P 500 constituents by market cap (use web-search if needed, or use a known list: AAPL, MSFT, NVDA, GOOGL, AMZN, META, BRK.B, UNH, JNJ, JPM, etc. — verify or update with a search).
2. For each stock: call tools/yahoo-finance with its symbol; optionally use web-search for recent news and outlook.
3. For each stock, summarize: company overview, current price/volume, brief performance context, and a short prediction (outlook).
4. Write one consolidated HTML report including:
   - Title and reference date/time (from tools/system-time).
   - Table or sections for all 20 stocks with: symbol, name, price, key metrics, outlook.
   - Brief market summary and any caveats.
5. Save the report to a file using tools/filesystem (action "write", path "sp500-top20-report.html", text = the HTML string).
6. In your final reply, confirm the report was written and state the absolutePath returned by the filesystem tool.

Be thorough but efficient: use tools in batches where it helps, and produce a clear, readable report.`;

// --- User task ---
const USER_TASK = `Pick the top 20 S&P 500 stocks by market cap, do a full analysis and prediction for each, and generate one consolidated HTML report. Save the report as sp500-top20-report.html using the filesystem tool, then confirm the file path in your reply.`;

async function main() {
  const configPath = "examples/toolhub.yaml";
  const toolHub = await createAgentToolHub(configPath);

  const hubTools = toolHubToLangChainTools(toolHub);
  const baseURL = process.env.OPENAI_BASE_URL ?? "http://192.168.0.201:11434/v1";
  const modelName = process.env.OPENAI_MODEL ?? "gpt-oss:latest";

  const llm = new ChatOpenAI({
    model: modelName,
    temperature: 0,
    configuration: {
      baseURL,
      apiKey: process.env.OPENAI_API_KEY ?? "not-needed",
    },
  });

  const agent = await createDeepAgent({
    model: llm,
    tools: hubTools,
    systemPrompt: SYSTEM_PROMPT,
  });

  const threadId = `sp500-${Date.now()}`;
  const config = { configurable: { thread_id: threadId } };

  try {
    const result = await agent.invoke(
      {
        messages: [{ role: "user", content: USER_TASK }],
      },
      config
    );

    const messages = result?.messages ?? result?.state?.messages ?? [];
    const debug = process.env.DEBUG === "1" || process.env.DEBUG === "true";
    if (debug && result) {
      process.stderr.write("Result keys: " + Object.keys(result).join(", ") + "\n");
      if (messages.length) process.stderr.write("Last message keys: " + Object.keys(messages[messages.length - 1] || {}).join(", ") + "\n");
    }

    let content = "(no content)";
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const raw = msg?.content ?? msg?.text ?? msg?.lc_kwargs?.content;
      if (raw != null && String(raw).trim() !== "") {
        content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => (typeof p === "string" ? p : p?.text ?? JSON.stringify(p))).join("\n") : JSON.stringify(raw);
        break;
      }
    }
    if (content === "(no content)" && messages.length > 0) {
      content = `Run completed. ${messages.length} message(s); last message had no text (agent may have ended on a tool step). Check todos/files in state or re-run with more steps.`;
    }
    console.log("Final reply:", content);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await toolHub.shutdown();
  }
}

main();
