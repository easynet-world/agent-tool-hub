/**
 * Step data for the agent run report (serializable).
 */
export interface AgentReportStep {
  stepIndex: number;
  node: string;
  input?: unknown;
  output?: unknown;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/**
 * Data passed to the HTML report template.
 */
export interface AgentReportData {
  systemPrompt: string;
  userPrompt: string;
  reportMarkdown: string;
  steps: AgentReportStep[];
}

/**
 * Agent-like interface: has stream(input, config) returning AsyncIterable.
 */
export interface StreamableAgent {
  stream(
    input: unknown,
    config?: { recursionLimit?: number; [key: string]: unknown }
  ): Promise<AsyncIterable<Record<string, unknown>>>;
}

/**
 * Options for collecting steps from an agent stream.
 */
export interface CollectStreamStepsOptions {
  /** Called for each step (e.g. to log progress). */
  onStep?: (step: AgentReportStep) => void;
}

/**
 * Result of collectStreamSteps (steps plus last AI message content for report tab).
 */
export interface CollectStreamStepsResult {
  steps: AgentReportStep[];
  /** Last AI message content from the stream (for Report tab when no reportPath). */
  lastAiContent: string;
}

/**
 * Options for runAgentWithReport.
 */
export interface RunAgentWithReportOptions {
  /** System prompt (for report header and HTML). */
  systemPrompt: string;
  /** User prompt (for report header and HTML). */
  userPrompt: string;
  /** Path to markdown report file to read after run (optional). */
  reportPath?: string;
  /** Path to write the HTML report (required if writing report). */
  htmlReportPath?: string;
  /** Path to HTML template (optional). */
  templatePath?: string;
  /** Passed to agent.stream(input, streamConfig). */
  streamConfig?: { recursionLimit?: number; [key: string]: unknown };
  /** Called for each step during stream (e.g. console progress). */
  onStep?: (step: AgentReportStep) => void;
}

/**
 * Result of runAgentWithReport and writeReportFromStream.
 */
export interface RunAgentWithReportResult {
  steps: AgentReportStep[];
  reportMarkdown: string;
  htmlPath?: string;
}

/**
 * Options for writeReportFromStream (pass stream from agent.stream() to generate report).
 */
export interface WriteReportFromStreamOptions {
  /** System prompt (for report header and HTML). */
  systemPrompt: string;
  /** User prompt (for report header and HTML). */
  userPrompt: string;
  /** Path to markdown report file to read after stream ends (optional). */
  reportPath?: string;
  /** Path to write the HTML report (optional). */
  htmlReportPath?: string;
  /** Path to custom HTML template (optional; uses built-in if not set). */
  templatePath?: string;
  /** Called for each step while consuming the stream (e.g. console progress). */
  onStep?: (step: AgentReportStep) => void;
}
