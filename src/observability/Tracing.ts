import { v4 as uuidv4 } from "uuid";

/**
 * A trace span representing a unit of work.
 */
export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number; // ms epoch
  endTime?: number;
  durationMs?: number;
  status: "ok" | "error" | "in_progress";
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

/**
 * An event within a span.
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Lightweight tracing system for tool invocation spans.
 * Compatible with OpenTelemetry trace/span ID format.
 */
export class Tracing {
  private readonly spans = new Map<string, Span>();
  private readonly traceSpans = new Map<string, string[]>(); // traceId → spanIds

  /**
   * Start a new span.
   */
  startSpan(options: {
    name: string;
    traceId?: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }): Span {
    const span: Span = {
      spanId: uuidv4(),
      traceId: options.traceId ?? uuidv4(),
      parentSpanId: options.parentSpanId,
      name: options.name,
      startTime: Date.now(),
      status: "in_progress",
      attributes: options.attributes ?? {},
      events: [],
    };

    this.spans.set(span.spanId, span);

    const traceList = this.traceSpans.get(span.traceId) ?? [];
    traceList.push(span.spanId);
    this.traceSpans.set(span.traceId, traceList);

    return span;
  }

  /**
   * End a span and calculate duration.
   */
  endSpan(spanId: string, status: "ok" | "error" = "ok"): Span | undefined {
    const span = this.spans.get(spanId);
    if (!span) return undefined;

    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;
    return span;
  }

  /**
   * Add an event to a span.
   */
  addEvent(
    spanId: string,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.events.push({ name, timestamp: Date.now(), attributes });
  }

  /**
   * Set attributes on a span.
   */
  setAttributes(
    spanId: string,
    attributes: Record<string, string | number | boolean>,
  ): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    Object.assign(span.attributes, attributes);
  }

  /**
   * Get a span by ID.
   */
  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  /**
   * Get all spans for a trace.
   */
  getTrace(traceId: string): Span[] {
    const spanIds = this.traceSpans.get(traceId) ?? [];
    return spanIds
      .map((id) => this.spans.get(id))
      .filter((s): s is Span => s !== undefined);
  }

  /**
   * Create a child span from a parent.
   */
  createChildSpan(
    parentSpanId: string,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): Span | undefined {
    const parent = this.spans.get(parentSpanId);
    if (!parent) return undefined;
    return this.startSpan({
      name,
      traceId: parent.traceId,
      parentSpanId: parent.spanId,
      attributes,
    });
  }

  /**
   * Clear all traces (for testing).
   */
  clear(): void {
    this.spans.clear();
    this.traceSpans.clear();
  }
}
