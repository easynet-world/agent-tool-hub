import type { Evidence, ToolError } from "./ToolResult.js";

/**
 * Event types emitted by PTCRuntime and observability layer.
 */
export type ToolEventType =
  | "TOOL_CALLED"
  | "TOOL_RESULT"
  | "POLICY_DENIED"
  | "RETRY"
  | "TIMEOUT"
  | "BUDGET_EXCEEDED"
  | "JOB_SUBMITTED"
  | "JOB_COMPLETED"
  | "JOB_FAILED";

/**
 * Base event structure for all tool events.
 */
export interface ToolEvent {
  type: ToolEventType;
  timestamp: string; // ISO 8601
  requestId: string;
  taskId: string;
  toolName: string;
  traceId?: string;
  userId?: string;
}

/**
 * Emitted when a tool is called.
 */
export interface ToolCalledEvent extends ToolEvent {
  type: "TOOL_CALLED";
  argsSummary: string; // Sanitized summary of args
  purpose: string;
  idempotencyKey?: string;
}

/**
 * Emitted when a tool returns a result.
 */
export interface ToolResultEvent extends ToolEvent {
  type: "TOOL_RESULT";
  ok: boolean;
  durationMs: number;
  resultSummary: string;
  evidence: Evidence[];
  error?: ToolError;
}

/**
 * Emitted when policy denies a tool invocation.
 */
export interface PolicyDeniedEvent extends ToolEvent {
  type: "POLICY_DENIED";
  reason: string;
  missingCapabilities?: string[];
}

/**
 * Emitted on retry.
 */
export interface RetryEvent extends ToolEvent {
  type: "RETRY";
  attempt: number;
  maxRetries: number;
  reason: string;
}

/**
 * Async job events.
 */
export interface JobSubmittedEvent extends ToolEvent {
  type: "JOB_SUBMITTED";
  jobId: string;
}

export interface JobCompletedEvent extends ToolEvent {
  type: "JOB_COMPLETED";
  jobId: string;
  durationMs: number;
}

export interface JobFailedEvent extends ToolEvent {
  type: "JOB_FAILED";
  jobId: string;
  error: string;
}

/**
 * Union type of all tool events.
 */
export type AnyToolEvent =
  | ToolCalledEvent
  | ToolResultEvent
  | PolicyDeniedEvent
  | RetryEvent
  | JobSubmittedEvent
  | JobCompletedEvent
  | JobFailedEvent;
