import type { ToolSpec } from "../../types/ToolSpec.js";
import type { CoreToolHandler } from "../types.js";

export const nowInputSchema = {
  type: "object",
  properties: {
    timezone: {
      type: "string",
      description: "IANA timezone (e.g. 'America/New_York', 'Asia/Shanghai'). Defaults to UTC.",
    },
  },
  required: [],
  additionalProperties: false,
} as const;

export const nowOutputSchema = {
  type: "object",
  properties: {
    iso: { type: "string", description: "ISO 8601 timestamp" },
    epochMs: { type: "integer", description: "Unix epoch in milliseconds" },
    timezone: { type: "string" },
    formatted: { type: "string", description: "Human-readable formatted time" },
  },
  required: ["iso", "epochMs", "timezone", "formatted"],
  additionalProperties: false,
} as const;

export const nowSpec: ToolSpec = {
  name: "core/util.time.now",
  version: "1.0.0",
  kind: "core",
  description: "Get the current time in various formats",
  tags: ["util", "time", "core"],
  inputSchema: nowInputSchema,
  outputSchema: nowOutputSchema,
  capabilities: [],
};

export const nowHandler: CoreToolHandler = async (args) => {
  const timezone = (args.timezone as string | undefined) ?? "UTC";
  const now = new Date();

  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(now);
  } catch {
    formatted = now.toISOString();
  }

  return {
    result: {
      iso: now.toISOString(),
      epochMs: now.getTime(),
      timezone,
      formatted,
    },
    evidence: [
      {
        type: "tool",
        ref: "core/util.time.now",
        summary: `Current time: ${now.toISOString()} (${timezone})`,
        createdAt: now.toISOString(),
      },
    ],
  };
};
