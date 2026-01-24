export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

export interface DebugOptions {
  enabled?: boolean;
  level?: LogLevel;
  includeArgs?: boolean;
  includeResults?: boolean;
  includeRaw?: boolean;
  logEvents?: boolean;
  prefix?: string;
}

export interface ResolvedDebugOptions {
  enabled: boolean;
  level: LogLevel;
  includeArgs: boolean;
  includeResults: boolean;
  includeRaw: boolean;
  logEvents: boolean;
  prefix: string;
}

export interface Logger {
  options: ResolvedDebugOptions;
  isEnabled(level: LogLevel): boolean;
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  trace(message: string, meta?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export function createLogger(options: DebugOptions = {}): Logger {
  const resolved = resolveDebugOptions(options);

  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (!resolved.enabled) return;
    if (LEVEL_ORDER[level] > LEVEL_ORDER[resolved.level]) return;

    const prefix = `[${resolved.prefix}]`;
    const levelTag = `[${level.toUpperCase()}]`;
    const metaText = meta ? ` ${safeStringify(meta, 1000)}` : "";

    switch (level) {
      case "error":
        console.error(`${prefix} ${levelTag} ${message}${metaText}`);
        break;
      case "warn":
        console.warn(`${prefix} ${levelTag} ${message}${metaText}`);
        break;
      case "info":
        console.info(`${prefix} ${levelTag} ${message}${metaText}`);
        break;
      default:
        console.log(`${prefix} ${levelTag} ${message}${metaText}`);
        break;
    }
  };

  return {
    options: resolved,
    isEnabled: (level) => resolved.enabled && LEVEL_ORDER[level] <= LEVEL_ORDER[resolved.level],
    error: (message, meta) => log("error", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    info: (message, meta) => log("info", message, meta),
    debug: (message, meta) => log("debug", message, meta),
    trace: (message, meta) => log("trace", message, meta),
  };
}

export function resolveDebugOptions(options: DebugOptions = {}): ResolvedDebugOptions {
  const envLevel = parseEnvLogLevel();
  const enabledFromEnv = envLevel !== undefined && envLevel !== "silent";
  const enabled = options.enabled ?? enabledFromEnv ?? false;
  const level =
    options.level ?? envLevel ?? (enabled ? "debug" : "silent");

  return {
    enabled,
    level,
    includeArgs: options.includeArgs ?? false,
    includeResults: options.includeResults ?? false,
    includeRaw: options.includeRaw ?? false,
    logEvents: options.logEvents ?? false,
    prefix: options.prefix ?? "agent-tool-hub",
  };
}

export function sanitizeForLog(value: unknown, maxLen = 500): string {
  const str = safeStringify(value, maxLen);
  return str.replace(
    /"(password|token|secret|key|auth)":\s*"[^"]*"/gi,
    "\"$1\":\"[REDACTED]\"",
  );
}

export function summarizeForLog(value: unknown, maxLen = 200): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    const shown = keys.slice(0, 5).join(", ");
    return `Object(keys: ${shown}${keys.length > 5 ? ", ..." : ""})`;
  }
  return String(value);
}

function safeStringify(value: unknown, maxLen: number): string {
  try {
    const json = JSON.stringify(value);
    if (!json) return String(value);
    return json.length > maxLen ? `${json.slice(0, maxLen)}...` : json;
  } catch {
    const fallback = String(value);
    return fallback.length > maxLen ? `${fallback.slice(0, maxLen)}...` : fallback;
  }
}

function parseEnvLogLevel(): LogLevel | undefined {
  const raw =
    process.env.TOOLHUB_LOG_LEVEL ??
    process.env.TOOLHUB_DEBUG ??
    process.env.DEBUG;

  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value || value === "0" || value === "false" || value === "off") {
    return "silent";
  }
  if (value.includes("trace")) return "trace";
  if (value.includes("debug") || value === "1" || value === "true" || value === "yes") {
    return "debug";
  }
  if (value.includes("info")) return "info";
  if (value.includes("warn")) return "warn";
  if (value.includes("error")) return "error";
  if (value.includes("silent")) return "silent";
  return "debug";
}
