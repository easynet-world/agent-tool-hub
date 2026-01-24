import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";

export const templateRenderInputSchema = {
  type: "object",
  properties: {
    template: {
      type: "string",
      description: "Mustache template string",
    },
    data: {
      type: "object",
      additionalProperties: true,
      description: "Data object for template variables",
    },
  },
  required: ["template", "data"],
  additionalProperties: false,
} as const;

export const templateRenderOutputSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

export const templateRenderSpec: ToolSpec = {
  name: "core/util.template.render",
  version: "1.0.0",
  kind: "core",
  description: "Render a Mustache template with data",
  tags: ["util", "template", "core"],
  inputSchema: templateRenderInputSchema,
  outputSchema: templateRenderOutputSchema,
  capabilities: [],
};

export const templateRenderHandler: CoreToolHandler = async (args) => {
  const template = args.template as string;
  const data = args.data as Record<string, unknown>;

  let renderFn: (template: string, view: unknown) => string;
  try {
    const mod = await import("mustache");
    // Handle both default and named exports
    const mustache = mod.default ?? mod;
    renderFn = mustache.render.bind(mustache);
  } catch {
    throw new Error(
      "mustache package is required for core/util.template.render. Install it with: npm install mustache",
    );
  }

  let text: string;
  try {
    text = renderFn(template, data);
  } catch (err) {
    throw new Error(
      `Template rendering error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    result: { text },
    evidence: [
      {
        type: "tool",
        ref: "core/util.template.render",
        summary: `Rendered template (${template.length} chars) → ${text.length} chars output`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
