import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import type { Prisma } from "@workora/core";

process.env.DATABASE_URL = "postgresql://localhost:5432/test";
process.env.JWT_SECRET = "test-secret-for-auth-refresh-123456";
const { prisma } = await import("@workora/core");
const { Prisma } = await import("@workora/core");
const { authRouter } = await import("../src/auth");

const userId = "550e8400-e29b-41d4-a716-446655440000";
const familyId = "550e8400-e29b-41d4-a716-446655440002";
const refreshToken = "test-refresh-token";
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
const storedToken = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  tokenHash: "",
  familyId,
  userId,
  expiresAt,
  revokedAt: null,
  createdAt: new Date(),
};

const app = express();
app.use(cookieParser(), authRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/refresh`;
after(() => server.close());

test("refresh rotates the token and sets replacement authentication cookies", async () => {
  const originalFindToken = prisma.refreshToken.findUnique;
  const originalFindUser = prisma.user.findUnique;
  const originalTransaction = prisma.$transaction;
  const updateMany = async () => ({ count: 1 });
  const create = async () => ({ ...storedToken });
  const transactionClient = {
    refreshToken: { updateMany, create },
  } as unknown as Prisma.TransactionClient;
  prisma.refreshToken.findUnique = (async () => storedToken) as typeof prisma.refreshToken.findUnique;
  prisma.user.findUnique = (async () => ({
    id: userId,
    email: "refresh@example.com",
    name: "Refresh User",
    role: "EMPLOYEE",
    passwordHash: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  })) as typeof prisma.user.findUnique;
  prisma.$transaction = (async (operation: (tx: Prisma.TransactionClient) => Promise<boolean>) =>
    operation(transactionClient)) as typeof prisma.$transaction;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Cookie: `workora_refresh=${refreshToken}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user, {
      id: userId,
      email: "refresh@example.com",
      name: "Refresh User",
      role: "EMPLOYEE",
    });
    const cookies = response.headers.get("set-cookie") ?? "";
    assert.match(cookies, /workora_token=/);
    assert.match(cookies, /workora_refresh=/);
    assert.match(cookies, /Path=\/api\/auth/);
  } finally {
    prisma.refreshToken.findUnique = originalFindToken;
    prisma.user.findUnique = originalFindUser;
    prisma.$transaction = originalTransaction;
  }
});
