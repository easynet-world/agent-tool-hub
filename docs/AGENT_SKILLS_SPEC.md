# Agent Skills (Anthropic) — Spec Compliance

This document compares our implementation with the [official Agent Skills specification](https://agentskills.io/specification) (SKILL.md format).

## Reference

- **Spec**: [agentskills.io/specification](https://agentskills.io/specification)
- **Overview**: [skill.md](https://skill.md/) / [platform.claude.com Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

---

## What the spec defines and what we enforce

### Definition of the SKILL spec

The Agent Skills spec **defines the format** of a skill:

- **Structure**: A skill is a directory with at least `SKILL.md` (YAML frontmatter + Markdown body). Optional dirs: `scripts/`, `references/`, `assets/`.
- **Frontmatter**: Required `name` and `description`; optional `license`, `compatibility`, `metadata`, `allowed-tools`. The spec gives **constraints** (e.g. name length, pattern, no leading/trailing/consecutive hyphens; description length; compatibility length).
- **Progressive disclosure**: Level 1 (metadata), Level 2 (body), Level 3 (resources). How agents load and use these is described but not mandated in full.
- **Execution**: Instruction-only (return SKILL content) vs handler mode (run bundled code). The spec does not dictate how handlers are implemented.

So the spec is a **format + constraint** definition and a **recommended** usage model, not a strict runtime contract for every consumer.

### Do we have to enforce based on the spec?

**We enforce what makes us a compliant consumer of the format:**

| Area | Spec says | We enforce? | Why |
|------|-----------|-------------|-----|
| **Required frontmatter** | `name` and `description` required | ✅ Yes | Invalid skills must fail load; authors get clear errors. |
| **name constraints** | Max 64 chars; `[a-z0-9-]`; no leading/trailing/consecutive `-`; reserved words | ✅ Yes | Aligns with spec and avoids invalid names. |
| **description constraints** | Max 1024 chars; non-empty | ✅ Yes | Same as above. |
| **compatibility length** | Max 500 if present | ✅ Yes | Spec constraint. |
| **Optional fields** | license, compatibility, metadata, allowed-tools optional | ✅ Parse & store | We don’t *have* to enforce their *semantics* (see below). |
| **allowed-tools** | “Experimental. Support for this field **may vary between agent implementations**.” | ✅ Enforced when set | When a skill calls `invokeTool`, we only allow tools listed in its `allowed-tools` frontmatter (space-delimited). If omitted or empty, any tool is allowed. |
| **name = parent directory** | “Must match the parent directory name” | ❌ No | We skip this by design so skills can live in namespaced paths (e.g. `tools/foo/skill/`). |
| **metadata (nested)** | Optional key-value map | ⚠️ Type only | We don’t parse nested YAML yet; no enforcement. |

So: we **do** enforce format and required constraints (name, description, compatibility length) and **allowed-tools** when a skill invokes sub-tools. We **do not** enforce parent-dir name (we intentionally deviate for namespaced discovery).

---

## Supported Features

### 1. Directory structure

| Spec | Our support |
|------|-------------|
| Skill is a directory with at minimum `SKILL.md` | ✅ Required; discovery looks for `SKILL.md` (or `tool.json` with `kind: "skill"`). |
| Optional: `scripts/`, `references/`, `assets/` | ✅ Any layout supported. We scan the whole skill directory for Level 3 resources (no requirement for these folder names). |

### 2. SKILL.md format

| Spec | Our support |
|------|-------------|
| YAML frontmatter followed by Markdown body | ✅ Parsed by `SkillMdParser`; frontmatter required, body = Level 2 instructions. |

### 3. Frontmatter (Level 1)

| Field | Required | Spec constraints | Our support |
|-------|----------|------------------|-------------|
| **name** | Yes | Max 64 chars; lowercase letters, numbers, hyphens only; must not start/end with `-`; no consecutive `--`; match parent directory name | ✅ All except parent-dir match (see below). |
| **description** | Yes | Max 1024 chars; non-empty | ✅ |
| **license** | No | License name or reference | ✅ Parsed and stored in `SkillFrontmatter.license`. |
| **compatibility** | No | Max 500 chars; environment requirements | ✅ Parsed, stored, validated (max 500). |
| **metadata** | No | Arbitrary key-value map (string → string) | ⚠️ Type present (`SkillFrontmatter.metadata`); **nested YAML not parsed** (only flat key: value). |
| **allowed-tools** | No | Space-delimited list of pre-approved tools (experimental) | ✅ Parsed and stored; **enforced** when the skill calls `invokeTool`: only tools in this list may be invoked. If omitted or empty, any tool is allowed. |

**Name validation (aligned with spec):**

- Max 64 characters ✅  
- Pattern `[a-z0-9-]+` ✅  
- Must not start or end with hyphen ✅  
- Must not contain consecutive hyphens (`--`) ✅  
- Reserved words (`anthropic`, `claude`) rejected ✅  
- XML tags in name/description rejected ✅  

**Parent directory name:** The spec says the skill `name` should match the parent directory name. We do **not** enforce this so that skills can live in namespaced paths (e.g. `tools/yahoo-finance/skill/` with `name: yahoo-finance-skill` or discovery-derived names).

### 4. Body content (Level 2)

| Spec | Our support |
|------|-------------|
| Markdown body = skill instructions; no format restrictions | ✅ Stored as `SkillDefinition.instructions`; recommended &lt;5k tokens. |
| Step-by-step instructions, examples, edge cases | ✅ Content is opaque; we only store and expose it. |

### 5. Progressive disclosure

| Level | Spec | Our support |
|-------|------|-------------|
| **Level 1** | Metadata (~100 tokens) loaded at startup | ✅ `SkillDefinition.frontmatter`; used for discovery and tool spec name/description when no program override. |
| **Level 2** | Full SKILL.md body loaded when skill is activated | ✅ `SkillDefinition.instructions`; exposed via `SkillInvocationContext` and instruction-only mode. |
| **Level 3** | Resources (scripts, references, assets) loaded as needed | ✅ `SkillDefinition.resources`; scanned from skill dir; `readResource(relativePath)`, `getResourcesByType(type)`. |

### 6. Optional directories (scripts / references / assets)

| Spec | Our support |
|------|-------------|
| `scripts/`: executable code | ✅ Any file in the skill dir is a resource; type inferred by extension (e.g. `.py`, `.js` → code). |
| `references/`: e.g. REFERENCE.md, FORMS.md | ✅ Any file; `.md`/`.txt` → type `instructions`. |
| `assets/`: templates, images, data | ✅ Any file; other extensions → type `data`. |

We do not require these folder names; we scan the whole skill directory and infer resource types from extensions.

### 7. File references

| Spec | Our support |
|------|-------------|
| Reference other files by relative path from skill root | ✅ Handlers receive `SkillContext.skill.readResource(relativePath)` and `getResourcesByType(type)`. |

### 8. Execution model

| Spec | Our support |
|------|-------------|
| Instruction-only: agent receives SKILL.md content and resource list | ✅ When no handler is present, we return `SkillInstructionResult` (name, description, instructions, resources, dirPath). |
| Handler mode: bundled code runs with context | ✅ Function handler `(args, ctx: SkillContext)` or LangChain-like / class extending `StructuredTool`; context includes `skill` (Level 1–3), `readResource`, `getResourcesByType`, optional `invokeTool`. |

### 9. Extensions (beyond base spec)

- **Multiple programs per skill**: One skill dir can expose multiple tools (e.g. `index.js` or `handler.js` as default, `quote.js`, `chart.js`) via auto-discovery or `tool.json` `programs`. Each program can be a function, a LangChain-like object, or a class extending `StructuredTool`.
- **Self-describing tools**: Programs can export `StructuredTool` (or `{ name, description, schema, invoke }`) so name/description/schema come from the implementation instead of SKILL.md.

---

## Examples (where each feature is demonstrated)

| Spec area | Where demonstrated |
|-----------|--------------------|
| **Required frontmatter (name, description)** | Both: `examples/tools/yahoo-finance/skill/SKILL.md`, `examples/tools/instruction-only/skill/SKILL.md`. Name rules validated at load time. |
| **Optional frontmatter (license, compatibility, allowed-tools)** | `yahoo-finance/skill/SKILL.md`: `license: MIT`, `compatibility: ...` (no allowlist; can use any hub tools). Add `allowed-tools: tools/a tools/b` to restrict. `instruction-only/skill/SKILL.md`: `license: MIT`. |
| **Progressive disclosure (Level 1–3)** | Level 1: frontmatter in both. Level 2: body/instructions in both. Level 3: yahoo-finance has `references/REFERENCE.md` and `lib/yahoo-api.js`; instruction-only has no resources. |
| **Body = instructions** | Both: full Markdown body (Quick start, Behavior, Output in yahoo-finance; steps in instruction-only). |
| **Resources (scripts/references/assets)** | yahoo-finance: `references/REFERENCE.md` (optional dir), `lib/`, index/quote/chart programs. Any layout; types by extension. |
| **Instruction-only mode** | `examples/tools/instruction-only/skill/`: SKILL.md only, no handler; when invoked returns Level 2 + resource list. |
| **Handler mode + context** | yahoo-finance: index.js (default), quote.js, chart.js (StructuredTool); context has `readResource`, `getResourcesByType`, optional `invokeTool`. |
| **File references (relative paths)** | yahoo-finance body: "For API details see [references/REFERENCE.md](references/REFERENCE.md)". Handlers use `ctx.skill.readResource(relativePath)`. |

---

## Gaps / Limitations

1. **metadata (nested YAML)**  
   The spec allows `metadata: { author: "...", version: "..." }`. We only parse flat key-value frontmatter; nested `metadata` is not parsed. Workaround: use a single string value or add support for a small nested block later.

2. **Name must match parent directory**  
   We intentionally do not enforce that `name` equals the parent directory name, so that skills can live under namespaced discovery paths (e.g. `tools/foo/skill/`).

3. **Validation tooling**  
   The spec references `skills-ref validate ./my-skill`. We do not ship a CLI validator; our validation runs at load time (frontmatter and name rules).

---

## Summary

We support the core Agent Skills format: required and optional frontmatter (including `license`, `compatibility`, `allowed-tools`), strict name/description validation, progressive disclosure (Level 1–3), instruction-only and handler modes, and resource access. We **enforce** `allowed-tools` when a skill calls `invokeTool`: only tools listed in that frontmatter (space-delimited) may be invoked; if omitted or empty, any tool is allowed. Remaining gaps are nested `metadata` parsing and no parent-dir name check by design.
