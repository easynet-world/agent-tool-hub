import { createOpenAICompatibleClient, ReActAgent } from "../dist/llm-export.js";
import { createAgentToolHub } from "../dist/toolhub-runtime.js";

// Initialize ToolHub from examples/toolhub.yaml
const toolHub = await createAgentToolHub("examples/toolhub.yaml");

// Use ToolHub in ReActAgent
const llm = createOpenAICompatibleClient("http://localhost:11434/v1", "qwen3:0.6b");
const agent = new ReActAgent(llm, toolHub);

try {
  const { content, steps } = await agent.run("你好，用一句话介绍你自己。");
  console.log("Reply:", content, "\nSteps:", steps);
} catch (err) {
  console.error(err);
  process.exit(1);
}
