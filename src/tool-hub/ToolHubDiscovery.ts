import type { ToolSpec } from "../types/ToolSpec.js";
import type { CoreToolsUserConfig } from "../core-tools/CoreToolsModule.js";
import { DirectoryScanner } from "../discovery/DirectoryScanner.js";
import { ToolRegistry } from "../registry/ToolRegistry.js";
import { registerCoreTools } from "../core-tools/CoreToolsModule.js";
import type { Logger } from "../observability/Logger.js";

export interface DiscoveryDependencies {
  registry: ToolRegistry;
  logger: Logger;
  includeCoreTools: boolean;
  coreToolsConfig?: CoreToolsUserConfig;
  roots: Array<string | { path: string; namespace?: string }>;
}

/**
 * Initialize all tools by scanning the configured roots.
 */
export async function initAllTools(
  scanner: DirectoryScanner,
  deps: DiscoveryDependencies,
  n8nLocalAdapter?: { start(): Promise<void>; syncWorkflows(specs: ToolSpec[]): Promise<void> },
): Promise<ToolSpec[]> {
  deps.logger.info("init.tools.start", {
    roots: deps.roots,
  });
  const specs = await scanner.scan();
  deps.registry.bulkRegister(specs);
  
  if (n8nLocalAdapter) {
    await n8nLocalAdapter.start();
    await n8nLocalAdapter.syncWorkflows(
      specs.filter((spec) => spec.kind === "n8n"),
    );
  }
  
  deps.logger.info("init.tools.done", { count: specs.length });
  return specs;
}

/**
 * Refresh tools by re-scanning current roots.
 */
export async function refreshTools(
  scanner: DirectoryScanner,
  deps: DiscoveryDependencies,
  n8nLocalAdapter?: { start(): Promise<void>; syncWorkflows(specs: ToolSpec[]): Promise<void> },
): Promise<ToolSpec[]> {
  deps.logger.info("refresh.tools.start", {
    roots: deps.roots,
  });
  const specs = await scanner.scan();
  deps.registry.clear();
  
  if (deps.includeCoreTools) {
    if (!deps.coreToolsConfig) {
      throw new Error("coreTools config is required when includeCoreTools is true");
    }
    // Note: coreAdapter registration should be handled by caller
    registerCoreTools(deps.registry, deps.coreToolsConfig);
  }
  
  deps.registry.bulkRegister(specs);
  
  if (n8nLocalAdapter) {
    await n8nLocalAdapter.start();
    await n8nLocalAdapter.syncWorkflows(
      specs.filter((spec) => spec.kind === "n8n"),
    );
  }
  
  deps.logger.info("refresh.tools.done", { count: specs.length });
  return specs;
}

/**
 * Split roots into scanner roots and core tools config.
 */
export function splitRoots(
  roots: Array<
    | string
    | { path: string; namespace?: string }
    | { path: "coreTools"; namespace?: string; config?: CoreToolsUserConfig }
  >,
  includeCoreTools?: boolean,
): {
  scannerRoots: Array<string | { path: string; namespace?: string }>;
  includeCoreTools: boolean;
  coreToolsConfig?: CoreToolsUserConfig;
} {
  const scannerRoots: Array<string | { path: string; namespace?: string }> = [];
  let hasCoreTools = false;
  let coreToolsConfig: CoreToolsUserConfig | undefined;

  for (const root of roots) {
    if (typeof root === "string") {
      if (root === "coreTools") {
        hasCoreTools = true;
      } else {
        scannerRoots.push(root);
      }
      continue;
    }
    if (root.path === "coreTools") {
      hasCoreTools = true;
      if ("config" in root && root.config) {
        coreToolsConfig = root.config;
      }
      continue;
    }
    scannerRoots.push(root);
  }

  return {
    scannerRoots,
    includeCoreTools: includeCoreTools ?? hasCoreTools,
    coreToolsConfig,
  };
}
