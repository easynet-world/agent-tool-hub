# Agent Tool Hub

**One registry, many protocols** — MCP, LangChain, n8n, SKILL in one PTC runtime. [Source](https://github.com/easynet-world/agent-tool-hub) Drop a folder under a root; one tool can expose multiple protocols.

---

## What we support

| Supported tools | How to write | Spec |
|-----------------|--------------|------|
| **SKILL** | We fully support the SKILL spec with any LLM.<br>[Examples](examples/tools/yahoo-finance/skill/)<br>[SKILL spec and our implementation support](docs/AGENT_SKILLS_SPEC.md) | [Agent Skills (Anthropic)](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview) |
| **LangChain** | Export a `StructuredTool` in `langchain/`; we auto-discover.<br>[Examples](examples/tools/filesystem/langchain/) | [LangChain Tools](https://js.langchain.com/docs/modules/agents/tools/) |
| **MCP** | Put `mcp.json` (Cursor-style) in `mcp/`; we connect as client.<br>We recommend [easy-mcp-server](https://www.npmjs.com/package/easy-mcp-server) for writing MCP servers.<br>[Example](examples/tools/web-search/mcp/) | [MCP Specification](https://modelcontextprotocol.io/specification/latest) |
| **n8n** | Put workflow JSON in `n8n/`; we run local n8n.<br>[@easynet/n8n-local](https://www.npmjs.com/package/@easynet/n8n-local) | [n8n Workflows](https://docs.n8n.io/workflows/) |

---

## Install

Node 18+.

**Default** — MCP / LangChain / SKILL only (~tens of MB):

```bash
npm install @easynet/agent-tool-hub
```

**+ n8n** — workflows / stock example (~1.3GB):

```bash
npm install @easynet/agent-tool-hub @easynet/n8n-local
```

---

## Run the stock research example

ReAct + yahoo-finance SKILL + HTML report. After [install](#install):

```bash
npx agent-toolhub-react-stock GOOGL
```

Ticker: `GOOGL`, `AAPL`, `MSFT`. Set LLM in [examples/agent-toolhub-react-stock.mjs](examples/agent-toolhub-react-stock.mjs) or env (`OPENAI_API_KEY`, `OPENAI_BASE_URL`). Output: console + `GOOGL-research-report.html`. [Sample report](https://easynet-world.github.io/agent-tool-hub/AAPL-research-report.html).

| Report | Debug |
|--------|-------|
| [![Report tab](docs/report-1.png)](docs/report-1.png) | [![Debug tab](docs/report-2.png)](docs/report-2.png) |

---

## Use

### Embed in LangChain

```ts
import { createAgentToolHub } from "@easynet/agent-tool-hub/langchain-tools";

// 1. Init runtime (loads tools from toolhub.yaml)
const toolHub = await createAgentToolHub("toolhub.yaml");

// 2. Create your LangChain agent, pass our tools, and run
const agent = createAgent({
  model: new ChatOpenAI({ temperature: 0 }),
  tools: toolHub.tools, // discovered tools from SKILL / LangChain / MCP / n8n
});
const stream = await agent.stream(/* your messages */);
// ...

// 3. Shutdown
await toolHub.shutdown();
```

Optional: `formatStepProgress(step)` for console; `writeReportFromStream(stream, { htmlReportPath, onStep })` for HTML report.

---

## Code reference

[SKILL](#skill) · [LangChain](#langchain) · [MCP](#mcp) · [n8n](#n8n).

### SKILL

Markdown (SKILL.md) under `skill/`. Progressive disclosure:

- **Level 1** = frontmatter (name, description)
- **Level 2** = body (instructions)
- **Level 3** = resources (e.g. `references/`, `scripts/`, `assets/`) — scanned from the skill dir, exposed as resource list; agents can reference them by path

[Spec & impl](docs/AGENT_SKILLS_SPEC.md).

```markdown
# skill/SKILL.md
---
name: my-tool
description: What your tool does.
---

# Instructions (Level 2)

Steps the agent should follow when using this skill.

# Level 3 (resources)

Put files under the skill dir (e.g. `references/REFERENCE.md`, `scripts/`, `assets/`). They appear in the resource list and can be read by path.
```

### LangChain

Export a LangChain tool (e.g. `StructuredTool`). Put under `langchain/`:

```js
// langchain/calculator.js
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

class CalculatorTool extends StructuredTool {
  name = "calculator";
  description = "Evaluates arithmetic expressions";
  schema = z.object({ expression: z.string() });
  async _call({ expression }) {
    return String(Function(`"use strict"; return (${expression})`)());
  }
}
export default new CalculatorTool();
```

### MCP

MCP **client** only; put Cursor-style `mcp.json` under `mcp/`. MCP servers: [easy-mcp-server](https://www.npmjs.com/package/easy-mcp-server).

```json
// mcp/mcp.json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": ["./server.js"]
    }
  }
}
```

### n8n

Workflow JSON under `n8n/`; local server via [@easynet/n8n-local](https://www.npmjs.com/package/@easynet/n8n-local). Optional: `npm install @easynet/n8n-local`.

```json
// n8n/workflow.json
{
  "name": "My Workflow",
  "nodes": [
    {
      "id": "webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": { "path": "my-tool", "httpMethod": "POST" }
    }
  ],
  "connections": {}
}
```
