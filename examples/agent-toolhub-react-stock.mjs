import { resolve } from "node:path";
import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { createAgentToolHub } from "../dist/langchain-tools.js";
import { writeReportFromStream, formatStepProgress } from "../dist/index.js";

const SYMBOL = (process.argv[2] || "AAPL").toUpperCase();
const cwd = process.cwd();
const HTML_REPORT_PATH = `${SYMBOL}-research-report.html`;

const SYSTEM_PROMPT = `You are an expert equity analyst. Perform **deep research** on a single company/stock: investigate, analyze, speculate, then produce one detailed Markdown report (≥2000 words). Plain Markdown only (no HTML).

## Workflow
1. **Investigate**: Use yahoo-finance (or similar) with symbol "${SYMBOL}" for quote and metrics. Use web-search (or similar) for recent news, earnings, business model, competitors, industry outlook, risks.
2. **Analyze**: Synthesize into structured analysis: company overview, financials, competitive position, strengths/weaknesses, key metrics (P/E, revenue growth, margins, etc.).
3. **Speculate**: Give explicit outlook and predictions: price target rationale, catalysts, risks, time horizon. Support with evidence from your research.
4. **Report**: Write one Markdown report with: title, date (use system-time if available), executive summary, detailed analysis, speculation/outlook, risks and caveats. Total ≥2000 words.
5. Reply with confirmation and a brief summary.`;

const USER_TASK = `Perform deep research on stock/company "${SYMBOL}": investigate, analyze, speculate. Produce a detailed Markdown report (≥2000 words) and confirm.`;

async function main() {
  // 1. Create ToolHub runtime
  const toolHub = await createAgentToolHub("examples/toolhub.yaml");

  // 2. Create LangChain agent (regular LangChain usage)
  const agent = createAgent({
    model: new ChatOpenAI({
      model: "gpt-oss:latest",
      temperature: 0,
      configuration: { baseURL: "http://192.168.0.201:11434/v1" },
      apiKey: "not-needed",
    }),
    tools: toolHub.tools, // Add tools to agent
    systemPrompt: SYSTEM_PROMPT,
  });

  try {
  // 3. Run agent （regular LangChain usage）
  console.log(`Researching ${SYMBOL}...\n`);
    const stream = await agent.stream(
      { messages: [new HumanMessage(USER_TASK)] },
      { recursionLimit: 300 }
    );
 
    // 4. Generate report (optional for debugging)
    const result = await writeReportFromStream(stream, {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_TASK,
      htmlReportPath: resolve(cwd, HTML_REPORT_PATH),
      onStep: (step) => console.log(formatStepProgress(step)),
    });
    console.log("");
    if (result.htmlPath) console.log(`Report: ${result.htmlPath}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await toolHub.shutdown();
  }
}

main();
