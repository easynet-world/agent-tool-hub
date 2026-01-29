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
 * Report (if the agent completes the write step): examples/output/sp500-top20-report.html
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAgentToolHub } from "../dist/toolhub-runtime.js";
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

/** Report output path (relative to process.cwd(); file written by tools/filesystem). */
const REPORT_PATH = "examples/output/sp500-top20-report.html";

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
// Use exact tool names from the registry (yahoo-finance-skill, tools/web-search-mcp, system-time-skill, tools/filesystem).
const SYSTEM_PROMPT = `You are an expert equity analyst. Your task is to identify the top 20 S&P 500 stocks by market capitalization, perform full analysis and prediction for each, and produce a single consolidated report. The report must be at least 5000 words: full analysis, detailed company overviews, performance context, and explicit predictions/outlook for each stock and for the market.

## Tool names (call only these exact names)
- **yahoo-finance-skill**: Get current quote data for a stock. Call with \`{ "symbol": "AAPL" }\` (use ticker symbol).
- **tools/web-search-mcp**: Search the web for news, fundamentals, or market data. Use for company news and sector outlook.
- **system-time-skill**: Get current date/time (use for "as of" in the report).
- **tools/filesystem**: Read/write files. For the final HTML report you MUST use this tool (not write_file): action "write", path \`${REPORT_PATH}\`, text = full HTML. This writes to the project so the user sees the file.

You also have built-in tools: write_todos, ls, read_file, write_file, edit_file, glob, grep, execute, task. Use only the tool names listed above or these built-in names—never invent or guess tool names (e.g. do not use "functions", "functions?", or similar).

**Critical: Tool arguments must be valid JSON only.** When you call a tool, pass ONLY the JSON object as arguments—no reasoning, no explanation, no text before or after. Example: for yahoo-finance-skill use exactly \`{"symbol":"AAPL"}\` and nothing else. Do not put your planning or thoughts inside the tool arguments.

## Workflow
1. Identify the current top 20 S&P 500 constituents by market cap (use tools/web-search-mcp if needed, or use a known list: AAPL, MSFT, NVDA, GOOGL, AMZN, META, BRK.B, UNH, JNJ, JPM, etc. — verify or update with a search).
2. For each stock: call yahoo-finance-skill with its symbol; use tools/web-search-mcp for recent news, fundamentals, and outlook where helpful.
3. For each stock, write a full analysis: company overview (business, sector, competitive position), current price/volume and key metrics, performance context (recent moves, catalysts), and an explicit prediction/outlook (price or direction, timeframe, risks).
4. Write one consolidated HTML report of at least 5000 words including:
   - Executive summary and reference date/time (from system-time-skill).
   - For each of the 20 stocks: full analysis and predictions as above (enough text to reach 5000+ words total).
   - Market-level summary: sector themes, risks, and overall market prediction/outlook.
   - Caveats and disclaimers.
5. Save the final report using **tools/filesystem** only (not the built-in write_file): call tools/filesystem with action "write", path exactly \`${REPORT_PATH}\`, and text = the full HTML string (must be 5000+ words). This writes to the project folder so the user can open the file.
6. In your final reply, confirm the report was written and state the absolutePath returned by tools/filesystem.

Be thorough: the report must exceed 5000 words with full analysis and predictions for all 20 stocks and the market.`;

// --- User task ---
const USER_TASK = `Pick the top 20 S&P 500 stocks by market cap, do a full analysis and prediction for each, and generate one consolidated HTML report. The report body text must be at least 5000 words: for each stock write a full company overview (business, sector, competitive position), performance context, key metrics, and explicit predictions/outlook; add an executive summary and a market-level summary with predictions. Before saving, ensure the report content exceeds 5000 words—add more detailed analysis if needed. Save using **tools/filesystem** (not write_file): action "write", path "${REPORT_PATH}", text = the full HTML. Then confirm the file path in your reply.`;

/** Shorter task for demo: 3 stocks only, so the agent completes and writes the file. Set DEMO=1 or SP500_DEMO=1. */
const USER_TASK_DEMO = `Get quote data for AAPL, MSFT, and NVDA using yahoo-finance-skill (call with {"symbol":"AAPL"} etc.). Get current time with system-time-skill. Write a short HTML report (title, date, table with symbol, name, price for each) and save it using **tools/filesystem** only: action "write", path "${REPORT_PATH}", text = the HTML. Then reply with the absolutePath returned.`;

/** Long demo: 3 stocks but report must be at least 1500 words (full analysis and predictions per stock). Set DEMO=1 and LONG_REPORT=1. */
const USER_TASK_DEMO_LONG = `Get quote data for AAPL, MSFT, and NVDA using yahoo-finance-skill (call with {"symbol":"AAPL"}, {"symbol":"MSFT"}, {"symbol":"NVDA"}). Get current time with system-time-skill. Write a detailed HTML report of at least 1500 words: for each stock include a full company overview (business, sector, competitive position), current price and key metrics, performance context, and explicit predictions/outlook; add an executive summary and a short market summary. The report body text must exceed 1500 words. Save it using **tools/filesystem** only: action "write", path "${REPORT_PATH}", text = the full HTML. Then reply with the absolutePath returned.`;

async function main() {
  const cwd = process.cwd();
  const reportAbsPath = resolve(cwd, REPORT_PATH);
  await mkdir(resolve(cwd, "examples/output"), { recursive: true });

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
  const recursionLimit = Number(process.env.RECURSION_LIMIT) || 150;
  const config = {
    configurable: { thread_id: threadId },
    recursionLimit,
  };

  const useDemo = process.env.DEMO === "1" || process.env.SP500_DEMO === "1";
  const useLongReport = process.env.LONG_REPORT === "1" || process.env.LONG_REPORT === "true";
  const task = useDemo ? (useLongReport ? USER_TASK_DEMO_LONG : USER_TASK_DEMO) : USER_TASK;
  if (useDemo) console.log(useLongReport ? "Demo mode: 3 stocks, long report (1500+ words).\n" : "Demo mode: 3 stocks, short report.\n");

  try {
    const result = await agent.invoke(
      {
        messages: [{ role: "user", content: task }],
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

    if (existsSync(reportAbsPath)) {
      console.log("Report file written:", reportAbsPath);
    } else {
      console.log("Report file not found at:", reportAbsPath, "(agent may not have completed the write step; run with more steps or check final reply)");
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await toolHub.shutdown();
  }
}

main();
