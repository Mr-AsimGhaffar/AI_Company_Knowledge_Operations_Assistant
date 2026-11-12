import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";

process.env.DATABASE_URL = "postgresql://localhost:5432/test";
process.env.JWT_SECRET = "test-secret-for-chat-source-validation-123";
const { prisma } = await import("@workora/core");
const { chatRouter } = await import("../src/chat");

const userId = "550e8400-e29b-41d4-a716-446655440000";
const documentId = "550e8400-e29b-41d4-a716-446655440001";
const conversationId = "550e8400-e29b-41d4-a716-446655440002";
const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET);
const app = express();
app.use(express.json(), cookieParser(), chatRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/chat`;
after(() => server.close());

test("validates selected sources against readiness and current user role before starting a chat", async () => {
  const originalUser = prisma.user.findUnique;
  const originalCount = prisma.document.count;
  const originalCreate = prisma.conversation.create;
  const user = mock.fn(async () => ({
    id: userId,
    email: "test@example.com",
    name: "Test",
    role: "EMPLOYEE",
    passwordHash: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const count = mock.fn(async () => 0);
  const create = mock.fn(async () => {
    throw new Error(
      "Conversation must not be created for inaccessible sources",
    );
  });
  prisma.user.findUnique = user;
  prisma.document.count = count;
  prisma.conversation.create = create;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `workora_token=${token}`,
      },
      body: JSON.stringify({ message: "Question", documentIds: [documentId] }),
    });
    assert.equal(response.status, 400);
    assert.match(
      (await response.json()).error,
      /unavailable, not ready, or no longer accessible/,
    );
    assert.deepEqual(count.mock.calls[0].arguments[0], {
      where: {
        id: { in: [documentId] },
        status: "READY",
        visibility: { has: "EMPLOYEE" },
      },
    });
    assert.equal(create.mock.callCount(), 0);
  } finally {
    prisma.user.findUnique = originalUser;
    prisma.document.count = originalCount;
    prisma.conversation.create = originalCreate;
  }
});

test("allows a ready visible selection through to conversation validation", async () => {
  const originalUser = prisma.user.findUnique;
  const originalCount = prisma.document.count;
  const originalFind = prisma.conversation.findFirst;
  const user = mock.fn(async () => ({
    id: userId,
    email: "test@example.com",
    name: "Test",
    role: "MANAGER",
    passwordHash: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const count = mock.fn(async () => 1);
  const findConversation = mock.fn(async () => null);
  prisma.user.findUnique = user;
  prisma.document.count = count;
  prisma.conversation.findFirst = findConversation;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `workora_token=${token}`,
      },
      body: JSON.stringify({
        message: "Question",
        conversationId,
        documentIds: [documentId, documentId],
      }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(count.mock.calls[0].arguments[0], {
      where: {
        id: { in: [documentId] },
        status: "READY",
        visibility: { has: "MANAGER" },
      },
    });
    assert.equal(findConversation.mock.callCount(), 1);
  } finally {
    prisma.user.findUnique = originalUser;
    prisma.document.count = originalCount;
    prisma.conversation.findFirst = originalFind;
  }
});
