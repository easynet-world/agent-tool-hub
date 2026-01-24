# tool-hub 内置通用工具（Core Tools）设计书：Filesystem / HTTP / Utils

> 面向：Node.js / TypeScript 工程师  
> 目标：在 **tool-hub** 中提供一组“开箱即用、稳定、安全、可审计”的通用工具（core tools），供 **agent-orchestra** 或任意上层 agent 通过 PTC Runtime 调用。  
> 版本：v1.0  
> 日期：2026-01-23 (America/Los_Angeles)

---

## 1. 背景与目标

你希望在 `tool-hub` 内置一些最常用的基础工具，例如：

- Filesystem（读写文件、目录、列举、搜索、hash 等）
- HTTP Access（GET/POST、抓取网页/API、下载文件）
- 以及一些通用工具（JSON 操作、模板渲染、缓存、时间、压缩等）

这些工具必须满足：

1. **可控**：所有调用都走 PTC Runtime（schema 校验、策略 gate、预算、重试、审计）
2. **安全**：路径沙盒、域名 allowlist、禁危险参数、输出脱敏
3. **稳定**：超时、重试、幂等、限流、断路器、明确错误码
4. **可组合**：工具之间可用于构建更高级 workflow（如 fetch → parse → write）
5. **可观测**：每次调用输出 evidence，且记录事件日志/指标

---

## 2. 范围与非目标

### 2.1 范围（In scope）
- Core tools 的 **ToolSpec 定义**（name/schema/capabilities）
- Core tools 的 **实现策略**（adapters、policy、defaults）
- Core tools 的 **安全边界**（sandbox、allowlist、限制）
- Async/Streaming 场景的处理方式（可选）

### 2.2 非目标（Out of scope）
- 浏览器级渲染（Playwright/Puppeteer）——可后续作为扩展工具
- 复杂 HTML DOM 解析器（可作为可选 tool）
- 企业级鉴权体系（这里提供 hook/接口，具体集成由应用做）

---

## 3. 总体架构（tool-hub 内）

```mermaid
flowchart TB
  AO[agent-orchestra / caller] -->|ToolIntent| PTC[PTC Runtime]
  PTC --> REG[Registry: core tools pre-registered]
  PTC --> POL[Policy Engine]
  PTC --> OBS[Audit/Event/Metrics]
  PTC --> CORE[Core Tools Adapter (local)]
  CORE --> FS[Filesystem Impl]
  CORE --> HTTP[HTTP Impl]
  CORE --> UTIL[Utils Impl]
```

说明：Core tools 作为 `kind="langchain"` 或 `kind="skill"` 的本地实现都可以；推荐在 tool-hub 内引入一个 `core` adapter（本地函数工具适配器），避免依赖 LangChain 类型。

---

## 4. 命名规范（强烈建议）

- 统一 namespace：`core/*`
- 示例：`core/fs.readText`、`core/http.fetchJson`
- 工具名用动词：read/write/list/fetch/download/sha256
- 工具输出尽量结构化 JSON，不直接返回超大文本（大文本写文件，返回 file ref）

---

## 5. 通用能力（Capabilities）与策略

建议 capability 枚举（与 tool-hub 设计一致）：

- `read:fs` / `write:fs`
- `network`
- `danger:destructive`（删除、覆盖、递归写等）

### 5.1 默认策略（Policy Defaults）
- `write:fs` 仅允许写入 `sandboxRoot` 下路径
- `core/fs.delete*` 默认标记 `danger:destructive`，需要显式授权
- `core/http.*` 仅允许访问 `allowedHosts`（或按环境配置）
- 禁止访问内网保留地址（127.0.0.1、169.254.*、10.*、192.168.*、172.16-31.*）除非明确允许（SSRF 防护）

---

## 6. Core Tools：Filesystem

### 6.1 运行时约束
- **Sandbox Root**：例如 `/var/tool-hub/sandbox/<requestId>/`
- 路径规范化：`realpath` 后必须以 sandboxRoot 开头
- 文件大小限制：读取单文件默认 ≤ 5MB（可配置）
- 写入限制：默认禁止覆盖（可 `overwrite=true`，但需要更高权限或策略允许）
- 自动创建父目录：默认 `mkdirp=true`

### 6.2 工具清单（建议第一批）

#### 6.2.1 `core/fs.readText`
- 能力：`read:fs`
- 用途：读取 UTF-8 文本文件
- 输入 schema：
```json
{
  "type": "object",
  "properties": {
    "path": {"type":"string"},
    "maxBytes": {"type":"integer","minimum":1024,"maximum":10485760}
  },
  "required": ["path"],
  "additionalProperties": false
}
```
- 输出 schema：
```json
{
  "type":"object",
  "properties":{
    "path":{"type":"string"},
    "text":{"type":"string"},
    "bytes":{"type":"integer"}
  },
  "required":["path","text","bytes"],
  "additionalProperties":false
}
```
- 默认：`maxBytes=5MB`
- Evidence：`type=file` + 摘要（文件大小、前 N 行 hash）

#### 6.2.2 `core/fs.writeText`
- 能力：`write:fs`
- 用途：写入 UTF-8 文本文件（推荐用于“长内容外置”）
- 输入：
```json
{
  "type":"object",
  "properties":{
    "path":{"type":"string"},
    "text":{"type":"string"},
    "overwrite":{"type":"boolean"},
    "mkdirp":{"type":"boolean"}
  },
  "required":["path","text"],
  "additionalProperties":false
}
```
- 输出：
```json
{
  "type":"object",
  "properties":{
    "path":{"type":"string"},
    "bytes":{"type":"integer"},
    "sha256":{"type":"string"}
  },
  "required":["path","bytes","sha256"],
  "additionalProperties":false
}
```
- 默认：`overwrite=false, mkdirp=true`
- Policy：若 overwrite=true，可要求额外 capability 或策略允许

#### 6.2.3 `core/fs.listDir`
- 能力：`read:fs`
- 用途：列出目录（可限制深度）
- 输入：
```json
{
  "type":"object",
  "properties":{
    "path":{"type":"string"},
    "maxEntries":{"type":"integer","minimum":1,"maximum":5000},
    "includeHidden":{"type":"boolean"},
    "recursive":{"type":"boolean"},
    "maxDepth":{"type":"integer","minimum":1,"maximum":10}
  },
  "required":["path"],
  "additionalProperties":false
}
```
- 输出：entries（name/type/size/mtime）
- 默认：`recursive=false, maxEntries=2000, includeHidden=false`

#### 6.2.4 `core/fs.searchText`
- 能力：`read:fs`
- 用途：在目录内搜索关键字（用于日志/代码快速查找）
- 输入：
```json
{
  "type":"object",
  "properties":{
    "root":{"type":"string"},
    "query":{"type":"string"},
    "glob":{"type":"string"},
    "maxMatches":{"type":"integer","minimum":1,"maximum":5000},
    "maxFiles":{"type":"integer","minimum":1,"maximum":2000}
  },
  "required":["root","query"],
  "additionalProperties":false
}
```
- 输出：matches（file,lineNo,excerpt）
- 默认：`glob="**/*.{md,txt,log,json,ts,js,py,java,scala}"`

#### 6.2.5 `core/fs.sha256`
- 能力：`read:fs`
- 用途：计算文件 hash（用于证据、幂等）
- 输入：`path`
- 输出：`sha256`, `bytes`

#### 6.2.6 `core/fs.deletePath`（危险）
- 能力：`danger:destructive` + `write:fs`
- 用途：删除文件/目录（默认禁止）
- 需显式 `confirm=true`（二阶段提交），并在 Policy Engine 中强制检查

---

## 7. Core Tools：HTTP Access

### 7.1 运行时约束（安全关键）
- SSRF 防护：默认禁止私网/本机/metadata（169.254.169.254）
- 域名 allowlist：`allowedHosts`（支持通配符，如 `*.github.com`）
- 超时：默认 `timeoutMs=15000`
- 重试：默认对 GET/HEAD 重试 2 次；对非幂等 POST 默认不重试（除非 `idempotencyKey` 且策略允许）
- 响应大小限制：默认 ≤ 5MB（超出则截断或存文件）

### 7.2 工具清单（建议第一批）

#### 7.2.1 `core/http.fetchText`
- 能力：`network`
- 输入：
```json
{
  "type":"object",
  "properties":{
    "url":{"type":"string","format":"uri"},
    "method":{"type":"string","enum":["GET","POST"]},
    "headers":{"type":"object","additionalProperties":{"type":"string"}},
    "body":{"type":["string","null"]},
    "timeoutMs":{"type":"integer","minimum":1000,"maximum":60000},
    "maxBytes":{"type":"integer","minimum":1024,"maximum":10485760}
  },
  "required":["url"],
  "additionalProperties":false
}
```
- 输出：
```json
{
  "type":"object",
  "properties":{
    "url":{"type":"string"},
    "status":{"type":"integer"},
    "headers":{"type":"object","additionalProperties":{"type":"string"}},
    "text":{"type":"string"},
    "bytes":{"type":"integer"}
  },
  "required":["url","status","text","bytes"],
  "additionalProperties":false
}
```
- 默认：`method=GET, timeoutMs=15000, maxBytes=5MB`
- Policy：对 POST 默认要求显式允许/或限制域名

#### 7.2.2 `core/http.fetchJson`
- 能力：`network`
- 输入同 fetchText，但要求响应 `content-type` 为 JSON（或可容忍）
- 输出：`json`（object/array）+ `status`
- 输出校验：如果无法 parse，返回 `UPSTREAM_ERROR`（可包含原文本摘要）

#### 7.2.3 `core/http.downloadFile`
- 能力：`network` + `write:fs`
- 输入：
```json
{
  "type":"object",
  "properties":{
    "url":{"type":"string","format":"uri"},
    "destPath":{"type":"string"},
    "timeoutMs":{"type":"integer","minimum":1000,"maximum":120000},
    "maxBytes":{"type":"integer","minimum":1024,"maximum":104857600},
    "overwrite":{"type":"boolean"}
  },
  "required":["url","destPath"],
  "additionalProperties":false
}
```
- 输出：`destPath`, `bytes`, `sha256`
- Policy：destPath 必须在 sandbox；overwrite 默认 false

#### 7.2.4 `core/http.head`
- 能力：`network`
- 用途：获取 headers（content-length、etag 等），用于预算判断与缓存
- 输出：`status`, `headers`

---

## 8. Core Tools：Utils（通用工具）

这些工具不产生外部副作用，能力可为空或使用 `read:*`。

建议第一批：

### 8.1 `core/util.json.select`
- 用途：从 JSON 中按 JSONPath/JMESPath 选取字段（减少上层模型 token）
- 输入：`json`, `path`
- 输出：`value`

### 8.2 `core/util.text.truncate`
- 用途：按字节/字符截断文本并添加标记
- 输入：`text`, `maxChars`
- 输出：`text`

### 8.3 `core/util.hash.sha256Text`
- 用途：对文本 hash（证据/去重）
- 输入：`text`
- 输出：`sha256`

### 8.4 `core/util.time.now`
- 输出：ISO 时间、epoch ms、timezone

### 8.5 `core/util.template.render`
- 用途：Mustache/Handlebars 渲染（写 markdown/report）
- 输入：`template`, `data`
- 输出：`text`

> 这些工具最好限制输出大小（maxBytes/maxChars），超出则建议写文件通过 fs.writeText。

---

## 9. PTC Runtime 对 Core Tools 的特殊默认值（建议）

### 9.1 默认值补全（不交给 LLM）
- `timeoutMs`
- `maxBytes`
- `overwrite=false`
- `mkdirp=true`
- `maxRetries`（GET 可重试，POST 需策略）
- `idempotencyKey`（由调用方或 tool-hub 自动生成：requestId+taskId+toolName+hash(args)）

### 9.2 输出裁剪与“长内容外置”
- `http.fetchText` 返回 text 超过阈值：
  - 方案 A：截断 + 提示（推荐）
  - 方案 B：自动写入 `core/fs.writeText` 产生文件，然后返回 `fileRef`（可选增强）
- `fs.readText` 同理：超大文件只返回摘要 + hash + 指针

---

## 10. Evidence（证据）规范

Core tools 每次调用必须返回 evidence（至少 1 条），建议：

- `fs.writeText`：`file` evidence，ref=path，summary=bytes+sha256
- `http.fetchJson`：`tool` evidence，ref=toolCallId，summary=status+关键字段摘要
- `http.downloadFile`：`file` evidence，ref=destPath，summary=bytes+sha256+sourceUrl

证据摘要不要包含敏感信息（token、cookie、authorization）。

---

## 11. 错误模型（与 tool-hub 统一）

建议错误 kind：

- `INPUT_SCHEMA_INVALID`
- `POLICY_DENIED`
- `PATH_OUTSIDE_SANDBOX`
- `FILE_TOO_LARGE`
- `HTTP_DISALLOWED_HOST`
- `HTTP_TIMEOUT`
- `HTTP_TOO_LARGE`
- `UPSTREAM_ERROR`
- `OUTPUT_SCHEMA_INVALID`

错误返回格式（ToolResult.error）需包含可修复细节（比如允许的 host 列表、最大字节数、需要的权限）。

---

## 12. 配置项（tool-hub 侧）

```ts
export interface CoreToolsConfig {
  sandboxRoot: string;                  // e.g. /var/tool-hub/sandbox
  maxReadBytes: number;                 // default 5MB
  maxHttpBytes: number;                 // default 5MB
  maxDownloadBytes: number;             // default 100MB
  allowedHosts: string[];               // e.g. ["api.github.com", "*.openai.com"]
  blockedCidrs: string[];               // default: private ranges
  defaultTimeoutMs: number;             // 15000
  httpUserAgent: string;                // tool-hub/<ver>
  enableAutoWriteLargeResponses?: boolean;
}
```

---

## 13. 目录结构（tool-hub 内建议）

```
packages/tool-hub/
  src/
    core/
      CoreToolsModule.ts          # 批量注册 core/* tools
      fs/
        readText.ts
        writeText.ts
        listDir.ts
        searchText.ts
        sha256.ts
        deletePath.ts             # dangerous
      http/
        fetchText.ts
        fetchJson.ts
        downloadFile.ts
        head.ts
      util/
        jsonSelect.ts
        truncate.ts
        hashText.ts
        now.ts
        templateRender.ts
    registry/
    coreRuntime/
      PTCRuntime.ts
      PolicyEngine.ts
      Evidence.ts
      SchemaValidator.ts
    adapters/
      LocalCoreAdapter.ts         # 调用 core 工具实现
    observability/
      EventLog.ts
      Metrics.ts
```

---

## 14. MVP 落地顺序（推荐）

1. Filesystem：`readText/writeText/listDir/sha256`
2. HTTP：`fetchText/fetchJson/head`（带 allowlist + SSRF 防护）
3. Download：`downloadFile`（写 sandbox + 大小限制）
4. Utils：`truncate/now/hashText/templateRender`
5. 高风险：`deletePath`（最后做，默认禁用）

---

## 15. 与 agent-orchestra 的最佳实践

- agent-orchestra 用 `fs.writeText` 做长内容外置（避免上下文膨胀）
- 用 `http.head` + `maxBytes` 先判断是否值得抓取
- 对不稳定网页抓取：先 `fetchText` → 再 `truncate` → 再写文件
- tool-hub 中强制输出 evidence，agent-orchestra 用 evidence 做 done_when 验收

---

# 结尾简要总结

本设计为 **tool-hub** 提供一组内置通用工具（`core/*`）：Filesystem、HTTP、Utils。核心是把安全与稳定性前置到 **PTC Runtime**：输入/输出 schema 校验、sandbox 路径限制、HTTP allowlist + SSRF 防护、超时重试与大小预算、幂等与审计、以及每次调用必须产出 evidence。这样上层 agent 只负责“何时调用/为何调用”，tool-hub 保证“怎么安全稳定地调用”，并能组合这些 core tools 构建更复杂的能力。
