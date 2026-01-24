---
name: code-review
description: Reviews code for quality issues, style violations, and potential bugs. Use when the user asks for a code review, wants feedback on code quality, or needs to check code before committing.
---

# Code Review

## Quick start

Provide code and an optional language identifier to receive a structured review.

```json
{
  "code": "function add(a, b) { console.log(a+b); return a + b; }",
  "language": "javascript"
}
```

## Review process

1. Analyze code structure and length
2. Check for common anti-patterns (debug statements, overly long functions)
3. Calculate a quality score (1-10)
4. Return structured feedback with issues list

## Output format

The review produces:
- `language`: Detected or specified language
- `linesOfCode`: Line count
- `issues`: Array of issue descriptions
- `score`: Quality score from 1 (poor) to 10 (excellent)

## Advanced patterns

For language-specific rules, see [RULES.md](RULES.md).
