import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { ToolHubInitOptions } from "../tool-hub/ToolHub.js";
import type { CoreToolsUserConfig } from "../core-tools/CoreToolsModule.js";

export interface ToolHubConfigLoadResult {
  configPath: string;
  rawConfig: unknown;
  options: ToolHubInitOptions;
}

export function mapToolHubConfig(
  raw: unknown,
  configDir: string,
): ToolHubInitOptions {
  const config = (raw ?? {}) as Record<string, any>;
  const toolHub = (config.toolHub ?? {}) as Record<string, any>;
  const discovery = (config.discovery ?? toolHub.discovery ?? {}) as Record<string, any>;
  const system = (config.system ?? {}) as Record<string, any>;
  const security = (config.security ?? {}) as Record<string, any>;
  const runtime = system.runtime ?? config.runtime ?? {};
  const coreToolsRaw =
    (system.coreTools ?? config.coreTools ?? {}) as Record<string, any>;
  const adapters = (config.adapters ?? {}) as Record<string, any>;

  let coreToolsInlineConfig: CoreToolsUserConfig | undefined;
  const roots = ((discovery.roots ?? toolHub.roots ?? []) as Array<
    | string
    | { path: string; namespace?: string; config?: CoreToolsUserConfig }
  >).map((root) => {
    if (typeof root === "string") {
      if (root === "coreTools") return root;
      return path.isAbsolute(root) ? root : path.resolve(configDir, root);
    }
    if (root.path === "coreTools") {
      coreToolsInlineConfig = root.config;
      return root;
    }
    const resolvedPath = path.isAbsolute(root.path)
      ? root.path
      : path.resolve(configDir, root.path);
    return { path: resolvedPath, namespace: root.namespace };
  });

  const coreTools = (coreToolsInlineConfig ?? coreToolsRaw ?? {}) as Record<string, any>;
  const sandboxRoot =
    coreTools.sandboxRoot ??
    coreTools.sandbox?.root ??
    security.sandbox?.root ??
    system.sandbox?.root;
  const allowedHosts =
    coreTools.allowedHosts ??
    coreTools.network?.allowedHosts ??
    security.network?.allowedHosts ??
    system.network?.allowedHosts;
  const blockedCidrs =
    coreTools.blockedCidrs ??
    coreTools.network?.blockedCidrs ??
    security.network?.blockedCidrs ??
    system.network?.blockedCidrs;
  const maxReadBytes =
    coreTools.maxReadBytes ??
    coreTools.limits?.maxReadBytes;
  const maxHttpBytes =
    coreTools.maxHttpBytes ??
    coreTools.limits?.maxHttpBytes;
  const maxDownloadBytes =
    coreTools.maxDownloadBytes ??
    coreTools.limits?.maxDownloadBytes;
  const defaultTimeoutMs =
    coreTools.defaultTimeoutMs ??
    coreTools.limits?.defaultTimeoutMs;
  const httpUserAgent =
    coreTools.httpUserAgent ??
    coreTools.http?.userAgent;
  const enableAutoWriteLargeResponses =
    coreTools.enableAutoWriteLargeResponses ??
    coreTools.http?.enableAutoWriteLargeResponses;

  const includeCoreTools = roots.some((root) => {
    if (typeof root === "string") return root === "coreTools";
    return root.path === "coreTools";
  });
  const coreToolsConfig = includeCoreTools
    ? {
        sandboxRoot: sandboxRoot
          ? (path.isAbsolute(String(sandboxRoot))
              ? String(sandboxRoot)
              : path.resolve(configDir, String(sandboxRoot)))
          : sandboxRoot,
        allowedHosts: (allowedHosts as string[] | undefined) ?? [],
        maxReadBytes: maxReadBytes as number | undefined,
        maxHttpBytes: maxHttpBytes as number | undefined,
        maxDownloadBytes: maxDownloadBytes as number | undefined,
        blockedCidrs: blockedCidrs as string[] | undefined,
        defaultTimeoutMs: defaultTimeoutMs as number | undefined,
        httpUserAgent: httpUserAgent as string | undefined,
        enableAutoWriteLargeResponses: enableAutoWriteLargeResponses as boolean | undefined,
      }
    : undefined;

  const comfyuiRaw = (adapters.comfyui ?? {}) as Record<string, any>;
  const comfyuiConfig =
    Object.keys(comfyuiRaw).length > 0
      ? {
          ...comfyuiRaw,
          baseUrl: (comfyuiRaw.baseUrl ?? comfyuiRaw.apiBaseUrl) as
            | string
            | undefined,
        }
      : undefined;

  const n8nRaw = (adapters.n8n ?? {}) as Record<string, any>;
  const n8nMode =
    (n8nRaw.mode as "local" | "api" | undefined) ??
    (n8nRaw.local ? "local" : undefined) ??
    (n8nRaw.api ? "api" : undefined);
  const n8nLocal = (n8nRaw.local as Record<string, any> | undefined) ?? undefined;
  const n8nApi = (n8nRaw.api as Record<string, any> | undefined) ?? undefined;

  return {
    roots,
    namespace: (config.namespace as string | undefined) ?? (toolHub.namespace as string | undefined),
    extensions:
      (discovery.extensions as string[] | undefined) ??
      (config.extensions as string[] | undefined) ??
      (toolHub.extensions as string[] | undefined),
    debug: (config.debug as ToolHubInitOptions["debug"]) ??
      (toolHub.debug as ToolHubInitOptions["debug"]),
    includeCoreTools,
    coreTools: coreToolsConfig,
    runtimeConfig: runtime as ToolHubInitOptions["runtimeConfig"],
    watch:
      (discovery.hotReload as ToolHubInitOptions["watch"]) ??
      (discovery.watch as ToolHubInitOptions["watch"]) ??
      (config.watch as ToolHubInitOptions["watch"]) ??
      (toolHub.watch as ToolHubInitOptions["watch"]),
    langchain: adapters.langchain as ToolHubInitOptions["langchain"],
    mcp: adapters.mcp as ToolHubInitOptions["mcp"],
    n8nMode,
    n8nLocal: n8nMode === "local" ? (n8nLocal as ToolHubInitOptions["n8nLocal"]) : undefined,
    n8n: n8nMode === "api" ? (n8nApi as ToolHubInitOptions["n8n"]) : undefined,
    comfyui: comfyuiConfig as ToolHubInitOptions["comfyui"],
    skill: adapters.skill as ToolHubInitOptions["skill"],
  };
}

export async function loadToolHubConfig(
  configPath: string,
): Promise<ToolHubConfigLoadResult> {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const rawConfigText = await fs.readFile(resolvedPath, "utf-8");
  const rawConfig = yaml.load(rawConfigText) ?? {};
  const options = mapToolHubConfig(rawConfig, path.dirname(resolvedPath));
  return {
    configPath: resolvedPath,
    rawConfig,
    options,
  };
}
