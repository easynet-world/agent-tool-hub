/**
 * Minimal client for OpenAI-compatible chat completions API.
 * Use createOpenAICompatibleClient(baseUrl, model, apiKey?) and then .chat(messages) or .chatWithTools(messages, tools).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Request timeout in milliseconds. Default 60000. */
  timeoutMs?: number;
}

export interface ChatResult {
  content: string;
  raw: unknown;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}

export interface AssistantMessageWithToolCalls {
  role: "assistant";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ChatWithToolsResult {
  message: AssistantMessageWithToolCalls;
  raw: unknown;
}

export interface OpenAICompatibleClientConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createOpenAICompatibleClient(
  baseUrl: string,
  model: string,
  apiKey?: string
): OpenAICompatibleClient {
  return new OpenAICompatibleClient({ baseUrl, model, apiKey });
}

export class OpenAICompatibleClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(config: OpenAICompatibleClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResult> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const raw = await this.request(
      {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      },
      timeoutMs
    );
    const choices = (raw as { choices?: Array<{ message?: { content?: string } }> }).choices;
    const content =
      Array.isArray(choices) && choices[0]?.message?.content != null
        ? String(choices[0].message.content)
        : "";
    return { content, raw };
  }

  async chatWithTools(
    messages: Array<
      | ChatMessage
      | { role: "tool"; content: string; tool_call_id: string }
      | (Omit<AssistantMessageWithToolCalls, "role"> & { role: "assistant" })
    >,
    tools: OpenAIToolDefinition[],
    options?: ChatOptions
  ): Promise<ChatWithToolsResult> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const raw = await this.request(
      {
        model: this.model,
        messages: messages.map((m) => this.serializeMessage(m)),
        tools,
      },
      timeoutMs
    );
    const choices = (raw as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: AssistantMessageWithToolCalls["tool_calls"];
        };
      }>;
    }).choices;
    const msg = Array.isArray(choices) ? choices[0]?.message : undefined;
    return {
      message: {
        role: "assistant",
        content: msg?.content ?? null,
        tool_calls: msg?.tool_calls,
      },
      raw,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return headers;
  }

  private serializeMessage(
    m:
      | ChatMessage
      | { role: "tool"; content: string; tool_call_id: string }
      | (AssistantMessageWithToolCalls & { role: "assistant" })
  ): object {
    if (m.role === "tool")
      return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
    if (m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length)
      return { role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls };
    return { role: m.role, content: (m as ChatMessage).content };
  }

  private async request(body: object, timeoutMs: number): Promise<unknown> {
    const url = `${this.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError")
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      throw err;
    }
    clearTimeout(timer);
    const raw = (await response.json()) as unknown;
    if (!response.ok) {
      const errBody =
        typeof raw === "object" && raw !== null && "error" in (raw as object)
          ? (raw as { error: unknown }).error
          : raw;
      throw new Error(
        `LLM API error ${response.status}: ${JSON.stringify(errBody)}`
      );
    }
    return raw;
  }
}
