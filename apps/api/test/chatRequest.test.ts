import assert from "node:assert/strict";
import { test } from "node:test";
import { chatRequestSchema } from "../src/chatRequest";

const id = "550e8400-e29b-41d4-a716-446655440000";

test("accepts unrestricted and explicitly scoped chat requests", () => {
  assert.equal(
    chatRequestSchema.safeParse({ message: "Question" }).success,
    true,
  );
  assert.equal(
    chatRequestSchema.safeParse({ message: "Question", documentIds: [id] })
      .success,
    true,
  );
  assert.equal(
    chatRequestSchema.safeParse({
      message: "Question",
      documentIds: Array(50).fill(id),
    }).success,
    true,
  );
});

test("rejects empty, invalid, and oversized document selections", () => {
  assert.equal(
    chatRequestSchema.safeParse({ message: "Question", documentIds: [] })
      .success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({
      message: "Question",
      documentIds: ["not-a-uuid"],
    }).success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({
      message: "Question",
      documentIds: Array(51).fill(id),
    }).success,
    false,
  );
});
