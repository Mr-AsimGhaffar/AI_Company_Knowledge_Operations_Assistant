"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, Check, FileText, Loader2, Menu, MessageSquare, Plus, Send, Sparkles, Trash2, Wrench, X } from "lucide-react";
import { api, type ChatMessage, type Citation, type ToolCall } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, timeAgo, toolLabel } from "@/lib/utils";
import { Badge, Button, EmptyState, statusLabel, statusTone, useToast } from "@/components/ui";

interface ConversationItem { id: string; title: string; updatedAt: string }

const SUGGESTIONS = [
  "Summarize our leave policy",
  "What does the latest uploaded spreadsheet contain?",
  "Search Jira for open issues",
  "Show recent commits in AI-Product-Studio",
];

function parseSSE(buffer: string) {
  const events: { event: string; data: string }[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const p of parts) {
    const event = /^event: (.*)$/m.exec(p)?.[1] ?? "message";
    const data = /^data: (.*)$/m.exec(p)?.[1] ?? "";
    events.push({ event, data });
  }
  return { events, rest };
}

export default function ChatPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";

  const loadList = useCallback(() => api<{ conversations: ConversationItem[] }>("/api/conversations").then((r) => setConversations(r.conversations)).catch(() => undefined), []);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const openConversation = useCallback(async (id: string) => {
    const r = await api<{ conversation: { messages: ChatMessage[] } }>(`/api/conversations/${id}`);
    setActiveId(id);
    setMessages(r.conversation.messages);
    setPanelOpen(false);
  }, []);

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setPanelOpen(false);
  }

  async function removeConversation(id: string) {
    await api(`/api/conversations/${id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    if (id === activeId) newChat();
    loadList();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    const assistantId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: message }, { id: assistantId, role: "assistant", content: "", toolCalls: [], streaming: true }]);
    const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId ?? undefined, message }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let convId = activeId;
      let streamFailed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSE(buffer);
        buffer = rest;
        for (const { event, data } of events) {
          const payload = JSON.parse(data);
          if (event === "conversation") { convId = payload.id; setActiveId(payload.id); }
          else if (event === "text") patch((m) => ({ ...m, content: m.content + payload }));
          else if (event === "tool") patch((m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []).filter((t) => t.id !== payload.id), payload as ToolCall] }));
          else if (event === "error") {
            streamFailed = true;
            patch((m) => ({
              ...m,
              content: m.content ? `${m.content}\n\n⚠️ ${payload.message}` : `⚠️ ${payload.message}`,
              streaming: false,
            }));
          }
          else if (event === "done") patch((m) => ({ ...m, id: payload.messageId, citations: payload.citations as Citation[], streaming: false }));
        }
      }
      if (convId && !streamFailed) await openConversation(convId);
      loadList();
    } catch (err) {
      patch((m) => ({ ...m, content: `⚠️ ${err instanceof Error ? err.message : "Something went wrong"}`, streaming: false }));
    } finally {
      setSending(false);
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    try {
      await api(`/api/approvals/${id}/${action}`, { method: "POST" });
      toast(action === "approve" ? "Action approved and executed" : "Action rejected");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
    if (activeId) await openConversation(activeId);
  }

  const list = (
    <div className="flex h-full flex-col">
      <div className="p-3"><Button variant="secondary" className="w-full" onClick={newChat}><Plus className="size-4" /> New chat</Button></div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {conversations.map((c) => (
          <li key={c.id} className={cn("group flex items-center gap-1 rounded-xl", c.id === activeId ? "bg-brand-50 dark:bg-brand-600/15" : "hover:bg-surface-2")}>
            <button onClick={() => openConversation(c.id)} className="min-w-0 flex-1 cursor-pointer px-3 py-2 text-left">
              <p className="truncate text-sm font-medium">{c.title}</p>
              <p className="text-xs text-muted">{timeAgo(c.updatedAt)}</p>
            </button>
            <button onClick={() => removeConversation(c.id)} className="mr-1 cursor-pointer rounded-lg p-2 text-muted hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100" aria-label="Delete conversation"><Trash2 className="size-4" /></button>
          </li>
        ))}
        {!conversations.length && <p className="px-3 py-6 text-center text-sm text-muted">No conversations yet</p>}
      </ul>
    </div>
  );

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] sm:-mx-6 lg:-mx-8">
      <aside className="hidden w-72 shrink-0 border-r border-line bg-surface lg:block">{list}</aside>
      {panelOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setPanelOpen(false)}>
          <div className="h-full w-80 max-w-[85%] bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end p-2"><button onClick={() => setPanelOpen(false)} className="cursor-pointer rounded-lg p-2 hover:bg-surface-2" aria-label="Close"><X className="size-5" /></button></div>
            {list}
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
          <Button variant="ghost" className="min-h-9 px-2" onClick={() => setPanelOpen(true)}><Menu className="size-4" /> History</Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && (
              <EmptyState
                icon={<Sparkles className="size-6" />}
                title="How can I help today?"
                description="Ask about your documents, or have me look up Jira, GitHub and Slack."
                action={
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} className="cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-600/10">{s}</button>
                    ))}
                  </div>
                }
              />
            )}
            {messages.map((m) => (
              <MessageView key={m.id} message={m} canApprove={canApprove} onDecide={decide} />
            ))}
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="border-t border-line bg-surface p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1}
              maxLength={4000}
              placeholder="Message Workora…"
              aria-label="Message"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <Button type="submit" disabled={!input.trim() || sending} aria-label="Send" className="size-11 shrink-0 px-0">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MessageView({ message, canApprove, onDecide }: { message: ChatMessage; canApprove: boolean; onDecide: (id: string, a: "approve" | "reject") => void }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">{message.content}</div>
      </div>
    );
  }
  const tools = message.toolCalls ?? [];
  return (
    <div className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-600/20 dark:text-brand-300"><Bot className="size-4" /></div>
      <div className="min-w-0 flex-1 space-y-3">
        {tools.map((t) => (
          <div key={t.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium capitalize"><Wrench className="size-4 text-muted" />{toolLabel(t.tool)}</span>
              <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge>
            </div>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 text-xs text-muted">{JSON.stringify(t.args, null, 2)}</pre>
            {t.status === "PENDING_APPROVAL" && t.isWrite !== false && (
              canApprove && !message.streaming ? (
                <div className="mt-3 flex gap-2">
                  <Button className="min-h-9 flex-1" onClick={() => onDecide(t.id, "approve")}><Check className="size-4" /> Approve</Button>
                  <Button variant="secondary" className="min-h-9 flex-1" onClick={() => onDecide(t.id, "reject")}><X className="size-4" /> Reject</Button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">Waiting for a manager or admin to approve.</p>
              )
            )}
          </div>
        ))}
        {message.content ? (
          <div className="md break-words text-sm leading-relaxed"><ReactMarkdown>{message.content}</ReactMarkdown></div>
        ) : message.streaming ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Thinking…</p>
        ) : null}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {message.citations.map((c) => (
              <span key={c.ref} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
                <FileText className="size-3.5 shrink-0 text-brand-600" />
                <span className="font-semibold">[{c.ref}]</span>
                <span className="truncate">{c.title}{c.location && ` · ${c.location}`}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
