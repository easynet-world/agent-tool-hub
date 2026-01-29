---
name: system-time-skill
description: Get current system time and timezone (same shape as core/util.time.now).
---

# System Time (Skill)

## Quick start

```json
{}
```

Or with options:

```json
{
  "format": "locale",
  "timezone": "Asia/Shanghai"
}
```

## Behavior

- Returns iso (ISO 8601), epochMs, timezone (IANA), formatted string.
- Same return shape as core/util.time.now.

## Output

```json
{
  "iso": "string",
  "epochMs": "number",
  "timezone": "string",
  "formatted": "string"
}
```
