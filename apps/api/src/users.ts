import { Router } from "express";
import { z } from "zod";
import { prisma } from "@workora/core";
import { hashPassword, requireAuth, requireRole } from "./auth";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("ADMIN"));

const roleEnum = z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]);
const select = { id: true, email: true, name: true, role: true, createdAt: true } as const;

usersRouter.get("/", async (_req, res) => {
  res.json({ users: await prisma.user.findMany({ select, orderBy: { createdAt: "asc" } }) });
});

usersRouter.post("/", async (req, res) => {
  const parsed = z
    .object({ email: z.string().email(), name: z.string().min(1).max(100), password: z.string().min(8).max(128), role: roleEnum })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input (password min 8 chars)" });
  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ error: "Email already exists" });
  const user = await prisma.user.create({
    data: { email, name: parsed.data.name, role: parsed.data.role, passwordHash: await hashPassword(parsed.data.password) },
    select,
  });
  res.status(201).json({ user });
});

usersRouter.patch("/:id", async (req, res) => {
  const parsed = z
    .object({ name: z.string().min(1).max(100).optional(), role: roleEnum.optional(), password: z.string().min(8).max(128).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const id = String(req.params.id);
  if (id === req.user!.id && parsed.data.role && parsed.data.role !== "ADMIN") {
    return res.status(400).json({ error: "You cannot remove your own admin role" });
  }
  const { password, ...rest } = parsed.data;
  const user = await prisma.user
    .update({ where: { id }, data: { ...rest, ...(password ? { passwordHash: await hashPassword(password) } : {}) }, select })
    .catch(() => null);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

usersRouter.delete("/:id", async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: "You cannot delete yourself" });
  try {
    await prisma.user.delete({ where: { id } });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: "User cannot be deleted (has uploaded documents or activity). Change their role instead." });
  }
});
