import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, type Role } from "@workora/core";
import { env, isProd } from "./env";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

const ACCESS_COOKIE = "workora_token";
const REFRESH_COOKIE = "workora_refresh";
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const publicUser = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");

function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}

function revokeRefreshFamily(familyId: string) {
  return prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    // Re-read the user so role changes and deletions take effect immediately.
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };

export const hashPassword = (p: string) => bcrypt.hash(p, 12);

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Pre-computed hash so unknown emails take the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid email or password" });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: "Invalid email or password" });
  const accessToken = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = randomBytes(32).toString("base64url");
  const refreshExpiresAt = new Date(Date.now() + REFRESH_MAX_AGE_MS);
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      familyId: randomUUID(),
      userId: user.id,
      expiresAt: refreshExpiresAt,
    },
  });
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: ACCESS_MAX_AGE_MS,
    path: "/",
  });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: REFRESH_MAX_AGE_MS,
    path: "/api/auth",
  });
  res.json({ user: publicUser(user) });
});

authRouter.post("/refresh", async (req, res) => {
  const presentedToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof presentedToken !== "string") {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(presentedToken) },
  });
  if (!storedToken) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  const now = new Date();
  if (storedToken.revokedAt || storedToken.expiresAt <= now) {
    await revokeRefreshFamily(storedToken.familyId);
    clearAuthCookies(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = await prisma.user.findUnique({ where: { id: storedToken.userId } });
  if (!user) {
    await revokeRefreshFamily(storedToken.familyId);
    clearAuthCookies(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  const nextRefreshToken = randomBytes(32).toString("base64url");
  const rotated = await prisma.$transaction(async (tx) => {
    const result = await tx.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (result.count !== 1) return false;
    await tx.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(nextRefreshToken),
        familyId: storedToken.familyId,
        userId: storedToken.userId,
        expiresAt: storedToken.expiresAt,
      },
    });
    return true;
  });

  if (!rotated) {
    await revokeRefreshFamily(storedToken.familyId);
    clearAuthCookies(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  const refreshMaxAge = storedToken.expiresAt.getTime() - Date.now();
  const accessToken = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "15m" });
  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: ACCESS_MAX_AGE_MS,
    path: "/",
  });
  res.cookie(REFRESH_COOKIE, nextRefreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: refreshMaxAge,
    path: "/api/auth",
  });
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  const presentedToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof presentedToken === "string") {
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presentedToken) },
      select: { familyId: true },
    });
    if (storedToken) await revokeRefreshFamily(storedToken.familyId);
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.post("/password", requireAuth, async (req, res) => {
  const parsed = z.object({ current: z.string(), next: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "New password must be at least 8 characters" });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(parsed.data.current, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next) } });
  res.json({ ok: true });
});
