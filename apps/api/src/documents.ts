import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, type Role } from "@workora/core";
import { requireAuth, requireRole } from "./auth";
import { detectKind, processDocument } from "./ingest";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

const VISIBILITY: Record<string, Role[]> = {
  ALL: ["ADMIN", "MANAGER", "EMPLOYEE"],
  MANAGERS: ["ADMIN", "MANAGER"],
  ADMINS: ["ADMIN"],
};

const listSelect = {
  id: true, title: true, fileName: true, mimeType: true, size: true, status: true, error: true,
  chunkCount: true, visibility: true, createdAt: true, uploadedBy: { select: { name: true } },
} as const;

documentsRouter.get("/", async (req, res) => {
  const role = req.user!.role;
  const documents = await prisma.document.findMany({
    where: role === "ADMIN" ? {} : { visibility: { has: role } },
    select: listSelect,
    orderBy: { createdAt: "desc" },
  });
  res.json({ documents });
});

documentsRouter.post("/", requireRole("ADMIN", "MANAGER"), upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  const fileName = file.originalname.replace(/[^\w.\- ()]/g, "_").slice(0, 200);
  const kind = detectKind(file.buffer, fileName);
  if (!kind) return res.status(400).json({ error: "Only valid .pdf and .xlsx files are supported" });

  const visibilityKey = z.enum(["ALL", "MANAGERS", "ADMINS"]).catch("ALL").parse(req.body.visibility);
  const title = z.string().trim().min(1).max(200).catch(fileName.replace(/\.(pdf|xlsx)$/i, "")).parse(req.body.title);
  const hash = createHash("sha256").update(file.buffer).digest("hex");

  if (await prisma.document.findUnique({ where: { hash } })) {
    return res.status(409).json({ error: "This file has already been uploaded" });
  }

  const doc = await prisma.document.create({
    data: {
      title, fileName, size: file.size, hash, status: "PENDING", visibility: VISIBILITY[visibilityKey],
      mimeType: kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      uploadedById: req.user!.id,
    },
    select: listSelect,
  });
  // Fire-and-forget background processing; status is polled by the UI.
  void processDocument(doc.id, file.buffer, kind);
  res.status(202).json({ document: doc });
});

documentsRouter.patch("/:id", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const parsed = z
    .object({ title: z.string().trim().min(1).max(200).optional(), visibility: z.enum(["ALL", "MANAGERS", "ADMINS"]).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const doc = await prisma.document
    .update({
      where: { id: String(req.params.id) },
      data: { title: parsed.data.title, visibility: parsed.data.visibility ? VISIBILITY[parsed.data.visibility] : undefined },
      select: listSelect,
    })
    .catch(() => null);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.json({ document: doc });
});

documentsRouter.delete("/:id", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const deleted = await prisma.document.delete({ where: { id: String(req.params.id) } }).catch(() => null);
  if (!deleted) return res.status(404).json({ error: "Document not found" });
  res.json({ ok: true });
});
