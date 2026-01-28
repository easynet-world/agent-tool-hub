import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const cliPath = path.join(projectRoot, "dist", "cli.js");
const fixtureConfig = path.join(__dirname, "fixtures", "cli-toolhub.yaml");

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? null });
    });
  });
}

describe("agent-tool-hub CLI", () => {
  it("prints help with --help", async () => {
    const { stdout, stderr, code } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("scan");
    expect(stdout).toContain("verify");
    expect(stdout).toContain("list");
  });

  it("prints help with no args", async () => {
    const { stdout, code } = await runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage:");
  });

  it("scan with fixture config reports tools and roots", async () => {
    const { stdout, stderr, code } = await runCli(["scan", "--config", fixtureConfig]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Scanned \d+ tool\(s\)/);
    expect(stdout).toContain("Roots:");
  }, 20000);

  it("list with fixture config and --detail short prints one name per line", async () => {
    const { stdout, stderr, code } = await runCli(["list", "--config", fixtureConfig, "--detail", "short"]);
    expect(code).toBe(0);
    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((line) => {
      expect(line).not.toContain("\t");
      expect(line.length).toBeGreaterThan(0);
    });
  }, 20000);

  it("list with --detail normal includes header and tab-separated columns", async () => {
    const { stdout, stderr, code } = await runCli(["list", "--config", fixtureConfig, "--detail", "normal"]);
    expect(code).toBe(0);
    expect(stdout).toContain("name\tkind\tdescription");
    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
  }, 20000);

  it("list with --detail full outputs JSON-like blocks", async () => {
    const { stdout, stderr, code } = await runCli(["list", "--config", fixtureConfig, "--detail", "full"]);
    expect(code).toBe(0);
    expect(stdout).toContain('"name"');
    expect(stdout).toContain('"kind"');
  }, 20000);

  it("verify with fixture config exits 0 when no discovery errors", async () => {
    const { stdout, stderr, code } = await runCli(["verify", "--config", fixtureConfig]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Verified \d+ tool\(s\)/);
    expect(stdout).toContain("No errors");
  }, 20000);

  it("exits 1 when config file not found", async () => {
    const { stderr, code } = await runCli(["scan", "--config", "/nonexistent/toolhub.yaml"]);
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});
