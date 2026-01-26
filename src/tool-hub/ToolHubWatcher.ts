import { watch, type FSWatcher } from "node:fs";
import type { DirectoryScannerOptions } from "../discovery/types.js";
import type { Logger } from "../observability/Logger.js";
import type { ToolSpec } from "../types/ToolSpec.js";
import { rootPath } from "./ToolHubHelpers.js";

export interface WatcherDependencies {
  logger: Logger;
  scannerOptions: DirectoryScannerOptions;
  refreshTools: () => Promise<ToolSpec[]>;
}

/**
 * Watch all current roots and auto-refresh on changes.
 */
export function watchRoots(
  deps: WatcherDependencies,
  watchers: Map<string, FSWatcher>,
  watchTimers: Map<string, NodeJS.Timeout>,
  options: { debounceMs?: number; persistent?: boolean } = {},
): void {
  const debounceMs = options.debounceMs ?? 200;
  const persistent = options.persistent ?? true;

  for (const root of deps.scannerOptions.roots) {
    const rootPathValue = rootPath(root);
    if (watchers.has(rootPathValue)) {
      continue;
    }
    deps.logger.info("watch.start", { root: rootPathValue, debounceMs, persistent });
    const watcher = watch(
      rootPathValue,
      { recursive: true, persistent },
      () => {
        const existing = watchTimers.get(rootPathValue);
        if (existing) {
          clearTimeout(existing);
        }
        const timer = setTimeout(() => {
          deps.refreshTools().catch((err) => {
            deps.logger.warn("watch.refresh.error", {
              root: rootPathValue,
              message: err instanceof Error ? err.message : String(err),
            });
            deps.scannerOptions.onError?.(rootPathValue, err as Error);
          });
        }, debounceMs);
        watchTimers.set(rootPathValue, timer);
      },
    );
    watchers.set(rootPathValue, watcher);
  }
}

/**
 * Stop watching all roots.
 */
export function unwatchRoots(
  watchers: Map<string, FSWatcher>,
  watchTimers: Map<string, NodeJS.Timeout>,
  logger: Logger,
): void {
  for (const [root, watcher] of watchers) {
    watcher.close();
    watchers.delete(root);
    const timer = watchTimers.get(root);
    if (timer) {
      clearTimeout(timer);
      watchTimers.delete(root);
    }
    logger.info("watch.stop", { root });
  }
}
