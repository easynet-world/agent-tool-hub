# Agent Tool Hub

**One registry, many protocols** — discover and run tools from MCP, LangChain, n8n, and SKILL through a single PTC runtime.

Define tools with simple, familiar formats: drop a folder under a configured root and use the protocol you like. One tool can be exposed in multiple protocols in the same folder.

---

### SKILL

Markdown spec + JS handler. Put under `skill/`:

```yaml
# skill/SKILL.md
---
name: my-tool
description: What your tool does.
---
```

```js
// skill/handler.js
async function handler(args) {
  const { x, y } = args ?? {};
  return { result: { sum: Number(x) + Number(y) } };
}
export default handler;
```

---

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

---

### MCP

Declare MCP server in JSON. Put under `mcp/`; the server process is started by the hub:

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

---

### n8n

Drop an n8n workflow JSON. Put under `n8n/`; the hub runs it (local or via API):

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

---


## Install

```bash
npm install @easynet/agent-tool-hub
```

Node 18+ required.

---

## Use

### CLI

Copy `toolhub.example.yaml` to `toolhub.yaml` in your project (or use `-c path/to/config.yaml`), then:

```bash
npx agent-tool-hub scan    # load tools from configured roots
npx agent-tool-hub verify  # scan and exit 1 on errors
npx agent-tool-hub list    # list discovered tools
```

### In code

Recommended — create and init in one call:

```ts
import { createAgentToolHub } from "@easynet/agent-tool-hub";

const toolHub = await createAgentToolHub("toolhub.yaml");
const result = await toolHub.invokeTool("utils.calculator", { expression: "1 + 2" });
```

---

See `toolhub.example.yaml` for config example and `examples/` for full tool layouts.

### Enhanced example (DeepAgents + S&P 500)

A second example uses **LangChain 1.x** and **DeepAgents** (instead of the built-in ReAct agent) to run a more complex task: pick the top 20 S&P 500 stocks by market cap, analyze and predict, and generate an HTML report. Run it with:

```bash
npm run build
npm run example:agent-toolhub-deepagents-sp500
```

For a quick run that writes the report file (3 stocks): `npm run example:agent-toolhub-deepagents-sp500:demo` or `DEMO=1 npm run example:agent-toolhub-deepagents-sp500`. Report path: `examples/output/sp500-top20-report.html`. Optional env: `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`, `RECURSION_LIMIT`, `DEMO` (or `SP500_DEMO=1`).

Requires devDependencies: `deepagents`, `langchain`, `@langchain/openai`, `zod`. If you see peer dependency conflicts (e.g. with `@easynet/n8n-local`), run `npm install --legacy-peer-deps`.
