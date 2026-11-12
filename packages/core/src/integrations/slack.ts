import { config } from "../config";

export const slackConfigured = () => Boolean(config.SLACK_BOT_TOKEN);

type SlackResponse = {
  ok: boolean;
  error?: string;
  response_metadata?: { messages?: string[]; next_cursor?: string };
};

type SlackUser = {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  profile?: { display_name?: string; real_name?: string };
};

type Recipient = { id: string; name: string; username?: string };

export type SlackMessageArgs = {
  text: string;
  channel?: string;
  recipientEmail?: string;
  recipientName?: string;
  recipientId?: string;
  recipientDisplayName?: string;
};

function requireSlack() {
  if (!slackConfigured()) throw new Error("Slack is not configured. Set SLACK_BOT_TOKEN and restart the API.");
}

async function slack<T extends SlackResponse>(
  method: string,
  body: Record<string, string> = {},
  requestMethod: "GET" | "POST" = "POST",
): Promise<T> {
  requireSlack();
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
  if (!res.ok) throw new Error(`Slack ${method} HTTP error: ${res.status}`);
  const data = (await res.json()) as T;
  if (!data.ok) {
    const details = data.response_metadata?.messages?.join("; ");
    throw new Error(
      `Slack ${method} error: ${data.error}${details ? ` (${details})` : ""}`,
    );
  }
  return data;
}

function recipient(user: SlackUser | undefined): Recipient {
  if (!user?.id || !/^[UW][A-Z0-9]+$/.test(user.id))
    throw new Error("Slack returned an invalid user.");
  if (user.deleted || user.is_bot || user.is_app_user || user.id === "USLACKBOT")
    throw new Error("The Slack recipient is inactive or is not a human user.");
  return {
    id: user.id,
    name: user.profile?.real_name || user.real_name || user.profile?.display_name || user.name || user.id,
    ...(user.name ? { username: user.name } : {}),
  };
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export async function findSlackUsers(query: string) {
  requireSlack();
  const term = normalize(query.replace(/^@/, ""));
  if (!term) throw new Error("Enter a Slack user name to search.");
  const exact: Recipient[] = [];
  const partial: Recipient[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";
  do {
    const page = await slack<SlackResponse & { members: SlackUser[] }>(
      "users.list", { limit: "200", ...(cursor ? { cursor } : {}) }, "GET",
    );
    if (!Array.isArray(page.members)) throw new Error("Slack returned an invalid user directory.");
    for (const user of page.members) {
      if (user.deleted || user.is_bot || user.is_app_user || user.id === "USLACKBOT") continue;
      const names = [user.name, user.real_name, user.profile?.real_name, user.profile?.display_name]
        .filter((name): name is string => Boolean(name))
        .map(normalize);
      if (names.includes(term)) exact.push(recipient(user));
      else if (names.some((name) => name.includes(term))) partial.push(recipient(user));
    }
    cursor = page.response_metadata?.next_cursor?.trim() || "";
    if (cursor && seenCursors.has(cursor)) throw new Error("Slack returned a repeated directory page.");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  const matches = exact.length ? exact : partial;
  return { matches: matches.slice(0, 20), total: matches.length };
}

async function resolveSlackUser(args: SlackMessageArgs): Promise<Recipient> {
  if (args.recipientId) {
    const response = await slack<SlackResponse & { user: SlackUser }>(
      "users.info", { user: args.recipientId }, "GET",
    );
    const user = recipient(response.user);
    if (user.id !== args.recipientId) throw new Error("Slack returned a different user than requested.");
    return user;
  }
  if (args.recipientEmail) {
    const response = await slack<SlackResponse & { user: SlackUser }>(
      "users.lookupByEmail", { email: args.recipientEmail.trim().toLowerCase() }, "GET",
    );
    return recipient(response.user);
  }
  const result = await findSlackUsers(args.recipientName!);
  if (!result.total) throw new Error(`No Slack user matched "${args.recipientName}". Ask for their email or Slack username.`);
  if (result.total !== 1) {
    const options = result.matches.map((user) => `${user.name}${user.username ? ` (@${user.username})` : ""} [${user.id}]`).join(", ");
    throw new Error(`Multiple Slack users matched "${args.recipientName}" (${result.total} matches): ${options}. Ask the user to choose before sending.`);
  }
  return result.matches[0];
}

export async function prepareSlackMessage(args: SlackMessageArgs) {
  const destinations = [args.channel, args.recipientEmail, args.recipientName, args.recipientId].filter(Boolean);
  if (destinations.length !== 1)
    throw new Error("Provide exactly one Slack channel, recipient name, email, or user ID. Never use a default channel for an unspecified recipient.");
  requireSlack();
  if (args.channel) return { text: args.text, channel: args.channel };
  const user = await resolveSlackUser(args);
  return { text: args.text, recipientId: user.id, recipientDisplayName: user.name, ...(user.username ? { recipientUsername: user.username } : {}) };
}

export async function slackTest() {
  if (!slackConfigured())
    return { configured: false, message: "Set SLACK_BOT_TOKEN" };
  const r = await slack<{ ok: boolean; team: string; user: string }>("auth.test");
  return { configured: true, message: `Connected to ${r.team} as ${r.user}` };
}

export async function postMessage(args: SlackMessageArgs) {
  const prepared = await prepareSlackMessage(args);
  const isDirectMessage = "recipientId" in prepared;
  const r = await slack<{ ok: boolean; ts: string; channel: string }>(
    "chat.postMessage",
    { channel: isDirectMessage ? prepared.recipientId : prepared.channel, text: prepared.text },
  );
  if (!r.channel || !r.ts) throw new Error("Slack returned an incomplete message response; check Slack before retrying.");
  return {
    channel: r.channel,
    ts: r.ts,
    ...(isDirectMessage ? {
      recipientId: prepared.recipientId,
      recipientName: prepared.recipientDisplayName,
      ...(prepared.recipientUsername ? { recipientUsername: prepared.recipientUsername } : {}),
    } : {}),
  };
}
