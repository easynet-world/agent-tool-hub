import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Slack Notification tool using LangChain's StructuredTool interface.
 * Sends messages to Slack channels via Slack Web API.
 */
class SlackNotifyTool extends StructuredTool {
  name = "slack_notify";
  description = "Send a notification message to a Slack channel";

  schema = z.object({
    channel: z.string().describe("Slack channel name (e.g. '#general')"),
    message: z.string().describe("Message text to send"),
  });

  constructor(fields = {}) {
    super(fields);
    this.token = fields.token ?? process.env.SLACK_BOT_TOKEN;
  }

  async _call({ channel, message }) {
    if (!this.token) {
      throw new Error("SLACK_BOT_TOKEN is required");
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        channel,
        text: message,
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack API HTTP error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return JSON.stringify({
      ok: true,
      channel: data.channel,
      ts: data.ts,
    });
  }
}

export default new SlackNotifyTool();
