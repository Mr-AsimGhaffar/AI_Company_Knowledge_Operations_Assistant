import { Router } from "express";
import {
  config, geminiConfigured, githubConfigured, githubTest, jiraConfigured, jiraTest, prisma, slackConfigured, slackTest, allowedRepos,
} from "@workora/core";
import { requireAuth, requireRole } from "./auth";

export const miscRouter = Router();
miscRouter.use(requireAuth);

const integrations = () => [
  { id: "gemini", name: "Gemini", description: `Chat model ${config.GEMINI_MODEL} + embeddings`, configured: geminiConfigured() },
  { id: "jira", name: "Jira", description: config.JIRA_PROJECT_KEY ? `Project ${config.JIRA_PROJECT_KEY}` : "Issues", configured: jiraConfigured() },
  { id: "slack", name: "Slack", description: config.SLACK_DEFAULT_CHANNEL_ID ? `Default channel ${config.SLACK_DEFAULT_CHANNEL_ID}` : "Messaging", configured: slackConfigured() },
  { id: "github", name: "GitHub", description: allowedRepos().join(", ") || "Repositories", configured: githubConfigured() },
];

miscRouter.get("/stats", async (req, res) => {
  const user = req.user!;
  const privileged = user.role !== "EMPLOYEE";
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [documents, chunks, conversations, toolCalls7d, pendingApprovals, recent] = await Promise.all([
    prisma.document.count({ where: user.role === "ADMIN" ? {} : { visibility: { has: user.role } } }),
    prisma.chunk.count(),
    prisma.conversation.count({ where: { userId: user.id } }),
    prisma.toolCallLog.count({ where: { createdAt: { gte: since }, ...(privileged ? {} : { userId: user.id }) } }),
    prisma.toolCallLog.count({ where: { status: "PENDING_APPROVAL", ...(privileged ? {} : { userId: user.id }) } }),
    prisma.toolCallLog.findMany({
      where: privileged ? {} : { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, tool: true, status: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);
  res.json({ documents, chunks: privileged ? chunks : undefined, conversations, toolCalls7d, pendingApprovals, recent, integrations: integrations() });
});

miscRouter.get("/integrations", requireRole("ADMIN", "MANAGER"), (_req, res) => {
  res.json({ integrations: integrations() });
});

miscRouter.post("/integrations/:id/test", requireRole("ADMIN"), async (req, res) => {
  const tests: Record<string, () => Promise<{ configured: boolean; message: string }>> = {
    jira: jiraTest,
    slack: slackTest,
    github: githubTest,
    gemini: async () => ({ configured: geminiConfigured(), message: geminiConfigured() ? "API key present" : "Set GEMINI_API_KEY" }),
  };
  const test = tests[String(req.params.id)];
  if (!test) return res.status(404).json({ error: "Unknown integration" });
  try {
    res.json(await test());
  } catch (err) {
    res.json({ configured: true, ok: false, message: err instanceof Error ? err.message : "Connection failed" });
  }
});

miscRouter.get("/activity", async (req, res) => {
  const user = req.user!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const toolCalls = await prisma.toolCallLog.findMany({
    where: {
      ...(user.role === "EMPLOYEE" ? { userId: user.id } : {}),
      ...(status && ["PENDING_APPROVAL", "REJECTED", "EXECUTED", "FAILED"].includes(status) ? { status: status as "EXECUTED" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, tool: true, args: true, result: true, status: true, isWrite: true, createdAt: true,
      user: { select: { name: true } }, approvedBy: { select: { name: true } },
    },
  });
  res.json({ toolCalls });
});
