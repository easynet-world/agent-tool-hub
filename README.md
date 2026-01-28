# Agent Tool Hub

**One registry, many protocols** — discover and run tools from MCP, LangChain, n8n, ComfyUI, and SKILL through a single PTC runtime.

## Install

```bash
npm install agent-tool-hub
```

Node 18+ required.

## Use

**CLI** — add a `toolhub.yaml` in your project, then:

```bash
npx agent-tool-hub scan    # load tools from configured roots
npx agent-tool-hub verify  # scan and exit 1 on errors
npx agent-tool-hub list    # list discovered tools
```

**In code** — load from config, init, then invoke:

```ts
import { createToolHubAndInitFromConfig } from "agent-tool-hub";

const hub = await createToolHubAndInitFromConfig("toolhub.yaml");
const result = await hub.invokeTool("utils.calculator", { expression: "1 + 2" });
// result.ok, result.data, result.error, etc.
```

Or build the hub yourself: `createToolHub(options)` → `await hub.initAllTools()`; run tools with `hub.invokeTool(name, args, options)`.

See `toolhub.yaml` for config and `examples/` for tool layouts.
