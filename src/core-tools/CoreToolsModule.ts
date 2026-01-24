import { CoreAdapter } from "./CoreAdapter.js";
import type { ToolRegistry } from "../registry/ToolRegistry.js";
import type { CoreToolsConfig } from "./types.js";
import { DEFAULT_CORE_TOOLS_CONFIG } from "./types.js";

// Filesystem tools
import { readTextSpec, readTextHandler } from "./fs/readText.js";
import { writeTextSpec, writeTextHandler } from "./fs/writeText.js";
import { listDirSpec, listDirHandler } from "./fs/listDir.js";
import { searchTextSpec, searchTextHandler } from "./fs/searchText.js";
import { sha256Spec, sha256Handler } from "./fs/sha256.js";
import { deletePathSpec, deletePathHandler } from "./fs/deletePath.js";

// HTTP tools
import { fetchTextSpec, fetchTextHandler } from "./http/fetchText.js";
import { fetchJsonSpec, fetchJsonHandler } from "./http/fetchJson.js";
import { downloadFileSpec, downloadFileHandler } from "./http/downloadFile.js";
import { headSpec, headHandler } from "./http/head.js";

// Utility tools
import { jsonSelectSpec, jsonSelectHandler } from "./util/jsonSelect.js";
import { truncateSpec, truncateHandler } from "./util/truncate.js";
import { hashTextSpec, hashTextHandler } from "./util/hashText.js";
import { nowSpec, nowHandler } from "./util/now.js";
import { templateRenderSpec, templateRenderHandler } from "./util/templateRender.js";

/**
 * All core tools: spec + handler pairs.
 */
const ALL_CORE_TOOLS = [
  // Filesystem
  { spec: readTextSpec, handler: readTextHandler },
  { spec: writeTextSpec, handler: writeTextHandler },
  { spec: listDirSpec, handler: listDirHandler },
  { spec: searchTextSpec, handler: searchTextHandler },
  { spec: sha256Spec, handler: sha256Handler },
  { spec: deletePathSpec, handler: deletePathHandler },
  // HTTP
  { spec: fetchTextSpec, handler: fetchTextHandler },
  { spec: fetchJsonSpec, handler: fetchJsonHandler },
  { spec: downloadFileSpec, handler: downloadFileHandler },
  { spec: headSpec, handler: headHandler },
  // Utils
  { spec: jsonSelectSpec, handler: jsonSelectHandler },
  { spec: truncateSpec, handler: truncateHandler },
  { spec: hashTextSpec, handler: hashTextHandler },
  { spec: nowSpec, handler: nowHandler },
  { spec: templateRenderSpec, handler: templateRenderHandler },
] as const;

/**
 * User-provided config for registerCoreTools.
 * `sandboxRoot` and `allowedHosts` are required; the rest have defaults.
 */
export type CoreToolsUserConfig = Pick<CoreToolsConfig, "sandboxRoot" | "allowedHosts"> &
  Partial<Omit<CoreToolsConfig, "sandboxRoot" | "allowedHosts">>;

/**
 * Register all core tools with a ToolRegistry and return the configured CoreAdapter.
 *
 * Usage:
 * ```ts
 * const registry = new ToolRegistry();
 * const coreAdapter = registerCoreTools(registry, {
 *   sandboxRoot: "/var/tool-hub/sandbox",
 *   allowedHosts: ["api.github.com", "*.example.com"],
 * });
 * runtime.registerAdapter(coreAdapter);
 * ```
 */
export function registerCoreTools(
  registry: ToolRegistry,
  userConfig: CoreToolsUserConfig,
): CoreAdapter {
  const config: CoreToolsConfig = {
    ...DEFAULT_CORE_TOOLS_CONFIG,
    ...userConfig,
  };

  const adapter = new CoreAdapter(config);

  for (const { spec, handler } of ALL_CORE_TOOLS) {
    registry.register(spec);
    adapter.registerHandler(spec.name, handler);
  }

  return adapter;
}
