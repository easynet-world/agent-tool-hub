import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";

export const truncateInputSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to truncate" },
    maxChars: {
      type: "integer",
      minimum: 1,
      description: "Maximum number of characters",
    },
    suffix: {
      type: "string",
      default: "...",
      description: "Suffix to append when truncated",
    },
  },
  required: ["text", "maxChars"],
  additionalProperties: false,
} as const;

export const truncateOutputSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    truncated: { type: "boolean" },
    originalLength: { type: "integer" },
  },
  required: ["text", "truncated", "originalLength"],
  additionalProperties: false,
} as const;

export const truncateSpec: ToolSpec = {
  name: "core/util.text.truncate",
  version: "1.0.0",
  kind: "core",
  description: "Truncate text to a maximum character length with a suffix marker",
  tags: ["util", "text", "core"],
  inputSchema: truncateInputSchema,
  outputSchema: truncateOutputSchema,
  capabilities: [],
};

export const truncateHandler: CoreToolHandler = async (args) => {
  const text = args.text as string;
  const maxChars = args.maxChars as number;
  const suffix = (args.suffix as string | undefined) ?? "...";

  const originalLength = text.length;

  if (text.length <= maxChars) {
    return {
      result: { text, truncated: false, originalLength },
      evidence: [
        {
          type: "tool",
          ref: "core/util.text.truncate",
          summary: `Text not truncated (${originalLength} chars <= ${maxChars} max)`,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  const truncatedText = text.slice(0, maxChars - suffix.length) + suffix;

  return {
    result: { text: truncatedText, truncated: true, originalLength },
    evidence: [
      {
        type: "tool",
        ref: "core/util.text.truncate",
        summary: `Truncated ${originalLength} chars to ${truncatedText.length} chars`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
