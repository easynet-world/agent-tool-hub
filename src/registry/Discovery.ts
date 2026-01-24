import type { ToolAdapter, ToolSpec } from "../types/ToolSpec.js";
import type { ToolRegistry } from "./ToolRegistry.js";

/**
 * Discovery source configuration.
 */
export interface DiscoverySource {
  /** Unique identifier for this source */
  id: string;
  /** The adapter that supports listTools() */
  adapter: ToolAdapter;
  /** Refresh interval in ms (0 = manual only) */
  refreshIntervalMs?: number;
  /** Whether to auto-discover on startup */
  autoDiscover?: boolean;
}

/**
 * Discovery manager that pulls tool specs from adapters
 * and registers them into the ToolRegistry.
 */
export class Discovery {
  private readonly sources = new Map<string, DiscoverySource>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly registry: ToolRegistry;
  private readonly lastRefresh = new Map<string, number>();
  private readonly discoveredTools = new Map<string, Set<string>>(); // sourceId → tool names

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * Add a discovery source.
   */
  addSource(source: DiscoverySource): void {
    this.sources.set(source.id, source);
    this.discoveredTools.set(source.id, new Set());

    // Start auto-refresh if configured
    if (source.refreshIntervalMs && source.refreshIntervalMs > 0) {
      const timer = setInterval(
        () => void this.refresh(source.id),
        source.refreshIntervalMs,
      );
      // Unref so it doesn't prevent process exit
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
      this.timers.set(source.id, timer);
    }

    // Auto-discover on add if configured
    if (source.autoDiscover) {
      void this.refresh(source.id);
    }
  }

  /**
   * Remove a discovery source and its registered tools.
   */
  removeSource(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }

    // Unregister tools from this source
    const tools = this.discoveredTools.get(id);
    if (tools) {
      for (const name of tools) {
        this.registry.unregister(name);
      }
    }

    this.sources.delete(id);
    this.discoveredTools.delete(id);
    this.lastRefresh.delete(id);
  }

  /**
   * Refresh tools from a specific source (or all sources).
   */
  async refresh(sourceId?: string): Promise<ToolSpec[]> {
    if (sourceId) {
      return this.refreshSource(sourceId);
    }

    const allSpecs: ToolSpec[] = [];
    for (const id of this.sources.keys()) {
      const specs = await this.refreshSource(id);
      allSpecs.push(...specs);
    }
    return allSpecs;
  }

  /**
   * Get the last refresh timestamp for a source.
   */
  getLastRefresh(sourceId: string): number | undefined {
    return this.lastRefresh.get(sourceId);
  }

  /**
   * Get all registered source IDs.
   */
  getSources(): string[] {
    return [...this.sources.keys()];
  }

  /**
   * Stop all refresh timers.
   */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private async refreshSource(sourceId: string): Promise<ToolSpec[]> {
    const source = this.sources.get(sourceId);
    if (!source) return [];

    if (!source.adapter.listTools) {
      return [];
    }

    try {
      const specs = await source.adapter.listTools();
      const currentTools = this.discoveredTools.get(sourceId) ?? new Set();
      const newToolNames = new Set(specs.map((s) => s.name));

      // Unregister tools that are no longer present
      for (const name of currentTools) {
        if (!newToolNames.has(name)) {
          this.registry.unregister(name);
        }
      }

      // Register/update tools
      for (const spec of specs) {
        this.registry.register(spec);
      }

      this.discoveredTools.set(sourceId, newToolNames);
      this.lastRefresh.set(sourceId, Date.now());

      return specs;
    } catch (error) {
      // Log but don't throw - discovery failures shouldn't crash the system
      console.error(`Discovery refresh failed for source ${sourceId}:`, error);
      return [];
    }
  }
}
