import { EventEmitter } from "eventemitter3";
import type { AnyToolEvent, ToolEventType } from "../types/Events.js";

/**
 * Event log entry with sequence number.
 */
export interface LogEntry {
  seq: number;
  event: AnyToolEvent;
}

/**
 * Event log listener type.
 */
export type EventListener = (entry: LogEntry) => void;

/**
 * Append-only event log for tool invocations.
 * Supports in-memory storage with configurable max size and event subscriptions.
 */
export class EventLog {
  private readonly entries: LogEntry[] = [];
  private seq = 0;
  private readonly maxEntries: number;
  private readonly emitter = new EventEmitter();

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  /**
   * Append an event to the log.
   */
  append(event: AnyToolEvent): LogEntry {
    const entry: LogEntry = { seq: ++this.seq, event };

    this.entries.push(entry);

    // Trim if over max
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Emit to subscribers
    this.emitter.emit("event", entry);
    this.emitter.emit(event.type, entry);

    return entry;
  }

  /**
   * Subscribe to all events.
   */
  on(listener: EventListener): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  /**
   * Subscribe to events of a specific type.
   */
  onType(type: ToolEventType, listener: EventListener): () => void {
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }

  /**
   * Query events by filter.
   */
  query(filter: {
    type?: ToolEventType;
    toolName?: string;
    requestId?: string;
    since?: number; // seq number
    limit?: number;
  }): LogEntry[] {
    let results = this.entries;

    if (filter.since !== undefined) {
      results = results.filter((e) => e.seq > filter.since!);
    }
    if (filter.type) {
      results = results.filter((e) => e.event.type === filter.type);
    }
    if (filter.toolName) {
      results = results.filter((e) => e.event.toolName === filter.toolName);
    }
    if (filter.requestId) {
      results = results.filter((e) => e.event.requestId === filter.requestId);
    }
    if (filter.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  /**
   * Get all entries.
   */
  getAll(): readonly LogEntry[] {
    return this.entries;
  }

  /**
   * Get entry count.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.entries.length = 0;
    this.seq = 0;
  }
}
