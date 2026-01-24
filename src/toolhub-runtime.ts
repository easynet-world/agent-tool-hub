import { ToolHub, createToolHub } from "./tool-hub/ToolHub.js";
import { loadToolHubConfig } from "./config/ToolHubConfig.js";
export { ToolHub, createToolHub };
export type { ToolHubInitOptions, InvokeOptions } from "./tool-hub/ToolHub.js";

export async function createToolHubAndInit(
  options: import("./tool-hub/ToolHub.js").ToolHubInitOptions,
) {
  const hub = createToolHub(options);
  await hub.initAllTools();
  return hub;
}

export async function createToolHubAndInitFromConfig(configPath: string) {
  const { options } = await loadToolHubConfig(configPath);
  return createToolHubAndInit(options);
}

export async function createAgentToolHub(configPath: string) {
  return createToolHubAndInitFromConfig(configPath);
}
