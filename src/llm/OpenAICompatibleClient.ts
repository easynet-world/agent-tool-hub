/**
 * Minimal client for OpenAI-compatible chat completions API.
 * Use createOpenAICompatibleClient(baseUrl, model, apiKey?) and then .chat(messages).
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
  /** Content of the first assistant reply. */
  content: string;
  /** Raw response from the API (for debugging or advanced use). */
  raw: unknown;
}

export interface OpenAICompatibleClientConfig {
  /** Base URL of the API (e.g. https://api.openai.com/v1). Trailing slash is optional. */
  baseUrl: string;
  /** Model name (e.g. gpt-4o-mini). */
  model: string;
  /** API key; optional if the provider does not require it. */
  apiKey?: string;
}

/**
 * Creates an OpenAI-compatible LLM client.
 *
 * @param baseUrl - LLM API base URL (e.g. https://api.openai.com/v1)
 * @param model - Model name (e.g. gpt-4o-mini)
 * @param apiKey - Optional API key
 * @returns Client instance with .chat(messages, options?)
 */
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

  /**
   * Send chat messages and return the first assistant reply.
   *
   * @param messages - Array of { role, content }
   * @param options - Optional timeout
   * @returns Promise of { content, raw }
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResult> {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      }
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

    const choices = (raw as { choices?: Array<{ message?: { content?: string } }> }).choices;
    const content =
      Array.isArray(choices) && choices[0]?.message?.content != null
        ? String(choices[0].message.content)
        : "";

    return { content, raw };
  }
}
