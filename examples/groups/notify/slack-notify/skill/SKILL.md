---
name: slack-notify-skill
description: Send a notification message to a Slack channel via Slack Web API.
---

# Slack Notify (Skill)

## Quick start

```json
{
  "channel": "#general",
  "message": "Deploy finished"
}
```

## Requirements

- Set `SLACK_BOT_TOKEN` in the environment.

## Behavior

- Sends a message to the specified Slack channel.
- Returns the channel ID and message timestamp.

## Output

```json
{
  "channel": "string",
  "ts": "string"
}
```
