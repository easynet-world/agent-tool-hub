# agent-tool-hub Tools

agent-tool-hub is a multi-protocol tool registry + PTC runtime that unifies discovery, governance, and execution for tools across MCP, LangChain, n8n, SKILL, and built-in core tools.

## What We Support

### Protocols / Tool Types

| Type | How it’s discovered/connected | Typical use |
| --- | --- | --- |
| MCP | `mcp.json` (stdio or SSE/HTTP) | Remote tool servers / ecosystem tools |
| LangChain Tool | `index.js/.mjs` or `langchain/` directory | Local code tools |
| n8n Workflow | `workflow.json` | Automation workflows |
| SKILL (Anthropic) | `SKILL.md` (optional `handler.js/.mjs`) | Instructional skills / subflows |
| Core Tools (built-in) | `roots: coreTools` | Safe FS / HTTP / Utils |

### Core Capabilities

- Unified ToolSpec abstraction with JSON Schema
- PTC runtime: validation, policy gating, budgets/retries, evidence
- Multi-root discovery with namespaces and optional hot-reload
- Security baseline: sandbox paths, allowlists, SSRF protections
- Observability: events, metrics, tracing
- Async workflows for n8n

## Quick Start

### Install

```bash
npm i agent-tool-hub
```

- Node >= 18
- Optional peers: `@langchain/core`, `@modelcontextprotocol/sdk`

### Configure via `toolhub.yaml`

agent-tool-hub is configured by a YAML file. Keep it simple:

```yaml
discovery:
  roots:
    - path: ./tools
      namespace: app
    - path: coreTools
      namespace: core
      config:
        sandboxRoot: /tmp/toolhub-sandbox
        allowedHosts:
          - api.github.com
          - "*.example.com"

adapters:
  n8n:
    mode: api
    api:
      apiBaseUrl: http://localhost:5678
      apiKey: ""
```

Your framework can load this config and initialize agent-tool-hub accordingly.

### Initialize from a config file path

```ts
import { createAgentToolHub } from "agent-tool-hub";

const hub = await createAgentToolHub("./toolhub.yaml");
```

### List tools

```ts
const tools = hub.listToolMetadata();
// [{ name, description }, ...]
```

### Invoke a tool

```ts
const result = await hub.invokeTool(
  "core/http.fetchJson",
  { url: "https://api.github.com" },
  {
    permissions: ["network", "read:web"],
    budget: { timeoutMs: 10_000, maxRetries: 1 },
  },
);

if (!result.ok) {
  console.error(result.error);
}
```

## Tool Discovery Rules

- All subdirectories under each `roots` entry are scanned.
- Tool kind is inferred by marker files:
  `SKILL.md` / `workflow.json` / `mcp.json` / `index.js(.mjs)`
- Avoid mixing multiple marker files in the same folder.

Example structure:

```
tools/
  weather/
    mcp.json
  notify/
    workflow.json
```

## Add a New Tool (Recommended)

### 1) Create a tool folder

```
./tools/my-tool/
```

### 2) Add the tool implementation by kind

#### MCP tool

Add `mcp.json`:

```json
{ "command": "npx", "args": ["-y", "your-mcp-server"] }
```

or remote:

```json
{ "url": "https://mcp.example.com" }
```

#### LangChain tool

Create `index.js/.mjs` that implements LangChain's interface (e.g., `StructuredTool`):

```js
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

class CalculatorTool extends StructuredTool {
  name = "calculator";
  description = "Evaluates simple arithmetic expressions";

  schema = z.object({
    expression: z.string(),
  });

  async _call({ expression }) {
    const sanitized = expression.replace(/[^0-9+\\-*/().% ]/g, "");
    if (sanitized !== expression) {
      throw new Error("Invalid characters in expression");
    }
    const result = Function(`\"use strict\"; return (${sanitized})`)();
    return String(result);
  }
}

export default new CalculatorTool();
```

#### n8n workflow

Add `workflow.json` with a `nodes` array:

```json
{ "id": "wf-123", "name": "send-slack", "nodes": [] }
```

- Set `adapters.n8n.mode: api | local` in `toolhub.yaml`.
- Local mode auto-imports/syncs workflows.

#### SKILL

Add `SKILL.md` (Anthropic Skills format):

```md
---
name: send-email
description: Sends a confirmation email when user completes checkout.
---

Instructions go here.
```

Optional `handler.js/.mjs` can provide executable logic.

## Core Tools (Built-in)

- FS: `core/fs.readText`, `core/fs.writeText`, `core/fs.listDir`, `core/fs.searchText`, `core/fs.sha256`, `core/fs.deletePath`
- HTTP: `core/http.fetchText`, `core/http.fetchJson`, `core/http.downloadFile`, `core/http.head`
- Utils: `core/util.jsonSelect`, `core/util.truncate`, `core/util.hashText`, `core/util.now`, `core/util.templateRender`

Enable via `roots` entry `coreTools` and provide `sandboxRoot` + `allowedHosts`.

## Permissions and Capabilities

Common capabilities:

- `read:web`, `network`
- `read:fs`, `write:fs`
- `read:db`, `write:db`
- `workflow`, `gpu`
- `danger:destructive`

Pass `permissions` when invoking tools to satisfy policy gates.
