import { Router, type Response } from "express";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import { z } from "zod";
import { config, describeLocation, getGemini, geminiConfigured, prisma, searchDocs, writeToolNames, type Role } from "@workora/core";
import { requireAuth, requireRole } from "./auth";
import { callMcpTool, listMcpTools } from "./mcpClient";

export const chatRouter = Router();
chatRouter.use(requireAuth);

const MAX_STEPS = 6;
const HISTORY_LIMIT = 20;

const SYSTEM_PROMPT = `You are Workora, an operations assistant for a company.
- For any question about company policies, projects, processes or data, call docs_search first and answer ONLY from the returned passages. Cite sources inline as [1], [2] using each passage's "ref" number. If nothing relevant is found, say so plainly instead of guessing.
- Use the Jira, Slack and GitHub tools when the user asks about or wants to change those systems.
- Tools that create or change things (Jira create/update, Slack post) are queued for human approval. Call them directly when the user asks, then tell the user the action is awaiting approval. Never claim a queued action has already happened.
- Be concise and professional. Use Markdown for lists and code.`;

const docsSearchDeclaration: FunctionDeclaration = {
  name: "docs_search",
  description: "Search the company's internal documents (PDF and spreadsheets). Returns relevant passages with a numbered ref for citation.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language search query" },
      limit: { type: "integer", minimum: 1, maximum: 10, description: "Max passages (default 5)" },
    },
    required: ["query"],
  },
};

let declarationsCache: FunctionDeclaration[] | null = null;
async function getDeclarations(): Promise<FunctionDeclaration[]> {
  if (declarationsCache) return declarationsCache;
  const mcpTools = await listMcpTools();
  declarationsCache = [
    docsSearchDeclaration,
    ...mcpTools
      .filter((t) => t.name !== "docs_search")
      .map((t) => {
        const { $schema: _omit, ...schema } = t.inputSchema as Record<string, unknown>;
        return { name: t.name, description: t.description ?? "", parametersJsonSchema: schema };
      }),
  ];
  return declarationsCache;
}

interface Citation {
  ref: number;
  documentId: string;
  title: string;
  location: string;
}

function sse(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const messageInclude = { toolCalls: { orderBy: { createdAt: "asc" as const } } };

chatRouter.get("/conversations", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { userId: req.user!.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  res.json({ conversations });
});

chatRouter.get("/conversations/:id", async (req, res) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: String(req.params.id), userId: req.user!.id },
    include: { messages: { orderBy: { createdAt: "asc" }, include: messageInclude } },
  });
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  res.json({ conversation });
});

chatRouter.delete("/conversations/:id", async (req, res) => {
  const { count } = await prisma.conversation.deleteMany({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!count) return res.status(404).json({ error: "Conversation not found" });
  res.json({ ok: true });
});

chatRouter.post("/chat", async (req, res) => {
  const parsed = z.object({ conversationId: z.string().uuid().optional(), message: z.string().trim().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message is required (max 4000 characters)" });
  const user = req.user!;

  let conversation = parsed.data.conversationId
    ? await prisma.conversation.findFirst({ where: { id: parsed.data.conversationId, userId: user.id } })
    : null;
  if (parsed.data.conversationId && !conversation) return res.status(404).json({ error: "Conversation not found" });
  conversation ??= await prisma.conversation.create({
    data: { userId: user.id, title: parsed.data.message.slice(0, 60) },
  });

  const send = sse(res);
  send("conversation", { id: conversation.id });

  try {
    await prisma.message.create({ data: { conversationId: conversation.id, role: "user", content: parsed.data.message } });
    if (!geminiConfigured()) throw new Error("GEMINI_API_KEY is not configured. Add it to your .env file and restart the API.");

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    });
    const contents: Content[] = history
      .reverse()
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] }));

    const declarations = await getDeclarations();
    const ai = getGemini();
    const citations: Citation[] = [];
    const toolLogIds: string[] = [];
    let finalText = "";
    let aborted = false;
    res.on("close", () => {
      aborted = true;
    });

    for (let step = 0; step < MAX_STEPS && !aborted; step++) {
      const stream = await ai.models.generateContentStream({
        model: config.GEMINI_MODEL,
        contents,
        config: { systemInstruction: SYSTEM_PROMPT, tools: [{ functionDeclarations: declarations }], temperature: 0.3 },
      });

      const modelParts: Part[] = [];
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          modelParts.push(part);
          if (part.text && !part.thought) {
            finalText += part.text;
            send("text", part.text);
          }
          if (part.functionCall?.name) calls.push({ name: part.functionCall.name, args: (part.functionCall.args ?? {}) as Record<string, unknown> });
        }
      }
      if (!calls.length) break;

      contents.push({ role: "model", parts: modelParts });
      const responseParts: Part[] = [];

      for (const call of calls) {
        const isWrite = writeToolNames.has(call.name);
        const log = await prisma.toolCallLog.create({
          data: {
            tool: call.name, args: call.args as object, isWrite, userId: user.id, conversationId: conversation.id,
            status: isWrite ? "PENDING_APPROVAL" : "EXECUTED",
          },
        });
        toolLogIds.push(log.id);

        let response: Record<string, unknown>;
        if (isWrite) {
          send("tool", { id: log.id, tool: call.name, args: call.args, status: "PENDING_APPROVAL", isWrite });
          response = { status: "queued_for_approval", note: "A human must approve this action before it runs. Tell the user it is awaiting approval." };
        } else {
          try {
            const result =
              call.name === "docs_search" ? await runDocsSearch(call.args, user.role, citations) : await callMcpTool(call.name, call.args);
            await prisma.toolCallLog.update({ where: { id: log.id }, data: { result: summarize(result) } });
            send("tool", { id: log.id, tool: call.name, args: call.args, status: "EXECUTED", isWrite });
            response = { result };
          } catch (err) {
            const message = err instanceof Error ? err.message : "Tool failed";
            await prisma.toolCallLog.update({ where: { id: log.id }, data: { status: "FAILED", result: { error: message } } });
            send("tool", { id: log.id, tool: call.name, args: call.args, status: "FAILED", isWrite, error: message });
            response = { error: message };
          }
        }
        responseParts.push({ functionResponse: { name: call.name, response } });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    const message = await prisma.message.create({
      data: { conversationId: conversation.id, role: "assistant", content: finalText, citations: citations.length ? (citations as object[]) : undefined },
    });
    if (toolLogIds.length) await prisma.toolCallLog.updateMany({ where: { id: { in: toolLogIds } }, data: { messageId: message.id } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    send("done", { messageId: message.id, citations });
  } catch (err) {
    console.error("[chat] error:", err);
    send("error", { message: friendlyError(err) });
  } finally {
    res.end();
  }
});

async function runDocsSearch(args: Record<string, unknown>, role: Role, citations: Citation[]) {
  const query = String(args.query ?? "");
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10);
  const hits = await searchDocs(query, role, limit);
  return hits.map((h) => {
    const location = describeLocation(h.metadata);
    let ref = citations.find((c) => c.documentId === h.documentId && c.location === location)?.ref;
    if (!ref) {
      ref = citations.length + 1;
      citations.push({ ref, documentId: h.documentId, title: h.title, location });
    }
    return { ref, title: h.title, location, content: h.content };
  });
}

const summarize = (result: unknown): object => {
  const json = JSON.stringify(result);
  return json.length > 4000 ? { truncated: true, preview: json.slice(0, 4000) } : (result as object) ?? {};
};

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/API key|API_KEY|PERMISSION_DENIED|401|403/i.test(msg)) return "Gemini rejected the API key. Check GEMINI_API_KEY in your .env.";
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return "Gemini rate limit or quota reached. Please try again shortly.";
  return msg.length > 300 ? "Something went wrong while generating the answer." : msg;
}

// ---- Approval flow for write tools (managers and admins) ----
const approvalRouter = Router();
export const approvalsRouter = approvalRouter;
approvalRouter.use(requireAuth, requireRole("ADMIN", "MANAGER"));

async function loadPending(id: string) {
  const log = await prisma.toolCallLog.findUnique({ where: { id } });
  if (!log || !log.isWrite) return null;
  return log;
}

async function postFollowUp(conversationId: string | null, content: string) {
  if (!conversationId) return;
  await prisma.message.create({ data: { conversationId, role: "assistant", content } });
}

approvalRouter.post("/:id/approve", async (req, res) => {
  const log = await loadPending(String(req.params.id));
  if (!log) return res.status(404).json({ error: "Action not found" });
  // Atomically claim the action so concurrent approvals cannot run it twice.
  const claimed = await prisma.toolCallLog.updateMany({
    where: { id: log.id, status: "PENDING_APPROVAL" },
    data: { approvedById: req.user!.id, status: "EXECUTED" },
  });
  if (!claimed.count) return res.status(409).json({ error: "This action was already handled" });
  try {
    const result = await callMcpTool(log.tool, log.args as Record<string, unknown>);
    const updated = await prisma.toolCallLog.update({ where: { id: log.id }, data: { result: summarize(result) } });
    await postFollowUp(log.conversationId, `✅ Approved by ${req.user!.name}: \`${log.tool}\` ran successfully.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
    res.json({ toolCall: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool failed";
    const updated = await prisma.toolCallLog.update({ where: { id: log.id }, data: { status: "FAILED", result: { error: message } } });
    await postFollowUp(log.conversationId, `⚠️ \`${log.tool}\` was approved but failed: ${message}`);
    res.status(502).json({ error: message, toolCall: updated });
  }
});

approvalRouter.post("/:id/reject", async (req, res) => {
  const log = await loadPending(String(req.params.id));
  if (!log) return res.status(404).json({ error: "Action not found" });
  const claimed = await prisma.toolCallLog.updateMany({
    where: { id: log.id, status: "PENDING_APPROVAL" },
    data: { approvedById: req.user!.id, status: "REJECTED" },
  });
  if (!claimed.count) return res.status(409).json({ error: "This action was already handled" });
  await postFollowUp(log.conversationId, `🚫 ${req.user!.name} rejected \`${log.tool}\`. Nothing was changed.`);
  res.json({ toolCall: await prisma.toolCallLog.findUnique({ where: { id: log.id } }) });
});
