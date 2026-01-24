// === Types ===
export type {
  ToolKind,
  Capability,
  CostHints,
  ToolSpec,
  ToolAdapter,
} from "./types/ToolSpec.js";

export type {
  BudgetConfig,
  ExecContext,
  ToolIntent,
} from "./types/ToolIntent.js";

export type {
  Evidence,
  ToolError,
  ToolResult,
} from "./types/ToolResult.js";

export type {
  ToolEventType,
  ToolEvent,
  ToolCalledEvent,
  ToolResultEvent,
  PolicyDeniedEvent,
  RetryEvent,
  JobSubmittedEvent,
  JobCompletedEvent,
  JobFailedEvent,
  AnyToolEvent,
} from "./types/Events.js";

// === Core ===
export { PTCRuntime } from "./core/PTCRuntime.js";
export type { PTCRuntimeConfig } from "./core/PTCRuntime.js";
export { PolicyEngine, PolicyDeniedError } from "./core/PolicyEngine.js";
export type { PolicyConfig, PolicyCheckResult } from "./core/PolicyEngine.js";
export { SchemaValidator, SchemaValidationError } from "./core/SchemaValidator.js";
export type { ValidationResult } from "./core/SchemaValidator.js";
export { BudgetManager } from "./core/Budget.js";
export type { BudgetOptions } from "./core/Budget.js";
export { withRetry, isRetryable, createTaggedError } from "./core/Retry.js";
export type { RetryOptions } from "./core/Retry.js";
export { buildEvidence } from "./core/Evidence.js";
export type { BuildEvidenceOptions } from "./core/Evidence.js";

// === Registry ===
export { ToolRegistry } from "./registry/ToolRegistry.js";
export type { ToolSearchQuery } from "./registry/ToolRegistry.js";
export { Discovery } from "./registry/Discovery.js";
export type { DiscoverySource } from "./registry/Discovery.js";

// === Jobs ===
export { AsyncJobManager, InMemoryJobStore } from "./jobs/AsyncJobManager.js";
export type {
  Job,
  JobStatus,
  JobStore,
  SubmitJobOptions,
} from "./jobs/AsyncJobManager.js";

// === Observability ===
export { EventLog } from "./observability/EventLog.js";
export type { LogEntry, EventListener } from "./observability/EventLog.js";
export { createLogger, sanitizeForLog, summarizeForLog } from "./observability/Logger.js";
export type {
  Logger,
  LogLevel,
  DebugOptions,
  ResolvedDebugOptions,
} from "./observability/Logger.js";
export { Metrics } from "./observability/Metrics.js";
export type { CounterValue, HistogramValue } from "./observability/Metrics.js";
export { Tracing } from "./observability/Tracing.js";
export type { Span, SpanEvent } from "./observability/Tracing.js";

// === Adapters ===
export { LangChainAdapter } from "./adapters/LangChainAdapter.js";
export type {
  LangChainToolLike,
  LangChainAdapterOptions,
} from "./adapters/LangChainAdapter.js";
export { MCPAdapter } from "./adapters/MCPAdapter.js";
export type {
  MCPClientLike,
  MCPAdapterOptions,
  MCPToolDefinition,
  MCPCallResult,
} from "./adapters/MCPAdapter.js";
export { N8nAdapter } from "./adapters/N8nAdapter.js";
export type {
  HttpClient,
  N8nAdapterOptions,
  N8nInvokeMode,
} from "./adapters/N8nAdapter.js";
export { N8nLocalAdapter } from "./adapters/N8nLocalAdapter.js";
export type { N8nLocalAdapterOptions } from "./adapters/N8nLocalAdapter.js";
export { ComfyUIAdapter } from "./adapters/ComfyUIAdapter.js";
export type {
  ComfyUIHttpClient,
  ComfyUIAdapterOptions,
  ComfyUIQueueResponse,
  ComfyUIHistoryEntry,
} from "./adapters/ComfyUIAdapter.js";
export { SkillAdapter } from "./adapters/SkillAdapter.js";
export type {
  SkillHandler,
  SkillContext,
  SkillInvocationContext,
  SkillOutput,
  SkillInstructionResult,
  SkillAdapterOptions,
} from "./adapters/SkillAdapter.js";

// === Skill Definition (SKILL.md spec) ===
export type {
  SkillFrontmatter,
  SkillResource,
  SkillDefinition,
} from "./discovery/loaders/SkillManifest.js";
export {
  SkillManifestError,
  validateFrontmatter,
} from "./discovery/loaders/SkillManifest.js";
export {
  parseSkillMd,
  scanSkillResources,
  loadSkillDefinition,
} from "./discovery/loaders/SkillMdParser.js";

// === Core Tools ===
export { CoreAdapter } from "./core-tools/CoreAdapter.js";
export { registerCoreTools } from "./core-tools/CoreToolsModule.js";
export type { CoreToolsUserConfig } from "./core-tools/CoreToolsModule.js";
export type {
  CoreToolsConfig,
  CoreToolHandler,
  CoreToolContext,
  CoreToolResult,
} from "./core-tools/types.js";
export { DEFAULT_CORE_TOOLS_CONFIG } from "./core-tools/types.js";
export { resolveSandboxedPath } from "./core-tools/security/sandbox.js";
export { validateUrl, isIpInBlockedCidrs } from "./core-tools/security/ssrf.js";

// Core tool specs (for selective registration)
export { readTextSpec } from "./core-tools/fs/readText.js";
export { writeTextSpec } from "./core-tools/fs/writeText.js";
export { listDirSpec } from "./core-tools/fs/listDir.js";
export { searchTextSpec } from "./core-tools/fs/searchText.js";
export { sha256Spec } from "./core-tools/fs/sha256.js";
export { deletePathSpec } from "./core-tools/fs/deletePath.js";
export { fetchTextSpec } from "./core-tools/http/fetchText.js";
export { fetchJsonSpec } from "./core-tools/http/fetchJson.js";
export { downloadFileSpec } from "./core-tools/http/downloadFile.js";
export { headSpec } from "./core-tools/http/head.js";
export { jsonSelectSpec } from "./core-tools/util/jsonSelect.js";
export { truncateSpec } from "./core-tools/util/truncate.js";
export { hashTextSpec } from "./core-tools/util/hashText.js";
export { nowSpec } from "./core-tools/util/now.js";
export { templateRenderSpec } from "./core-tools/util/templateRender.js";

// === Directory Discovery ===
export { DirectoryScanner } from "./discovery/DirectoryScanner.js";
export {
  DirectoryToolAdapter,
  createDirectoryDiscoverySource,
} from "./discovery/DirectoryDiscoverySource.js";
export type { DirectoryDiscoveryOptions } from "./discovery/DirectoryDiscoverySource.js";
export { MCPProcessManager } from "./discovery/MCPProcessManager.js";
export type { MCPConnectionInfo } from "./discovery/MCPProcessManager.js";
export { DiscoveryError } from "./discovery/errors.js";
export type {
  ToolManifest,
  MCPServerConfig,
  DirectoryScannerOptions,
  DiscoverableKind,
  LoadedTool,
} from "./discovery/types.js";

// === ToolHub (high-level facade) ===
export { ToolHub, createToolHub } from "./tool-hub/ToolHub.js";
export type {
  ToolMetadata,
  ToolDescription,
  ToolHubInitOptions,
  InvokeOptions,
} from "./tool-hub/ToolHub.js";
export { createToolHubAndInitFromConfig } from "./toolhub-runtime.js";
export { createAgentToolHub } from "./toolhub-runtime.js";
export {
  loadToolHubConfig,
  mapToolHubConfig,
} from "./config/ToolHubConfig.js";
export type { ToolHubConfigLoadResult } from "./config/ToolHubConfig.js";
