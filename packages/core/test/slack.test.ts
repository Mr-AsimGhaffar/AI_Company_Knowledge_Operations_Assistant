import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { z } from "zod";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.SLACK_BOT_TOKEN = "test-token";
const { config } = await import("../src/config");
const { findSlackUsers, postMessage, prepareSlackMessage } = await import("../src/integrations/slack");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  config.SLACK_BOT_TOKEN = "test-token";
});

function mockSlack(responses: unknown[]) {
  const calls: { method: string; url: URL; body?: Record<string, string> }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? "GET",
      url,
      ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
    });
    assert.ok(responses.length, `Unexpected Slack request: ${url.pathname}`);
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return calls;
}

const asim = { id: "U123", name: "asim", profile: { real_name: "Asim Ghaffar" } };
const otherAsim = { id: "U456", name: "asim.g", profile: { real_name: "Asim Ghaffar" } };

test("searches all directory pages and excludes inactive and bot users", async () => {
  const calls = mockSlack([
    { ok: true, members: [{ ...asim, deleted: true }, { ...otherAsim, is_bot: true }], response_metadata: { next_cursor: "page2" } },
    { ok: true, members: [asim], response_metadata: { next_cursor: "" } },
  ]);
  assert.deepEqual(await findSlackUsers(" ASIM ghaffar "), {
    matches: [{ id: "U123", name: "Asim Ghaffar", username: "asim" }], total: 1,
  });
  assert.equal(calls[1].url.searchParams.get("cursor"), "page2");
});

test("prepares a named DM with the resolved identity before approval", async () => {
  mockSlack([{ ok: true, members: [asim] }]);
  assert.deepEqual(await prepareSlackMessage({ text: "Hello", recipientName: "Asim Ghaffar" }), {
    text: "Hello", recipientId: "U123", recipientDisplayName: "Asim Ghaffar", recipientUsername: "asim",
  });
});

test("ambiguous and missing names do not send or prepare a message", async () => {
  const calls = mockSlack([{ ok: true, members: [asim, otherAsim] }, { ok: true, members: [] }]);
  await assert.rejects(prepareSlackMessage({ text: "Hello", recipientName: "Asim Ghaffar" }), /Multiple Slack users matched.*U123.*U456/);
  await assert.rejects(prepareSlackMessage({ text: "Hello", recipientName: "Nobody" }), /No Slack user matched/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.pathname.endsWith("/users.list")));
});

test("a specific username can resolve an ambiguous name", async () => {
  mockSlack([{ ok: true, members: [asim, otherAsim] }]);
  const prepared = await prepareSlackMessage({ text: "Hello", recipientName: "@asim.g" });
  assert.equal("recipientId" in prepared && prepared.recipientId, "U456");
});

test("requires exactly one explicit destination even when a default channel exists", async () => {
  const calls = mockSlack([]);
  await assert.rejects(postMessage({ text: "Hello" }), /exactly one/);
  await assert.rejects(postMessage({ text: "Hello", channel: "C123", recipientName: "Asim" }), /exactly one/);
  assert.equal(calls.length, 0);
});

test("missing Slack token is an error, not a mock success", async () => {
  config.SLACK_BOT_TOKEN = "";
  const calls = mockSlack([]);
  await assert.rejects(postMessage({ text: "Hello", channel: "C123" }), /not configured/);
  await assert.rejects(findSlackUsers("Asim"), /not configured/);
  assert.equal(calls.length, 0);
});

test("resolves email and sends to the Slack user ID", async () => {
  const calls = mockSlack([
    { ok: true, user: asim },
    { ok: true, channel: "D123", ts: "123.456" },
  ]);
  const result = await postMessage({ text: "Hello", recipientEmail: "ASIM@example.com" });
  assert.equal(calls[0].url.searchParams.get("email"), "asim@example.com");
  assert.deepEqual(calls[1].body, { channel: "U123", text: "Hello" });
  assert.deepEqual(result, { channel: "D123", ts: "123.456", recipientId: "U123", recipientName: "Asim Ghaffar", recipientUsername: "asim" });
});

test("approved user ID is rechecked and remains the destination", async () => {
  const calls = mockSlack([
    { ok: true, user: asim },
    { ok: true, channel: "D123", ts: "123.456" },
  ]);
  await postMessage({ text: "Hello", recipientId: "U123" });
  assert.equal(calls[0].url.searchParams.get("user"), "U123");
  assert.equal(calls[1].body?.channel, "U123");
});

test("prepared approval arguments pass the actual MCP post schema and send to the approved user", async () => {
  const { tools } = await import("../src/tools");
  const postTool = tools.find((tool) => tool.name === "slack_post_message");
  assert.ok(postTool);
  const calls = mockSlack([
    { ok: true, members: [asim] },
    { ok: true, user: asim },
    { ok: true, channel: "D123", ts: "123.456" },
  ]);
  const prepared = await prepareSlackMessage({ text: "Hello", recipientName: "Asim Ghaffar" });
  const args = z.object(postTool.shape).parse(prepared);
  await postTool.run(args);
  assert.deepEqual(calls[2].body, { channel: "U123", text: "Hello" });
});

test("Slack errors, inactive users and incomplete post results are surfaced", async () => {
  mockSlack([
    { ok: false, error: "missing_scope" },
    { ok: true, user: { ...asim, deleted: true } },
    { ok: true, channel: "C123" },
  ]);
  await assert.rejects(findSlackUsers("Asim"), /missing_scope/);
  await assert.rejects(postMessage({ text: "Hello", recipientId: "U123" }), /inactive/);
  await assert.rejects(postMessage({ text: "Hello", channel: "C123" }), /incomplete message response/);
});
