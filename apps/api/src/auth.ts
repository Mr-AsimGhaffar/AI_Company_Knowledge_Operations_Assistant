import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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

const COOKIE = "workora_token";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const publicUser = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
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
  const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "12h" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: MAX_AGE_MS, path: "/" });
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
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
