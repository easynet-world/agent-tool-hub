import { ToolHub, createToolHub } from "./tool-hub/ToolHub.js";
export { ToolHub, createToolHub };
export type { ToolHubInitOptions, InvokeOptions } from "./tool-hub/ToolHub.js";

export async function createToolHubAndInit(
  options: import("./tool-hub/ToolHub.js").ToolHubInitOptions,
) {
  const hub = createToolHub(options);
  await hub.initAllTools();
  return hub;
}
