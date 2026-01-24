import type { Capability, ToolSpec } from "../types/ToolSpec.js";
import type { ExecContext } from "../types/ToolIntent.js";

/**
 * Policy configuration for the engine.
 */
export interface PolicyConfig {
  /** File system sandbox paths (allowed write directories) */
  sandboxPaths?: string[];
  /** Allowed URL patterns (regex strings) */
  urlAllowlist?: string[];
  /** Denied URL patterns (regex strings) */
  urlDenylist?: string[];
  /** SQL patterns that are denied (e.g., DROP, TRUNCATE) */
  deniedSqlPatterns?: string[];
  /** Network allowed domains */
  allowedDomains?: string[];
  /** Whether to require explicit permission for danger:destructive */
  requireExplicitDangerPermission?: boolean;
}

/**
 * Result of a policy check.
 */
export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  missingCapabilities?: Capability[];
}

/**
 * Policy engine for capability gating, parameter security, and access control.
 */
export class PolicyEngine {
  private readonly config: PolicyConfig;

  constructor(config: PolicyConfig = {}) {
    this.config = {
      requireExplicitDangerPermission: true,
      deniedSqlPatterns: ["DROP\\s", "TRUNCATE\\s", "DELETE\\s+FROM\\s+\\w+\\s*$"],
      ...config,
    };
  }

  /**
   * Enforce all policy checks. Throws PolicyDeniedError if denied.
   */
  enforce(spec: ToolSpec, args: unknown, ctx: ExecContext): void {
    const result = this.check(spec, args, ctx);
    if (!result.allowed) {
      throw new PolicyDeniedError(
        result.reason ?? "Policy denied",
        result.missingCapabilities,
      );
    }
  }

  /**
   * Check all policies without throwing.
   */
  check(spec: ToolSpec, args: unknown, ctx: ExecContext): PolicyCheckResult {
    // 1. Capability gate
    const capResult = this.checkCapabilities(spec, ctx);
    if (!capResult.allowed) return capResult;

    // 2. Parameter-level security
    const paramResult = this.checkParameters(spec, args);
    if (!paramResult.allowed) return paramResult;

    // 3. Dry-run check (if enabled, just allow but flag)
    return { allowed: true };
  }

  /**
   * Check that context permissions cover tool capabilities.
   */
  private checkCapabilities(
    spec: ToolSpec,
    ctx: ExecContext,
  ): PolicyCheckResult {
    const missing: Capability[] = [];

    for (const cap of spec.capabilities) {
      if (cap === "danger:destructive") {
        // Destructive capability requires explicit permission
        if (
          this.config.requireExplicitDangerPermission &&
          !ctx.permissions.includes("danger:destructive")
        ) {
          missing.push(cap);
        }
      } else if (!ctx.permissions.includes(cap)) {
        missing.push(cap);
      }
    }

    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `Missing capabilities: ${missing.join(", ")}`,
        missingCapabilities: missing,
      };
    }

    return { allowed: true };
  }

  /**
   * Check parameter-level security constraints.
   */
  private checkParameters(spec: ToolSpec, args: unknown): PolicyCheckResult {
    if (!args || typeof args !== "object") return { allowed: true };

    const argsObj = args as Record<string, unknown>;

    // File path sandboxing
    if (spec.capabilities.includes("write:fs") && this.config.sandboxPaths) {
      const pathResult = this.checkFilePaths(argsObj);
      if (!pathResult.allowed) return pathResult;
    }

    // URL allowlist/denylist
    if (
      spec.capabilities.includes("network") ||
      spec.capabilities.includes("read:web")
    ) {
      const urlResult = this.checkUrls(argsObj);
      if (!urlResult.allowed) return urlResult;
    }

    // SQL injection prevention
    if (
      spec.capabilities.includes("write:db") ||
      spec.capabilities.includes("read:db")
    ) {
      const sqlResult = this.checkSql(argsObj);
      if (!sqlResult.allowed) return sqlResult;
    }

    // Network domain restrictions
    if (spec.capabilities.includes("network") && this.config.allowedDomains) {
      const domainResult = this.checkDomains(argsObj);
      if (!domainResult.allowed) return domainResult;
    }

    return { allowed: true };
  }

  private checkFilePaths(args: Record<string, unknown>): PolicyCheckResult {
    const paths = this.extractStringValues(args, ["path", "file", "filepath", "filename", "dir", "directory"]);
    for (const p of paths) {
      const normalized = p.replace(/\.\./g, "");
      if (p.includes("..")) {
        return {
          allowed: false,
          reason: `Path traversal detected: ${p}`,
        };
      }
      if (this.config.sandboxPaths && this.config.sandboxPaths.length > 0) {
        const inSandbox = this.config.sandboxPaths.some(
          (sp) => normalized.startsWith(sp),
        );
        if (!inSandbox) {
          return {
            allowed: false,
            reason: `Path outside sandbox: ${p}. Allowed: ${this.config.sandboxPaths.join(", ")}`,
          };
        }
      }
    }
    return { allowed: true };
  }

  private checkUrls(args: Record<string, unknown>): PolicyCheckResult {
    const urls = this.extractStringValues(args, ["url", "endpoint", "href", "uri"]);
    for (const url of urls) {
      // Check denylist
      if (this.config.urlDenylist) {
        for (const pattern of this.config.urlDenylist) {
          if (new RegExp(pattern, "i").test(url)) {
            return {
              allowed: false,
              reason: `URL denied by policy: ${url}`,
            };
          }
        }
      }
      // Check allowlist (if configured, URL must match)
      if (this.config.urlAllowlist && this.config.urlAllowlist.length > 0) {
        const allowed = this.config.urlAllowlist.some((pattern) =>
          new RegExp(pattern, "i").test(url),
        );
        if (!allowed) {
          return {
            allowed: false,
            reason: `URL not in allowlist: ${url}`,
          };
        }
      }
    }
    return { allowed: true };
  }

  private checkSql(args: Record<string, unknown>): PolicyCheckResult {
    const sqls = this.extractStringValues(args, ["sql", "query", "statement"]);
    for (const sql of sqls) {
      if (this.config.deniedSqlPatterns) {
        for (const pattern of this.config.deniedSqlPatterns) {
          if (new RegExp(pattern, "i").test(sql)) {
            return {
              allowed: false,
              reason: `SQL pattern denied: ${sql.slice(0, 50)}...`,
            };
          }
        }
      }
    }
    return { allowed: true };
  }

  private checkDomains(args: Record<string, unknown>): PolicyCheckResult {
    const urls = this.extractStringValues(args, ["url", "endpoint", "href", "host", "domain"]);
    for (const url of urls) {
      try {
        const hostname = url.includes("://")
          ? new URL(url).hostname
          : url;
        if (
          this.config.allowedDomains &&
          !this.config.allowedDomains.some(
            (d) => hostname === d || hostname.endsWith(`.${d}`),
          )
        ) {
          return {
            allowed: false,
            reason: `Domain not allowed: ${hostname}`,
          };
        }
      } catch {
        // Not a valid URL, skip
      }
    }
    return { allowed: true };
  }

  /**
   * Extract string values from args matching given key patterns.
   */
  private extractStringValues(
    args: Record<string, unknown>,
    keyPatterns: string[],
  ): string[] {
    const results: string[] = [];
    const walk = (obj: Record<string, unknown>) => {
      for (const [key, val] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (
          typeof val === "string" &&
          keyPatterns.some((p) => lowerKey.includes(p))
        ) {
          results.push(val);
        } else if (val && typeof val === "object" && !Array.isArray(val)) {
          walk(val as Record<string, unknown>);
        }
      }
    };
    walk(args);
    return results;
  }
}

/**
 * Error thrown when policy denies execution.
 */
export class PolicyDeniedError extends Error {
  public readonly kind = "POLICY_DENIED";

  constructor(
    message: string,
    public readonly missingCapabilities?: Capability[],
  ) {
    super(message);
    this.name = "PolicyDeniedError";
  }
}
