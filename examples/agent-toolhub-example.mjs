import { createOpenAICompatibleClient, ReActAgent } from "../dist/llm-export.js";
import { createAgentToolHub } from "../dist/toolhub-runtime.js";

// Initialize ToolHub from examples/toolhub.yaml
const toolHub = await createAgentToolHub("examples/toolhub.yaml");

// Use ToolHub in ReActAgent
const llm = createOpenAICompatibleClient("http://192.168.0.201:11434/v1", "gpt-oss:latest");
const agent = new ReActAgent(llm, toolHub);

try {
  const { content, steps } = await agent.run(
    `Complete in order. Call each tool once per step; then go to next step.
Step 1: Get current system date/time (reference "now").
Step 2: Fetch Tesla (TSLA) stock data.
Step 3: Call "tools/search" with a query (e.g. "Tesla news"). Do not pass query to tools/filesystem.
Step 4: Write a ~3000-word report: short company overview, stock performance, news, outlook. Include reference date/time.
Step 5: Call "tools/filesystem" with action "write", path "tesla-report.html", text = report HTML. In final reply show the "absolutePath" returned. Do not pass query to tools/filesystem.`,
  );
  console.log("Reply:", content, "\nSteps:", steps);
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await toolHub.shutdown();
}
