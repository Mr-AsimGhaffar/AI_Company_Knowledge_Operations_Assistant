import assert from "node:assert/strict";
import { test } from "node:test";
import { preparedSlackMessageSchema } from "../src/slackApproval";

test("accepts only resolved DMs or explicit channels for approval", () => {
  assert.equal(preparedSlackMessageSchema.safeParse({ text: "Hello", recipientId: "U123", recipientDisplayName: "Asim", recipientUsername: "asim" }).success, true);
  assert.equal(preparedSlackMessageSchema.safeParse({ text: "Hello", channel: "C123" }).success, true);
  assert.equal(preparedSlackMessageSchema.safeParse({ text: "Hello", recipientEmail: "asim@example.com" }).success, false);
  assert.equal(preparedSlackMessageSchema.safeParse({ text: "Hello", recipientId: "U123" }).success, false);
  assert.equal(preparedSlackMessageSchema.safeParse({ text: "Hello" }).success, false);
  assert.equal(preparedSlackMessageSchema.safeParse({ text: "Hello", channel: "C123", recipientId: "U123", recipientDisplayName: "Asim" }).success, false);
});
