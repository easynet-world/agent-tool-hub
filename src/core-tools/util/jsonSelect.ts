import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";

export const jsonSelectInputSchema = {
  type: "object",
  properties: {
    json: {
      description: "JSON data to query (object or array)",
    },
    path: {
      type: "string",
      description: "JMESPath expression to select fields from the JSON data",
    },
  },
  required: ["json", "path"],
  additionalProperties: false,
} as const;

export const jsonSelectOutputSchema = {
  type: "object",
  properties: {
    value: { description: "Selected value(s) from the JSON data" },
  },
  required: ["value"],
  additionalProperties: false,
} as const;

export const jsonSelectSpec: ToolSpec = {
  name: "core/util.json.select",
  version: "1.0.0",
  kind: "core",
  description: "Select fields from JSON data using JMESPath expressions",
  tags: ["util", "json", "core"],
  inputSchema: jsonSelectInputSchema,
  outputSchema: jsonSelectOutputSchema,
  capabilities: [],
};

export const jsonSelectHandler: CoreToolHandler = async (args) => {
  const json = args.json;
  const path = args.path as string;

  let jmespath: { search: (data: unknown, expression: string) => unknown };
  try {
    jmespath = await import("jmespath");
  } catch {
    throw new Error(
      "jmespath package is required for core/util.json.select. Install it with: npm install jmespath",
    );
  }

  let value: unknown;
  try {
    value = jmespath.search(json, path);
  } catch (err) {
    throw new Error(
      `JMESPath expression error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    result: { value },
    evidence: [
      {
        type: "tool",
        ref: "core/util.json.select",
        summary: `Selected "${path}" from JSON → ${typeof value === "object" ? JSON.stringify(value).slice(0, 100) : String(value).slice(0, 100)}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
