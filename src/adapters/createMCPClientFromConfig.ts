/**
 * Create an MCP client from a stdio-based config (command + args).
 * Requires @modelcontextprotocol/sdk (peer dependency); use dynamic import so it's optional.
 * Use this when you already have the config object (e.g. from discovery spec.impl).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MCPClientLike } from "./MCPAdapter.js";
import type { MCPServerConfig } from "../discovery/types.js";

export interface MCPStdioConfig {
  command?: string;
  args?: string[];
  package?: string;
  env?: Record<string, string>;
}

export interface CreateMCPClientResult {
  client: MCPClientLike;
  close: () => Promise<void>;
}

/**
 * Create an MCP client from a stdio server config (command + args).
 * Skips URL-based configs; returns only for stdio configs.
 */
export async function createMCPClient(
  config: MCPServerConfig,
): Promise<CreateMCPClientResult | null> {
  if (config.url) return null;
  const command = config.command ?? "npx";
  const args = Array.isArray(config.args)
    ? config.args
    : ["-y", "@modelcontextprotocol/inspector"];
  const envRaw =
    config.env && typeof config.env === "object"
      ? { ...process.env, ...config.env }
      : undefined;
  const env = envRaw
    ? (Object.fromEntries(
        Object.entries(envRaw).filter(
          (entry): entry is [string, string] => entry[1] != null,
        ),
      ) as Record<string, string>)
    : undefined;

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );

  const transport = new StdioClientTransport({
    command,
    args,
    env,
  });
  const client = new Client({ name: "toolhub-mcp", version: "1.0.0" });
  await client.connect(transport);

  // ToolHub is not a server; unref the MCP child process and its streams so the
  // main process can exit when the script is done (process and MCP close together).
  // StdioClientTransport has private _process; cast via unknown for declaration emit.
  const proc = (transport as unknown as { _process?: { unref?: () => void; stdin?: { unref?: () => void }; stdout?: { unref?: () => void }; stderr?: { unref?: () => void } } })._process;
  if (proc?.unref) proc.unref();
  if (proc?.stdin?.unref) proc.stdin.unref();
  if (proc?.stdout?.unref) proc.stdout.unref();
  if (proc?.stderr?.unref) proc.stderr.unref();

  const wrapper: MCPClientLike = {
    listTools: async () => {
      const result = await client.listTools();
      const tools = (result.tools ?? []).map((t: { name?: string; description?: string; inputSchema?: unknown }) => ({
        name: t.name ?? "",
        description: t.description,
        inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as object,
      }));
      return { tools };
    },
    callTool: async (params) => {
      const result = await client.callTool({
        name: params.name,
        arguments: params.arguments ?? {},
      });
      const content = Array.isArray(result.content) ? result.content : [];
      return {
        content: content.map((c: { type?: string; text?: string; data?: unknown }) => ({
          type: c.type ?? "text",
          text: c.text,
          data: c.data,
        })),
        isError: result.isError === true,
      };
    },
  };

  const close = async () => {
    await transport.close();
  };

  return { client: wrapper, close };
}

/**
 * Create an MCP client from a stdio-based mcp.json path.
 * Reads the file and calls createMCPClient(parsed).
 */
export async function createMCPClientFromConfig(
  mcpJsonPath: string,
): Promise<CreateMCPClientResult> {
  const pathResolved = mcpJsonPath.startsWith("/")
    ? mcpJsonPath
    : resolve(process.cwd(), mcpJsonPath);
  const raw = await readFile(pathResolved, "utf-8");
  const parsed = JSON.parse(raw);
  const config: MCPServerConfig = parsed.url
    ? { url: parsed.url }
    : {
        command: parsed.command ?? "npx",
        args: Array.isArray(parsed.args)
          ? parsed.args
          : ["-y", parsed.package ?? "@modelcontextprotocol/inspector"],
        env:
          parsed.env && typeof parsed.env === "object"
            ? (Object.fromEntries(
                Object.entries(parsed.env).filter(
                  (e): e is [string, string] => e[1] != null,
                ),
              ) as Record<string, string>)
            : undefined,
      };
  const result = await createMCPClient(config);
  if (!result) {
    throw new Error("MCP config has url only; stdio (command/args) required for createMCPClientFromConfig path.");
  }
  return result;
}
