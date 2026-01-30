import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectStreamSteps,
  formatStepProgress,
  runAgentWithReport,
  writeReportFromStream,
  generateAgentReport,
  serializeStepOutput,
} from "../../src/report/index.js";
import type { AgentReportStep } from "../../src/report/types.js";

async function* mockStream() {
  yield { agent: { messages: [{ type: "ai", content: "thinking", usage_metadata: { input_tokens: 10, output_tokens: 5 } }] } };
  yield { tools: { messages: [{ type: "tool", content: "done", tool_calls: [{ name: "foo", args: { x: 1 } }] }] } };
  yield { agent: { messages: [{ type: "ai", content: "done" }] } };
}

describe("report", () => {
  describe("collectStreamSteps", () => {
    it("collects steps from stream and calls onStep", async () => {
      const steps: AgentReportStep[] = [];
      const { steps: collected, lastAiContent } = await collectStreamSteps(mockStream(), {
        onStep: (s) => steps.push(s),
      });
      expect(collected).toHaveLength(3);
      expect(collected).toEqual(steps);
      expect(collected[0].node).toBe("agent");
      expect(collected[0].usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: undefined });
      expect(collected[1].node).toBe("tools");
      expect(collected[1].toolCalls).toEqual([{ name: "foo", args: { x: 1 } }]);
      expect(lastAiContent).toBe("done");
    });
  });

  describe("formatStepProgress", () => {
    it("formats step with tools and tokens", () => {
      const line = formatStepProgress({
        stepIndex: 1,
        node: "agent",
        toolCalls: [{ name: "bar", args: { q: 2 } }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      });
      expect(line).toContain("[1] agent");
      expect(line).toContain("tools → bar");
      expect(line).toContain("tokens: in=20 out=10 total=30");
    });
  });

  describe("runAgentWithReport", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "agent-report-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("streams agent, collects steps, writes HTML when htmlReportPath provided (uses built-in template)", async () => {
      const htmlPath = join(dir, "report.html");
      const mockAgent = {
        stream: async () => mockStream(),
      };
      const result = await runAgentWithReport(mockAgent, {}, {
        systemPrompt: "You are helpful.",
        userPrompt: "Hello",
        htmlReportPath: htmlPath,
        onStep: () => {},
      });
      expect(result.steps).toHaveLength(3);
      expect(result.reportMarkdown).toBe("done");
      expect(result.htmlPath).toBe(htmlPath);
      const html = await readFile(htmlPath, "utf8");
      expect(html).toContain("You are helpful.");
      expect(html).toContain("Hello");
      expect(html).toContain("done");
      expect(html).toContain('"stepIndex":1');
    });

    it("writeReportFromStream consumes stream and writes HTML (regular LangChain usage)", async () => {
      const htmlPath = join(dir, "from-stream.html");
      const stream = mockStream();
      const result = await writeReportFromStream(stream, {
        systemPrompt: "Sys",
        userPrompt: "User",
        htmlReportPath: htmlPath,
        onStep: () => {},
      });
      expect(result.steps).toHaveLength(3);
      expect(result.reportMarkdown).toBe("done");
      expect(result.htmlPath).toBe(htmlPath);
      const html = await readFile(htmlPath, "utf8");
      expect(html).toContain("Sys");
      expect(html).toContain("User");
      expect(html).toContain("done");
    });

    it("reads reportPath when provided and file exists", async () => {
      const { writeFile } = await import("node:fs/promises");
      const reportPath = join(dir, "out.md");
      await writeFile(reportPath, "# Report\n\nContent.");
      const htmlPath = join(dir, "report.html");
      const mockAgent = { stream: async () => mockStream() };
      const result = await runAgentWithReport(mockAgent, {}, {
        systemPrompt: "S",
        userPrompt: "U",
        reportPath,
        htmlReportPath: htmlPath,
      });
      expect(result.reportMarkdown).toBe("# Report\n\nContent.");
      const html = await readFile(htmlPath, "utf8");
      expect(html).toContain("Report");
      expect(html).toContain("Content.");
    });
  });

  describe("serializeStepOutput", () => {
    it("serializes messages and state", () => {
      const out = serializeStepOutput({
        messages: [{ type: "ai", content: "hi", tool_calls: [{ name: "x", args: {} }] }],
      });
      expect(out).toEqual({
        messages: [
          { type: "ai", content: "hi", tool_calls: [{ name: "x", args: {} }] },
        ],
      });
    });
  });
});
