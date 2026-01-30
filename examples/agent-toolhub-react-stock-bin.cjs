#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");

const scriptDir = __dirname;
const mjsPath = path.join(scriptDir, "agent-toolhub-react-stock.mjs");
const packageRoot = path.join(scriptDir, "..");

// Use tsx so dependencies (e.g. @easynet/n8n-local) that ship .ts can be loaded
let nodeArgs = [mjsPath];
try {
  require.resolve("tsx", { paths: [packageRoot] });
  nodeArgs = ["--import", "tsx", mjsPath];
} catch (_) {
  // tsx not available; run without it (may fail if a dep ships .ts)
}
const result = spawnSync(process.execPath, [...nodeArgs, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exitCode = result.status !== null ? result.status : 1;
