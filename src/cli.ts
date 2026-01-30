#!/usr/bin/env node
/**
 * CLI for @easynet/agent-tool-hub: scan tools folders, verify tools, list tools.
 * Usage: agent-tool-hub <command> [options]
 * Commands: scan | verify | list
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { loadToolHubConfig } from "./config/ToolHubConfig.js";
import { createToolHub } from "./tool-hub/ToolHub.js";
import type { ToolHubInitOptions } from "./tool-hub/ToolHub.js";
import type { ToolSpec } from "./types/ToolSpec.js";

const DEFAULT_CONFIG = "toolhub.yaml";

type DetailLevel = "short" | "normal" | "full";

interface CliArgs {
  command: "scan" | "verify" | "list" | "help";
  configPath: string;
  detail: DetailLevel;
  help: boolean;
}

function parseArgv(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let command: CliArgs["command"] = "help";
  let configPath = path.resolve(process.cwd(), DEFAULT_CONFIG);
  let detail: DetailLevel = "normal";
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--config" || arg === "-c") {
      configPath = path.resolve(process.cwd(), args[++i] ?? "");
    } else if (arg === "--detail" || arg === "-d") {
      const v = (args[++i] ?? "normal").toLowerCase();
      detail = v === "short" || v === "full" ? v : "normal";
    } else if (arg && !arg.startsWith("-")) {
      if (arg === "scan" || arg === "verify" || arg === "list" || arg === "help") {
        command = arg;
      }
    }
  }

  return { command, configPath, detail, help };
}

function printHelp(): void {
  const bin = "agent-tool-hub";
  process.stdout.write(`
Usage: ${bin} <command> [options]

Commands:
  scan     Scan configured tool roots and load tools into the hub.
  verify   Scan and verify tools; exit with code 1 if any discovery errors.
  list     List discovered tools (use --detail to control output).

Options:
  --config, -c <path>   Config file path (default: ./${DEFAULT_CONFIG}).
  --detail, -d <level>  For 'list': short | normal | full (default: normal).
  --help, -h            Show this help.

Examples:
  ${bin} scan
  ${bin} verify -c ./toolhub.yaml
  ${bin} list --detail short
  ${bin} list --detail full
`);
}

async function ensureConfig(configPath: string): Promise<boolean> {
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function runWithHub(
  configPath: string,
  collectErrors: boolean,
): Promise<{ hub: Awaited<ReturnType<typeof createHubAndInit>>; errors: Array<{ dir: string; message: string }> }> {
  const errors: Array<{ dir: string; message: string }> = [];
  const { options } = await loadToolHubConfig(configPath);
  const optionsWithErrorHandler: ToolHubInitOptions = {
    ...options,
    ...(collectErrors
      ? {
          onDiscoverError(dir: string, err: Error) {
            errors.push({ dir, message: err.message });
          },
        }
      : {}),
  };
  const hub = await createHubAndInit(optionsWithErrorHandler);
  return { hub, errors };
}

async function createHubAndInit(options: ToolHubInitOptions) {
  const hub = createToolHub(options);
  await hub.initAllTools();
  return hub;
}

function formatRoot(root: string | { path: string; namespace?: string }): string {
  if (typeof root === "string") return root;
  return root.namespace ? `${root.path} (${root.namespace})` : root.path;
}

async function cmdScan(configPath: string): Promise<number> {
  const { options } = await loadToolHubConfig(configPath);
  const hub = await createHubAndInit(options);
  const specs = hub.getRegistry().snapshot();
  const roots: Array<string | { path: string; namespace?: string }> = options.roots ?? [];
  process.stdout.write(`Scanned ${specs.length} tool(s) from ${roots.length} root(s).\n`);
  process.stdout.write(`Roots: ${roots.map(formatRoot).join(", ")}\n`);
  await hub.shutdown();
  return 0;
}

async function cmdVerify(configPath: string): Promise<number> {
  const { hub, errors } = await runWithHub(configPath, true);
  const specs = hub.getRegistry().snapshot();
  await hub.shutdown();
  if (errors.length > 0) {
    process.stderr.write(`Verify failed: ${errors.length} error(s) during discovery.\n`);
    for (const e of errors) {
      process.stderr.write(`  ${e.dir}: ${e.message}\n`);
    }
    return 1;
  }
  process.stdout.write(`Verified ${specs.length} tool(s). No errors.\n`);
  return 0;
}

function formatSpecShort(spec: ToolSpec): string {
  return spec.name;
}

function formatSpecNormal(spec: ToolSpec): string {
  const desc = (spec.description ?? "").replace(/\n/g, " ").slice(0, 60);
  return `${spec.name}\t${spec.kind}\t${desc}${desc.length >= 60 ? "…" : ""}`;
}

function formatSpecFull(spec: ToolSpec): string {
  return JSON.stringify(
    {
      name: spec.name,
      kind: spec.kind,
      version: spec.version,
      description: spec.description,
      tags: spec.tags,
      capabilities: spec.capabilities,
      endpoint: spec.endpoint,
      resourceId: spec.resourceId,
    },
    null,
    2,
  );
}

async function cmdList(configPath: string, detail: DetailLevel): Promise<number> {
  const { options } = await loadToolHubConfig(configPath);
  const hub = await createHubAndInit(options);
  const specs = hub.getRegistry().snapshot();
  const formatter = detail === "short" ? formatSpecShort : detail === "full" ? formatSpecFull : formatSpecNormal;
  if (detail === "normal") {
    process.stdout.write("name\tkind\tdescription\n");
  }
  for (const spec of specs) {
    process.stdout.write(formatter(spec) + "\n");
  }
  await hub.shutdown();
  return 0;
}

async function main(argv: string[] = process.argv): Promise<number> {
  const { command, configPath, detail, help } = parseArgv(argv);

  if (help || command === "help") {
    printHelp();
    return 0;
  }

  const configExists = await ensureConfig(configPath);
  if (!configExists) {
    process.stderr.write(`Error: config file not found: ${configPath}\n`);
    return 1;
  }

  switch (command) {
    case "scan":
      return cmdScan(configPath);
    case "verify":
      return cmdVerify(configPath);
    case "list":
      return cmdList(configPath, detail);
    default:
      printHelp();
      return 1;
  }
}

/** Run CLI with the given argv (same shape as process.argv). Exported for tests. */
export async function run(argv: string[]): Promise<number> {
  return main(argv);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(String(err?.message ?? err) + "\n");
      process.exit(1);
    });
}
