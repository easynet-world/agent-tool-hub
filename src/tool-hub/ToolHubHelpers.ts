import type { CoreToolsUserConfig } from "../core-tools/CoreToolsModule.js";

export type ToolHubRoot =
  | string
  | { path: string; namespace?: string }
  | { path: "coreTools"; namespace?: string; config?: CoreToolsUserConfig };

/**
 * Extract path from root config.
 */
export function rootPath(root: string | { path: string; namespace?: string }): string {
  return typeof root === "string" ? root : root.path;
}

/**
 * Generate unique key for root (path + namespace).
 */
export function rootKey(root: string | { path: string; namespace?: string }): string {
  const path = rootPath(root);
  const namespace = typeof root === "string" ? "" : root.namespace ?? "";
  return `${path}::${namespace}`;
}
