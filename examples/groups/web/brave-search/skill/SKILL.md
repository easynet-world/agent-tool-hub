---
name: brave-search-skill
description: Search the web via Brave Search API and return structured results.
---

# Brave Search (Skill)

## Quick start

```json
{
  "query": "latest TypeScript release",
  "count": 5
}
```

## Requirements

- Set `BRAVE_API_KEY` in the environment for API access.

## Behavior

- Performs a Brave Search API request.
- Returns a structured list of results with title, url, and description.

## Output

```json
{
  "query": "string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "description": "string"
    }
  ]
}
```
