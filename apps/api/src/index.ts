import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { env } from "./env";
import { authRouter } from "./auth";
import { usersRouter } from "./users";
import { documentsRouter } from "./documents";
import { approvalsRouter, chatRouter } from "./chat";
import { miscRouter } from "./misc";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.use("/api/chat", rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/approvals", approvalsRouter);
app.use("/api", chatRouter);
app.use("/api", miscRouter);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File too large (max 25 MB)" : err.message });
  console.error("[api] unhandled:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(env.API_PORT, () => console.log(`[api] listening on http://localhost:${env.API_PORT}`));
