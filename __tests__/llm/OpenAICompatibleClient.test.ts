import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOpenAICompatibleClient,
  OpenAICompatibleClient,
} from "../../src/llm/OpenAICompatibleClient.js";

describe("OpenAICompatibleClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("createOpenAICompatibleClient", () => {
    it("returns an instance with chat method", () => {
      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini"
      );
      expect(client).toBeInstanceOf(OpenAICompatibleClient);
      expect(typeof client.chat).toBe("function");
    });

    it("accepts optional apiKey", () => {
      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini",
        "sk-secret"
      );
      expect(client).toBeInstanceOf(OpenAICompatibleClient);
    });
  });

  describe("chat", () => {
    it("sends POST to baseUrl/chat/completions with model and messages", async () => {
      const mockJson = vi.fn().mockResolvedValue({
        choices: [{ message: { role: "assistant", content: "Hi there." } }],
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: mockJson,
      });

      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini"
      );
      const result = await client.chat([
        { role: "user", content: "Hello" },
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
      });
      const body = JSON.parse(init?.body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);

      expect(result.content).toBe("Hi there.");
      expect(result.raw).toEqual({
        choices: [{ message: { role: "assistant", content: "Hi there." } }],
      });
    });

    it("sends Authorization header when apiKey is provided", async () => {
      const mockJson = vi.fn().mockResolvedValue({
        choices: [{ message: { content: "OK" } }],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: mockJson });

      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini",
        "sk-secret"
      );
      await client.chat([{ role: "user", content: "Hi" }]);

      const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-secret",
      });
    });

    it("normalizes baseUrl by stripping trailing slash", async () => {
      const mockJson = vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Yep" } }],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: mockJson });

      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1/",
        "gpt-4o-mini"
      );
      await client.chat([{ role: "user", content: "Hi" }]);

      const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(url).toBe("https://api.example.com/v1/chat/completions");
    });

    it("returns empty content when choices[0].message.content is missing", async () => {
      const mockJson = vi.fn().mockResolvedValue({
        choices: [{ message: {} }],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: mockJson });

      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini"
      );
      const result = await client.chat([{ role: "user", content: "Hi" }]);

      expect(result.content).toBe("");
      expect(result.raw).toEqual({ choices: [{ message: {} }] });
    });

    it("throws on non-OK response with error body", async () => {
      const mockJson = vi.fn().mockResolvedValue({
        error: { message: "Invalid API key", type: "invalid_request_error" },
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: mockJson,
      });

      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini"
      );

      await expect(
        client.chat([{ role: "user", content: "Hi" }])
      ).rejects.toThrow(/LLM API error 401/);
    });

    it("uses custom timeout when provided", async () => {
      const mockJson = vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Done" } }],
      });
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: mockJson });

      const client = createOpenAICompatibleClient(
        "https://api.example.com/v1",
        "gpt-4o-mini"
      );
      await client.chat([{ role: "user", content: "Hi" }], {
        timeoutMs: 10_000,
      });

      const init = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
