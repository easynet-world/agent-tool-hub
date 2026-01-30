import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentReportData,
  AgentReportStep,
  CollectStreamStepsOptions,
  CollectStreamStepsResult,
  RunAgentWithReportOptions,
  RunAgentWithReportResult,
  StreamableAgent,
  WriteReportFromStreamOptions,
} from "./types.js";
import { AGENT_REPORT_TEMPLATE } from "./agent-report-template.js";

const PLACEHOLDER = "__REPORT_DATA__";

/**
 * Generate an HTML report from template and data.
 * Uses the built-in framework template when templatePath is not provided.
 *
 * @param data - Report data (prompts, markdown, steps)
 * @param options.outputPath - Path to write the HTML file (required)
 * @param options.templatePath - Path to a custom HTML template (optional; uses built-in if not set)
 * @returns Path to the written file
 */
export function generateAgentReport(
  data: AgentReportData,
  options: { outputPath: string; templatePath?: string }
): string {
  const template = options.templatePath
    ? readFileSync(options.templatePath, "utf8")
    : AGENT_REPORT_TEMPLATE;
  let json = JSON.stringify(data);
  json = json.replace(/<\/script/gi, "<\\/script");
  const html = template.replace(PLACEHOLDER, json);
  const outPath = resolve(options.outputPath);
  writeFileSync(outPath, html, "utf8");
  return outPath;
}

/**
 * Serialize a stream chunk value for the report (messages and metadata to plain JSON).
 */
export function serializeStepOutput(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (Array.isArray(v.messages)) {
    out.messages = v.messages.map((m: unknown) => serializeMessage(m));
  }
  if (v.__state__ && typeof v.__state__ === "object") {
    const state = v.__state__ as Record<string, unknown>;
    if (Array.isArray(state.messages)) {
      out.messages = state.messages.map((m: unknown) => serializeMessage(m));
    }
  }
  if (Object.keys(out).length === 0) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return { _raw: String(value) };
    }
  }
  return out;
}

function serializeMessage(msg: unknown): Record<string, unknown> {
  if (msg === null || typeof msg !== "object") return { content: String(msg) };
  const m = msg as Record<string, unknown>;
  const out: Record<string, unknown> = {
    type: m.type ?? "message",
    content: m.content ?? "",
  };
  if (m.tool_calls) out.tool_calls = m.tool_calls;
  if (m.usage_metadata) out.usage_metadata = m.usage_metadata;
  if (m.name) out.name = m.name;
  return out;
}

/**
 * Format a step for console progress (e.g. "[1] agent | tools → foo | tokens: in=10 out=5").
 */
export function formatStepProgress(step: AgentReportStep): string {
  const parts = [`  [${step.stepIndex}] ${step.node}`];
  if (step.toolCalls?.length) {
    const toolParts = step.toolCalls.map((tc) => {
      const argStr =
        tc.args && Object.keys(tc.args).length ? " " + JSON.stringify(tc.args) : "";
      return `${tc.name}${argStr}`;
    });
    parts.push(`tools → ${toolParts.join("; ")}`);
  }
  if (step.usage) {
    const inN = step.usage.input_tokens ?? 0;
    const outN = step.usage.output_tokens ?? 0;
    const total = step.usage.total_tokens ?? inN + outN;
    parts.push(`tokens: in=${inN} out=${outN} total=${total}`);
  }
  return parts.join(" | ");
}

/**
 * Build a single step from a stream chunk (node + value).
 */
function buildStep(stepIndex: number, node: string, value: unknown): AgentReportStep {
  const v = value as Record<string, unknown> | null | undefined;
  const messages = v?.messages ?? (v?.__state__ as Record<string, unknown> | undefined)?.messages;
  const lastMsg = Array.isArray(messages) ? messages.slice(-1)[0] : undefined;
  const last = lastMsg as Record<string, unknown> | undefined;
  const toolCalls = last?.tool_calls as Array<{ name: string; args?: Record<string, unknown> }> | undefined;
  const usage = last?.usage_metadata as
    | { input_tokens?: number; output_tokens?: number; total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
    | undefined;
  return {
    stepIndex,
    node,
    input: undefined, // filled later from previous step's output
    output: serializeStepOutput(value),
    toolCalls: toolCalls?.map((tc) => ({ name: tc.name, args: tc.args ?? {} })),
    usage: usage
      ? {
          input_tokens: usage.input_tokens ?? usage.prompt_tokens,
          output_tokens: usage.output_tokens ?? usage.completion_tokens,
          total_tokens: usage.total_tokens,
        }
      : undefined,
  };
}

function isAiMessage(msg: Record<string, unknown> | null | undefined): boolean {
  if (!msg || typeof msg !== "object") return false;
  if (msg.type === "ai" || msg.type === "assistant") return true;
  const getType = msg._getType as (() => string) | undefined;
  if (typeof getType === "function" && getType.call(msg) === "ai") return true;
  const lcId = msg.lc_id as string[] | undefined;
  if (Array.isArray(lcId) && lcId[lcId.length - 1] === "AIMessage") return true;
  return false;
}

function getMessageContent(msg: Record<string, unknown> | null | undefined): string {
  if (!msg || typeof msg !== "object") return "";
  let c: unknown = msg.content ?? (msg.kwargs as Record<string, unknown> | undefined)?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return (c as Array<{ type?: string; text?: string }>)
      .map((p) => (p && typeof p === "object" && "text" in p ? p.text : String(p)))
      .filter(Boolean)
      .join("");
  }
  return "";
}

function extractAiContent(msg: Record<string, unknown> | null | undefined): string {
  if (!msg || !isAiMessage(msg)) return "";
  return getMessageContent(msg);
}

/**
 * Consume an agent stream and collect steps. Optionally call onStep for each step (e.g. progress logging).
 * Also captures the last AI message content for use as report body when no reportPath is provided.
 *
 * @param stream - AsyncIterable from agent.stream()
 * @param options.onStep - Called for each step
 * @returns Collected steps and last AI content
 */
export async function collectStreamSteps(
  stream: AsyncIterable<Record<string, unknown>>,
  options?: CollectStreamStepsOptions
): Promise<CollectStreamStepsResult> {
  const steps: AgentReportStep[] = [];
  let stepIndex = 0;
  let lastAiContent = "";
  for await (const chunk of stream) {
    // LangGraph yields [mode, data] or [ns, mode, data]; the node→value map is the last element
    const nodeMap =
      Array.isArray(chunk) &&
      chunk.length >= 2 &&
      typeof chunk[chunk.length - 1] === "object" &&
      chunk[chunk.length - 1] !== null &&
      !Array.isArray(chunk[chunk.length - 1])
        ? (chunk[chunk.length - 1] as Record<string, unknown>)
        : (chunk as Record<string, unknown>);
    for (const [node, value] of Object.entries(nodeMap)) {
      if (value === undefined || value === null) continue;
      stepIndex += 1;
      const step = buildStep(stepIndex, node, value);
      steps.push(step);
      options?.onStep?.(step);
      const v = value as Record<string, unknown>;
      const messages = v?.messages ?? (v?.__state__ as Record<string, unknown> | undefined)?.messages;
      const lastMsg = Array.isArray(messages) ? (messages.slice(-1)[0] as Record<string, unknown>) : undefined;
      let content = extractAiContent(lastMsg);
      // Fallback: from "agent" node, use last message content if it looks like final reply (not a tool message)
      if (!content && node === "agent" && lastMsg && typeof lastMsg === "object" && !("tool_call_id" in lastMsg && lastMsg.tool_call_id)) {
        content = getMessageContent(lastMsg);
      }
      if (content) lastAiContent = content;
    }
  }
  // Input to step N is the output of step N-1 (stream only gives per-node output)
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    if (prev && curr) curr.input = prev.output;
  }
  const first = steps[0];
  if (first && first.input === undefined) {
    first.input = { __info: "Initial state (see System and User Prompt above)" };
  }
  return { steps, lastAiContent };
}

/**
 * Run an agent stream, collect steps, optionally read report file and write HTML report.
 * Use this to support progress callbacks and HTML report generation at the framework level.
 *
 * @param agent - Agent with .stream(input, config) (e.g. LangChain createAgent())
 * @param input - Input to agent.stream()
 * @param options - systemPrompt, userPrompt, reportPath, htmlReportPath, templatePath, streamConfig, onStep
 * @returns { steps, reportMarkdown, htmlPath? }
 */
export async function runAgentWithReport(
  agent: StreamableAgent,
  input: unknown,
  options: RunAgentWithReportOptions
): Promise<RunAgentWithReportResult> {
  const stream = await agent.stream(input, options.streamConfig ?? {});
  const { steps, lastAiContent } = await collectStreamSteps(stream, { onStep: options.onStep });

  let reportMarkdown = lastAiContent;
  if (options.reportPath) {
    const reportPath = resolve(options.reportPath);
    if (existsSync(reportPath)) {
      reportMarkdown = readFileSync(reportPath, "utf8");
    }
  }

  let htmlPath: string | undefined;
  if (options.htmlReportPath) {
    htmlPath = generateAgentReport(
      {
        systemPrompt: options.systemPrompt,
        userPrompt: options.userPrompt,
        reportMarkdown,
        steps,
      },
      {
        outputPath: options.htmlReportPath,
        templatePath: options.templatePath,
      }
    );
  }

  return { steps, reportMarkdown, htmlPath };
}

/**
 * Consume an agent stream and optionally write the HTML report.
 * Use this with regular LangChain usage: get the stream from agent.stream(), then pass it here.
 *
 * @param stream - Stream from agent.stream(input, config)
 * @param options - systemPrompt, userPrompt, reportPath?, htmlReportPath?, templatePath?, onStep?
 * @returns { steps, reportMarkdown, htmlPath? }
 */
export async function writeReportFromStream(
  stream: AsyncIterable<Record<string, unknown>>,
  options: WriteReportFromStreamOptions
): Promise<RunAgentWithReportResult> {
  const { steps, lastAiContent } = await collectStreamSteps(stream, { onStep: options.onStep });

  let reportMarkdown = lastAiContent;
  if (options.reportPath) {
    const reportPath = resolve(options.reportPath);
    if (existsSync(reportPath)) {
      reportMarkdown = readFileSync(reportPath, "utf8");
    }
  }

  let htmlPath: string | undefined;
  if (options.htmlReportPath) {
    htmlPath = generateAgentReport(
      {
        systemPrompt: options.systemPrompt,
        userPrompt: options.userPrompt,
        reportMarkdown,
        steps,
      },
      {
        outputPath: options.htmlReportPath,
        templatePath: options.templatePath,
      }
    );
  }

  return { steps, reportMarkdown, htmlPath };
}
