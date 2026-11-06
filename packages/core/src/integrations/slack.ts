import { config } from "../config";

export const slackConfigured = () => Boolean(config.SLACK_BOT_TOKEN);

type SlackResponse = {
  ok: boolean;
  error?: string;
  response_metadata?: { messages?: string[] };
};

async function slack<T extends SlackResponse>(
  method: string,
  body: Record<string, string> = {},
  requestMethod: "GET" | "POST" = "POST",
): Promise<T> {
  const url = new URL(`https://slack.com/api/${method}`);
  if (requestMethod === "GET") {
    for (const [key, value] of Object.entries(body))
      url.searchParams.set(key, value);
  }
  const res = await fetch(url, {
    method: requestMethod,
    headers: {
      Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
      ...(requestMethod === "POST"
        ? { "Content-Type": "application/json; charset=utf-8" }
        : {}),
    },
    ...(requestMethod === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json()) as T;
  if (!data.ok) {
    const details = data.response_metadata?.messages?.join("; ");
    throw new Error(
      `Slack ${method} error: ${data.error}${details ? ` (${details})` : ""}`,
    );
  }
  return data;
}

export async function slackTest() {
  if (!slackConfigured())
    return { configured: false, message: "Mock mode: set SLACK_BOT_TOKEN" };
  const r = await slack<{ ok: boolean; team: string; user: string }>(
    "auth.test",
  );
  return { configured: true, message: `Connected to ${r.team} as ${r.user}` };
}

export async function postMessage(a: {
  text: string;
  channel?: string;
  recipientEmail?: string;
}) {
  if (a.channel && a.recipientEmail)
    throw new Error(
      "Choose either a Slack channel or a recipient email, not both.",
    );
  const channel = a.channel || config.SLACK_DEFAULT_CHANNEL_ID;
  if (!a.recipientEmail && !channel)
    throw new Error(
      "Provide a recipient email or configure SLACK_DEFAULT_CHANNEL_ID.",
    );
  if (!slackConfigured()) {
    return a.recipientEmail
      ? { mock: true, recipientEmail: a.recipientEmail, text: a.text }
      : { mock: true, channel, text: a.text };
  }

  const destination = a.recipientEmail
    ? (
        await slack<{ ok: boolean; user: { id: string; deleted?: boolean } }>(
          "users.lookupByEmail",
          {
            email: a.recipientEmail.trim().toLowerCase(),
          },
          "GET",
        )
      ).user
    : undefined;
  if (destination?.deleted)
    throw new Error("The Slack user for that email is deactivated.");

  const r = await slack<{ ok: boolean; ts: string; channel: string }>(
    "chat.postMessage",
    {
      channel: destination?.id ?? channel,
      text: a.text,
    },
  );
  return {
    channel: r.channel,
    ts: r.ts,
    ...(a.recipientEmail ? { recipientEmail: a.recipientEmail } : {}),
  };
}
