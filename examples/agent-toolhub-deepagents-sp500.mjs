/**
 * S&P 500 analysis example: ReAct agent + ToolHub.
 * Picks top 10 S&P 500 stocks by market cap, full analysis and prediction, generates a long Markdown report (2500+ words).
 *
 * Prerequisites: npm install, npm run build
 * Optional: OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY, RECURSION_LIMIT
 * Run: node examples/agent-toolhub-deepagents-sp500.mjs
 * Report: examples/output/sp500-top10-report.md
 */

import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAgentToolHub } from "../dist/toolhub-runtime.js";
import { ReActAgent, createOpenAICompatibleClient } from "../dist/llm-export.js";

const REPORT_DIR = "examples/output";
const REPORT_PATH = `${REPORT_DIR}/sp500-top10-report.md`;

const SYSTEM_PROMPT = `You are an expert equity analyst. Your task is to identify the top 10 S&P 500 stocks by market capitalization, perform full analysis and prediction for each, and produce a single consolidated report in **Markdown** (not HTML). The report body must be at least 2500 words. A short table-only report is NOT acceptable—you must include full analysis and predictions for all 10 stocks.

## Tools (use ONLY these four)
- **yahoo-finance-skill**: Get quote data for a stock. Call with {"symbol":"AAPL"} (use ticker symbol).
- **tools/web-search-mcp**: Search the web for news, fundamentals, or market data.
- **system-time-skill**: Get current date/time (use for "as of" in the report).
- **tools/filesystem**: Use for all file operations. To write the final report: {"action":"write","path":"${REPORT_PATH}","text":"<full Markdown content>"}. Use tools/filesystem only—no other file or todo tools.

## Workflow
1. Identify the current top 10 S&P 500 constituents by market cap (use tools/web-search-mcp or known list: AAPL, MSFT, NVDA, GOOGL, AMZN, META, BRK.B, UNH, JNJ, JPM).
2. For each stock: call yahoo-finance-skill with its symbol; use tools/web-search-mcp for news/outlook where helpful.
3. For each stock, write a full analysis: company overview (business, sector, position), price/volume and key metrics, performance context, and explicit prediction/outlook. Each stock must have at least 200 words of analysis.
4. Write one consolidated **Markdown** report: use headers (##), lists, and paragraphs; include executive summary and date/time (system-time-skill); for each of the 10 stocks a full analysis and predictions (200+ words per stock); market-level summary and caveats. Total body text must exceed 2500 words. Do not use HTML.
5. Save the report using **tools/filesystem**: action "write", path exactly "${REPORT_PATH}", text = the full Markdown. Do not save until the report has 2500+ words of content.
6. After saving, reply with a short confirmation and the report file path.

Critical: the report must be plain Markdown (no HTML) and contain at least 2500 words of readable analysis and predictions. Include full paragraphs for each stock and the market.`;

const USER_TASK = `Pick the top 10 S&P 500 stocks by market cap, do a full analysis and prediction for each, and generate one consolidated **Markdown** report (not HTML). The report body text must be at least 2500 words—for each stock write a full company overview (business, sector, competitive position), performance context, key metrics, and explicit predictions/outlook (at least 200 words per stock); add an executive summary and a market-level summary with predictions. Use Markdown only (headers, lists, paragraphs). Save the report using **tools/filesystem**: action "write", path "${REPORT_PATH}", text = the full Markdown. Then confirm the file path in your reply.`;

async function main() {
  const cwd = process.cwd();
  const reportAbsPath = resolve(cwd, REPORT_PATH);

  await mkdir(resolve(cwd, REPORT_DIR), { recursive: true });

  const toolHub = await createAgentToolHub("examples/toolhub.yaml");
  const baseUrl = process.env.OPENAI_BASE_URL ?? "http://192.168.0.201:11434/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-oss:latest";
  const client = createOpenAICompatibleClient(
    baseUrl,
    model,
    process.env.OPENAI_API_KEY ?? "not-needed"
  );
  const agent = new ReActAgent(client, toolHub);

  try {
    const result = await agent.run(USER_TASK, {
      systemPrompt: SYSTEM_PROMPT,
      maxSteps: Number(process.env.RECURSION_LIMIT) || 250,
    });

    console.log("Final reply:", result.content);
    if (existsSync(reportAbsPath)) {
      const content = await readFile(reportAbsPath, "utf8");
      const text = content.replace(/\s+/g, " ").trim();
      const words = text ? text.split(" ").length : 0;
      console.log("Report:", reportAbsPath);
      console.log("Report words:", words, words >= 2500 ? "(target met)" : "(target 2500+)");
    } else {
      console.log("Report not written.");
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await toolHub.shutdown();
  }
}

main();
