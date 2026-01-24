import type { ToolSpec } from "../../src/types/ToolSpec.js";
import type { ExecContext, ToolIntent } from "../../src/types/ToolIntent.js";

/**
 * Test fixture: a simple calculator tool spec.
 */
export const calcToolSpec: ToolSpec = {
  name: "test/calculator",
  version: "1.0.0",
  kind: "langchain",
  description: "A simple calculator tool",
  tags: ["math", "utility"],
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
      op: { type: "string", enum: ["+", "-", "*", "/"], default: "+" },
    },
    required: ["a", "b"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "number" },
    },
    required: ["result"],
    additionalProperties: false,
  },
  capabilities: [],
};

/**
 * Test fixture: a file write tool spec (with capabilities).
 */
export const fileWriteToolSpec: ToolSpec = {
  name: "test/file_write",
  version: "1.0.0",
  kind: "langchain",
  description: "Writes content to a file",
  tags: ["io", "file"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      bytesWritten: { type: "number" },
    },
    required: ["ok"],
    additionalProperties: false,
  },
  capabilities: ["write:fs"],
};

/**
 * Test fixture: a destructive tool spec.
 */
export const destructiveToolSpec: ToolSpec = {
  name: "test/drop_table",
  version: "1.0.0",
  kind: "langchain",
  description: "Drops a database table",
  inputSchema: {
    type: "object",
    properties: { table: { type: "string" } },
    required: ["table"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
  capabilities: ["write:db", "danger:destructive"],
};

/**
 * Test fixture: an n8n workflow tool spec.
 */
export const n8nSlackToolSpec: ToolSpec = {
  name: "workflow/send_slack_message",
  version: "1.0.0",
  kind: "n8n",
  description: "Send a Slack message via n8n workflow",
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string" },
      text: { type: "string" },
    },
    required: ["channel", "text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      ts: { type: "string" },
    },
    required: ["ok"],
    additionalProperties: true,
  },
  capabilities: ["workflow", "network"],
  endpoint: "https://n8n.example.com/webhook/xxx",
  resourceId: "slack_send_message",
};

/**
 * Test fixture: default execution context.
 */
export const defaultCtx: ExecContext = {
  requestId: "req-001",
  taskId: "task-001",
  permissions: ["read:web", "network", "workflow"],
  budget: { timeoutMs: 5000, maxRetries: 1 },
  traceId: "trace-001",
  userId: "user-test",
};

/**
 * Test fixture: full permission context.
 */
export const fullPermCtx: ExecContext = {
  requestId: "req-002",
  taskId: "task-002",
  permissions: [
    "read:web",
    "read:fs",
    "write:fs",
    "read:db",
    "write:db",
    "network",
    "gpu",
    "workflow",
    "danger:destructive",
  ],
  budget: { timeoutMs: 10000, maxRetries: 2 },
  traceId: "trace-002",
  userId: "user-admin",
};

/**
 * Create a simple ToolIntent.
 */
export function makeIntent(
  tool: string,
  args: unknown,
  purpose = "test",
): ToolIntent {
  return {
    tool,
    args,
    purpose,
    idempotencyKey: `test:${tool}:${Date.now()}`,
  };
}
