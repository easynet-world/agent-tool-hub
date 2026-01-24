---
name: filesystem-skill
description: Perform filesystem CRUD and metadata operations (read, write, list, stat, exists, mkdir, delete, copy, move).
---

# Filesystem (Skill)

## Quick start

```json
{
  "operation": "list",
  "path": "/tmp"
}
```

## Behavior

- `read`: reads a UTF-8 file and returns the content.
- `write`: writes UTF-8 content to a file. Optional `ensureDir` creates parent directories.
- `list`: lists directory entries with type information. Optional `recursive` includes nested entries.
- `stat`: returns basic metadata (size, mtimeMs, isFile, isDirectory).
- `exists`: returns whether a path exists.
- `mkdir`: creates a directory (default `recursive=true`).
- `delete`: deletes a file or directory (default `recursive=true`).
- `copy`: copies a file to `target` (optional `ensureDir`).
- `move`: moves a file to `target` (optional `ensureDir`).

## Output

```json
{
  "operation": "read | write | list | stat | exists | mkdir | delete | copy | move",
  "path": "string",
  "content": "string",
  "target": "string",
  "exists": true,
  "recursive": true,
  "stat": {
    "size": 123,
    "mtimeMs": 1700000000000,
    "isFile": true,
    "isDirectory": false
  },
  "items": [
    { "name": "string", "type": "file | directory", "path": "string" }
  ]
}
```
