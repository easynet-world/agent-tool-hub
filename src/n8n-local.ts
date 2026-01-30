/**
 * n8n-local adapter entry. Import from "@easynet/agent-tool-hub/n8n-local" to avoid
 * loading @easynet/n8n-local when using the main package (e.g. in CI/test without n8n).
 */
export { N8nLocalAdapter } from "./adapters/N8nLocalAdapter.js";
export type {
  N8nLocalAdapterOptions,
  N8nLocalInstance,
} from "./adapters/N8nLocalAdapter.js";
