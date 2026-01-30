---
name: instruction-only-skill
description: Instruction-only skill with no handler. Returns SKILL.md content for the agent to consume; use when the agent should follow written instructions instead of calling code.
license: MIT
---

# Instruction-Only Skill (Level 2)

This skill has **no handler** — it demonstrates **instruction-only mode**. When invoked, the agent receives this body and the resource list; no programmatic code runs.

## When to use

- The task is best done by the agent following written steps.
- No bundled script is needed; instructions are sufficient.

## Steps (example)

1. Read the user request.
2. Follow the instructions in this SKILL.md.
3. Return a structured response.

## Progressive disclosure

- **Level 1**: name + description (loaded at startup).
- **Level 2**: This body (loaded when skill is activated).
- **Level 3**: No bundled files in this example; handlers can use `readResource(relativePath)` and `getResourcesByType(type)` when present.
