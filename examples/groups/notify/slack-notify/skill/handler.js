/**
 * Slack Notify skill handler.
 */
async function handler(args) {
  const { channel, message } = args ?? {};

  if (!channel || typeof channel !== "string") {
    throw new Error("channel is required");
  }
  if (!message || typeof message !== "string") {
    throw new Error("message is required");
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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

  return {
    result: {
      channel: data.channel,
      ts: data.ts,
    },
    evidence: [
      {
        type: "text",
        ref: "slack-notify",
        summary: `Sent Slack message to ${channel}`,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export default handler;
