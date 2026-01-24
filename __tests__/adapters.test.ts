import { describe, it, expect, beforeEach } from "vitest";
import { LangChainAdapter } from "../src/adapters/LangChainAdapter.js";
import { MCPAdapter } from "../src/adapters/MCPAdapter.js";
import { SkillAdapter } from "../src/adapters/SkillAdapter.js";
import { N8nAdapter } from "../src/adapters/N8nAdapter.js";
import { ComfyUIAdapter } from "../src/adapters/ComfyUIAdapter.js";
import type { MCPClientLike } from "../src/adapters/MCPAdapter.js";
import type { HttpClient } from "../src/adapters/N8nAdapter.js";
import type { ComfyUIHttpClient } from "../src/adapters/ComfyUIAdapter.js";
import { calcToolSpec, defaultCtx } from "./fixtures/index.js";

describe("LangChainAdapter", () => {
  let adapter: LangChainAdapter;

  beforeEach(() => {
    adapter = new LangChainAdapter();
  });

  it("should invoke registered tools", async () => {
    adapter.registerTool("test/echo", {
      async invoke(input) {
        return { echo: input };
      },
    });

    const spec = { ...calcToolSpec, name: "test/echo", impl: undefined };
    const result = await adapter.invoke(spec, { message: "hello" }, defaultCtx);

    expect(result.result).toEqual({ echo: { message: "hello" } });
  });

  it("should invoke tools from spec.impl", async () => {
    const spec = {
      ...calcToolSpec,
      impl: { async invoke(input: unknown) { return { doubled: input }; } },
    };

    const result = await adapter.invoke(spec, 42, defaultCtx);
    expect(result.result).toEqual({ doubled: 42 });
  });

  it("should list registered tools", async () => {
    adapter.registerTool("test/a", { async invoke() { return "a"; } });
    adapter.registerTool("test/b", { async invoke() { return "b"; } });

    const tools = await adapter.listTools();
    expect(tools.length).toBe(2);
    expect(tools.map((t) => t.name)).toContain("test/a");
  });

  it("should wrap string results in object", async () => {
    adapter.registerTool("test/str", {
      async invoke() { return "plain string"; },
    });

    const spec = { ...calcToolSpec, name: "test/str" };
    const result = await adapter.invoke(spec, {}, defaultCtx);
    expect(result.result).toEqual({ output: "plain string" });
  });
});

describe("MCPAdapter", () => {
  it("should list tools from MCP client", async () => {
    const mockClient: MCPClientLike = {
      async listTools() {
        return {
          tools: [
            { name: "web_search", description: "Search the web", inputSchema: {} },
            { name: "read_file", description: "Read a file" },
          ],
        };
      },
      async callTool() {
        return { content: [] };
      },
    };

    const adapter = new MCPAdapter({ client: mockClient, prefix: "test" });
    const tools = await adapter.listTools();

    expect(tools.length).toBe(2);
    expect(tools[0]!.name).toBe("test/web_search");
    expect(tools[0]!.kind).toBe("mcp");
  });

  it("should invoke MCP tools", async () => {
    const mockClient: MCPClientLike = {
      async listTools() { return { tools: [] }; },
      async callTool(params) {
        return {
          content: [{ type: "text", text: JSON.stringify({ found: true, query: params.arguments?.q }) }],
        };
      },
    };

    const adapter = new MCPAdapter({ client: mockClient, prefix: "test" });
    const spec = { ...calcToolSpec, name: "test/search", kind: "mcp" as const };
    const result = await adapter.invoke(spec, { q: "hello" }, defaultCtx);

    expect(result.result).toEqual({ found: true, query: "hello" });
  });

  it("should throw on MCP errors", async () => {
    const mockClient: MCPClientLike = {
      async listTools() { return { tools: [] }; },
      async callTool() {
        return { content: [{ type: "text", text: "Something went wrong" }], isError: true };
      },
    };

    const adapter = new MCPAdapter({ client: mockClient, prefix: "test" });
    const spec = { ...calcToolSpec, name: "test/fail", kind: "mcp" as const };

    await expect(adapter.invoke(spec, {}, defaultCtx)).rejects.toThrow("MCP tool error");
  });

  it("should cache tool listings", async () => {
    let callCount = 0;
    const mockClient: MCPClientLike = {
      async listTools() {
        callCount++;
        return { tools: [{ name: "t1", description: "test" }] };
      },
      async callTool() { return { content: [] }; },
    };

    const adapter = new MCPAdapter({ client: mockClient });
    await adapter.listTools();
    await adapter.listTools();

    expect(callCount).toBe(1); // Cached
  });
});

describe("SkillAdapter", () => {
  const testDefinition = {
    frontmatter: { name: "skill-summarize", description: "Summarizes text" },
    instructions: "# Summarize\n\nSummarize the input.",
    resources: [],
    dirPath: "/tmp/test-skill",
    skillMdPath: "/tmp/test-skill/SKILL.md",
  };

  it("should invoke registered skills with handler", async () => {
    const adapter = new SkillAdapter();
    adapter.registerSkill("skill/summarize", testDefinition, async (args, ctx) => {
      return {
        result: { summary: `Summarized: ${(args as any).text}` },
        evidence: [
          { type: "text", ref: "summary", summary: "Generated summary", createdAt: new Date().toISOString() },
        ],
      };
    });

    const spec = { ...calcToolSpec, name: "skill/summarize", kind: "skill" as const };
    const result = await adapter.invoke(spec, { text: "Long text here" }, defaultCtx);

    expect(result.result).toEqual({ summary: "Summarized: Long text here" });
  });

  it("should return instructions when no handler registered", async () => {
    const adapter = new SkillAdapter();
    adapter.registerSkill("skill/summarize", testDefinition);

    const spec = { ...calcToolSpec, name: "skill/summarize", kind: "skill" as const };
    const result = await adapter.invoke(spec, {}, defaultCtx);

    expect((result.result as any).name).toBe("skill-summarize");
    expect((result.result as any).instructions).toContain("# Summarize");
  });

  it("should throw for missing skill definition", async () => {
    const adapter = new SkillAdapter();
    const spec = { ...calcToolSpec, name: "skill/unknown", kind: "skill" as const };

    await expect(adapter.invoke(spec, {}, defaultCtx)).rejects.toThrow("not found");
  });

  it("should support spec.impl as SkillDefinition with handler", async () => {
    const adapter = new SkillAdapter();
    const handler = async (args: unknown) => ({
      result: { processed: true },
    });

    const spec = {
      ...calcToolSpec,
      name: "skill/inline",
      kind: "skill" as const,
      impl: { ...testDefinition, handler },
    };
    const result = await adapter.invoke(spec, {}, defaultCtx);

    expect(result.result).toEqual({ processed: true });
  });
});

describe("N8nAdapter", () => {
  it("should invoke webhook-based workflows", async () => {
    const mockHttp: HttpClient = {
      async fetch(url, options) {
        return {
          status: 200,
          async json() { return { ok: true, ts: "123" }; },
          async text() { return ""; },
        };
      },
    };

    const adapter = new N8nAdapter({ httpClient: mockHttp });
    const spec = {
      ...calcToolSpec,
      name: "workflow/test",
      kind: "n8n" as const,
      endpoint: "https://n8n.example.com/webhook/abc",
    };

    const result = await adapter.invoke(spec, { channel: "#test", text: "hi" }, defaultCtx);
    expect(result.result).toEqual({ ok: true, ts: "123" });
  });

  it("should handle webhook errors", async () => {
    const mockHttp: HttpClient = {
      async fetch() {
        return {
          status: 500,
          async json() { return {}; },
          async text() { return "Internal Server Error"; },
        };
      },
    };

    const adapter = new N8nAdapter({ httpClient: mockHttp });
    const spec = {
      ...calcToolSpec,
      name: "workflow/fail",
      kind: "n8n" as const,
      endpoint: "https://n8n.example.com/webhook/fail",
    };

    await expect(adapter.invoke(spec, {}, defaultCtx)).rejects.toThrow("n8n webhook failed");
  });

  it("should deduplicate calls with same idempotency key", async () => {
    let callCount = 0;
    const mockHttp: HttpClient = {
      async fetch() {
        callCount++;
        return {
          status: 200,
          async json() { return { ok: true, call: callCount }; },
          async text() { return ""; },
        };
      },
    };

    const adapter = new N8nAdapter({ httpClient: mockHttp });
    const spec = {
      ...calcToolSpec,
      name: "workflow/dedup",
      kind: "n8n" as const,
      endpoint: "https://n8n.example.com/webhook/dedup",
    };

    // Same context = same idempotency key
    const r1 = await adapter.invoke(spec, {}, defaultCtx);
    const r2 = await adapter.invoke(spec, {}, defaultCtx);

    expect(callCount).toBe(1); // Second call uses cached result
    expect(r1.result).toEqual(r2.result);
  });
});

describe("ComfyUIAdapter", () => {
  it("should queue and poll for results", async () => {
    let pollCount = 0;
    const mockHttp: ComfyUIHttpClient = {
      async fetch(url, options) {
        if (url.includes("/prompt") && options.method === "POST") {
          return {
            status: 200,
            async json() { return { prompt_id: "p-123", number: 1 }; },
            async text() { return ""; },
          };
        }
        if (url.includes("/history/")) {
          pollCount++;
          if (pollCount >= 2) {
            return {
              status: 200,
              async json() {
                return {
                  "p-123": {
                    status: { status_str: "success", completed: true },
                    outputs: {
                      "9": {
                        images: [{ filename: "out.png", subfolder: "", type: "output" }],
                      },
                    },
                  },
                };
              },
              async text() { return ""; },
            };
          }
          return {
            status: 200,
            async json() {
              return { "p-123": { status: { status_str: "running", completed: false }, outputs: {} } };
            },
            async text() { return ""; },
          };
        }
        return { status: 404, async json() { return {}; }, async text() { return ""; } };
      },
    };

    const adapter = new ComfyUIAdapter({
      httpClient: mockHttp,
      pollIntervalMs: 10, // Fast polling for test
    });

    const spec = {
      ...calcToolSpec,
      name: "comfyui/gen",
      kind: "comfyui" as const,
    };

    const result = await adapter.invoke(spec, { prompt: { "1": { class_type: "KSampler" } } }, defaultCtx);

    expect((result.result as any).promptId).toBe("p-123");
    expect((result.result as any).outputs.length).toBe(1);
    expect((result.result as any).outputs[0].images[0].filename).toBe("out.png");
  });

  it("should return job info for async tools", async () => {
    const mockHttp: ComfyUIHttpClient = {
      async fetch(url, options) {
        return {
          status: 200,
          async json() { return { prompt_id: "p-456", number: 2 }; },
          async text() { return ""; },
        };
      },
    };

    const adapter = new ComfyUIAdapter({ httpClient: mockHttp });
    const spec = {
      ...calcToolSpec,
      name: "comfyui/async",
      kind: "comfyui" as const,
      costHints: { isAsync: true },
    };

    const result = await adapter.invoke(spec, { prompt: {} }, defaultCtx);

    expect((result.result as any).jobId).toBe("p-456");
    expect((result.result as any).status).toBe("queued");
  });
});
