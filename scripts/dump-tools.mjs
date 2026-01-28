import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { createToolHubAndInit } from "../dist/toolhub-runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function mapConfig(raw, configDir) {
  const toolHub = raw?.toolHub ?? {};
  const discovery = raw?.discovery ?? toolHub?.discovery ?? {};
  const runtime = raw?.system?.runtime ?? raw?.runtime ?? {};
  const system = raw?.system ?? {};
  const security = raw?.security ?? {};
  const coreToolsRaw = system?.coreTools ?? raw?.coreTools ?? {};
  const adapters = raw?.adapters ?? {};
  let coreToolsInlineConfig;
  const roots = (discovery.roots ?? toolHub.roots ?? []).map((root) => {
    if (typeof root === "string") {
      if (root === "coreTools") {
        return root;
      }
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

  const coreTools = coreToolsInlineConfig ?? coreToolsRaw ?? {};
  const sandboxRoot =
    coreTools.sandboxRoot ??
    coreTools.sandbox?.root ??
    security?.sandbox?.root ??
    system?.sandbox?.root;
  const allowedHosts =
    coreTools.allowedHosts ??
    coreTools.network?.allowedHosts ??
    security?.network?.allowedHosts ??
    system?.network?.allowedHosts;
  const blockedCidrs =
    coreTools.blockedCidrs ??
    coreTools.network?.blockedCidrs ??
    security?.network?.blockedCidrs ??
    system?.network?.blockedCidrs;
  const maxReadBytes = coreTools.maxReadBytes ?? coreTools.limits?.maxReadBytes;
  const maxHttpBytes = coreTools.maxHttpBytes ?? coreTools.limits?.maxHttpBytes;
  const maxDownloadBytes =
    coreTools.maxDownloadBytes ?? coreTools.limits?.maxDownloadBytes;
  const defaultTimeoutMs =
    coreTools.defaultTimeoutMs ?? coreTools.limits?.defaultTimeoutMs;
  const httpUserAgent =
    coreTools.httpUserAgent ?? coreTools.http?.userAgent;
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
          ? (path.isAbsolute(sandboxRoot)
              ? sandboxRoot
              : path.resolve(configDir, sandboxRoot))
          : sandboxRoot,
        allowedHosts: allowedHosts ?? [],
        maxReadBytes,
        maxHttpBytes,
        maxDownloadBytes,
        blockedCidrs,
        defaultTimeoutMs,
        httpUserAgent,
        enableAutoWriteLargeResponses,
      }
    : undefined;

  const comfyuiConfig = adapters.comfyui
    ? {
        ...adapters.comfyui,
        baseUrl: adapters.comfyui.baseUrl ?? adapters.comfyui.apiBaseUrl,
      }
    : undefined;

  return {
    roots,
    namespace: raw?.namespace ?? toolHub.namespace,
    extensions: discovery.extensions ?? raw?.extensions ?? toolHub.extensions,
    debug: raw?.debug ?? toolHub.debug,
    includeCoreTools,
    coreTools: coreToolsConfig,
    runtimeConfig: runtime,
    watch: discovery.hotReload ?? discovery.watch ?? raw?.watch ?? toolHub.watch,
    langchain: adapters.langchain,
    mcp: adapters.mcp,
    n8nMode: "api",
    n8nLocal: undefined,
    n8n: adapters.n8n?.api,
    comfyui: comfyuiConfig,
    skill: adapters.skill,
  };
}

function buildSummary(tools) {
  const byKind = {};
  for (const tool of tools) {
    const kind = tool.kind ?? "unknown";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return { total: tools.length, byKind };
}

async function main() {
  const configPath = path.resolve(process.cwd(), "toolhub.yaml");

  const rawConfigText = await fs.readFile(configPath, "utf-8");
  const rawConfig = yaml.load(rawConfigText) ?? {};
  const options = mapConfig(rawConfig, path.dirname(configPath));

  const toolHub = await createToolHubAndInit(options);

  const registry = toolHub.getRegistry();
  const specs = registry.snapshot();
  const tools = specs.map((spec) => {
    const details = toolHub.getToolDescription(spec.name);
    return {
      name: spec.name,
      kind: spec.kind,
      version: spec.version,
      description: spec.description,
      tags: spec.tags ?? [],
      capabilities: spec.capabilities,
      costHints: spec.costHints,
      endpoint: spec.endpoint,
      resourceId: spec.resourceId,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      details,
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    configPath,
    summary: buildSummary(tools),
    tools,
  };

  const output = JSON.stringify(payload, null, 2);
  process.stdout.write(output + "\n");

  await toolHub.shutdown();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[@easynet/agent-tool-hub] dump-tools failed: ${message}`);
  process.exit(1);
});
