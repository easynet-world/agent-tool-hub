import { createHash } from "node:crypto";
import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";

export const hashTextInputSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "Text to hash" },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

export const hashTextOutputSchema = {
  type: "object",
  properties: {
    sha256: { type: "string" },
  },
  required: ["sha256"],
  additionalProperties: false,
} as const;

export const hashTextSpec: ToolSpec = {
  name: "core/util.hash.sha256Text",
  version: "1.0.0",
  kind: "core",
  description: "Compute SHA-256 hash of a text string",
  tags: ["util", "hash", "core"],
  inputSchema: hashTextInputSchema,
  outputSchema: hashTextOutputSchema,
  capabilities: [],
};

export const hashTextHandler: CoreToolHandler = async (args) => {
  const text = args.text as string;
  const sha256 = createHash("sha256").update(text, "utf-8").digest("hex");

  return {
    result: { sha256 },
    evidence: [
      {
        type: "tool",
        ref: "core/util.hash.sha256Text",
        summary: `SHA-256 of ${text.length} chars: ${sha256.slice(0, 16)}...`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
};
