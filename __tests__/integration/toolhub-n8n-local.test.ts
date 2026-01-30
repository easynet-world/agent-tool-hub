import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { createToolHub } from "../../src/tool-hub/ToolHub.js";

const require = createRequire(import.meta.url);
const hasN8nLocal = ((): boolean => {
  try {
    require.resolve("@easynet/n8n-local");
    return true;
  } catch {
    return false;
  }
})();

const findAvailablePort = async (startPort = 23000): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(startPort, () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      findAvailablePort(startPort + 1).then(resolve).catch(reject);
    });
  });
};

describe.skipIf(!hasN8nLocal)("ToolHub n8n-local real integration", () => {
  let toolsRoot: string;
  let dataDir: string;
  let toolHub: ReturnType<typeof createToolHub>;
  let restoreEnv: (() => void) | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(async () => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const originalEnv: Record<string, string | undefined> = {};
    const envKeys = [
      "N8N_PORT",
      "N8N_LISTEN_ADDRESS",
      "N8N_AUTO_LOGIN",
      "N8N_DISABLE_USER_MANAGEMENT",
      "N8N_OWNER_EMAIL",
      "N8N_OWNER_PASSWORD",
      "N8N_ENABLE_ENTERPRISE",
      "N8N_DEVELOPMENT_MODE",
      "N8N_START_HTTP_SERVER",
      "N8N_DATA_FOLDER",
      "NODE_ENV",
      "N8N_ENV",
    ];
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
    }
    restoreEnv = () => {
      for (const key of envKeys) {
        if (originalEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv[key];
        }
      }
    };

    const port = await findAvailablePort(23000);
    process.env.NODE_ENV = "development";
    process.env.N8N_ENV = "development";
    process.env.N8N_PORT = String(port);
    process.env.N8N_LISTEN_ADDRESS = "127.0.0.1";
    process.env.N8N_AUTO_LOGIN = "true";
    process.env.N8N_DISABLE_USER_MANAGEMENT = "true";
    process.env.N8N_OWNER_EMAIL = "test@example.com";
    process.env.N8N_OWNER_PASSWORD = "testpassword";
    process.env.N8N_ENABLE_ENTERPRISE = "false";
    process.env.N8N_DEVELOPMENT_MODE = "true";
    process.env.N8N_START_HTTP_SERVER = "true";

    toolsRoot = await mkdtemp(join(tmpdir(), "toolhub-n8n-real-"));
    dataDir = await mkdtemp(join(tmpdir(), "toolhub-n8n-data-"));

    await mkdir(join(toolsRoot, "workflow-a", "n8n"), { recursive: true });
    await writeFile(
      join(toolsRoot, "workflow-a", "n8n", "tool.json"),
      JSON.stringify({ kind: "n8n", name: "local/workflow-a" }),
    );
    await writeFile(
      join(toolsRoot, "workflow-a", "n8n", "workflow.json"),
      JSON.stringify({
        id: "wf-1",
        name: "Workflow A",
        nodes: [
          {
            id: "start-node",
            name: "Start",
            type: "n8n-nodes-base.manualTrigger",
            typeVersion: 1,
            position: [250, 300],
            parameters: {},
          },
          {
            id: "set-node",
            name: "Set",
            type: "n8n-nodes-base.set",
            typeVersion: 3,
            position: [450, 300],
            parameters: {
              values: {
                string: [
                  { name: "status", value: "ok" },
                ],
              },
            },
          },
        ],
        connections: {
          Start: {
            main: [[{ node: "Set", type: "main", index: 0 }]],
          },
        },
        active: false,
      }),
    );

    toolHub = createToolHub({
      roots: [toolsRoot],
      namespace: "local",
      n8nMode: "local",
      n8nLocal: {
        sqliteDatabase: join(dataDir, "n8n.sqlite"),
        dataFolder: dataDir,
        startHttpServer: true,
      },
    });

    await toolHub.initAllTools();
    const toolNames = toolHub.getRegistry().list();
    if (!toolNames.includes("local/workflow-a")) {
      throw new Error(`Discovered tools: ${toolNames.join(", ")}`);
    }
  }, 120000);

  afterAll(async () => {
    if (toolHub) {
      await toolHub.shutdown();
    }
    await rm(toolsRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    restoreEnv?.();
    exitSpy?.mockRestore();
  });

  it(
    "invokes workflow via embedded n8n-local",
    async () => {
      const result = await toolHub.invokeTool(
        "local/workflow-a",
        { input: 123 },
        { permissions: [] },
      );
      if (!result.ok) {
        throw new Error(`Invocation failed: ${result.error?.message ?? "unknown"}`);
      }
      expect(result.ok).toBe(true);
      expect(result.result).toBeTruthy();
      const executionId = (result.result as { executionId?: string }).executionId;
      expect(executionId).toBeTruthy();
    },
    120000,
  );
});
