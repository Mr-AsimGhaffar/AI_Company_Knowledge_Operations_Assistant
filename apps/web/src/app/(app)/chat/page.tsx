"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  Check,
  FileText,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { api, type ChatMessage, type Citation, type ToolCall } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, timeAgo, toolLabel } from "@/lib/utils";
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  statusLabel,
  statusTone,
  useToast,
} from "@/components/ui";

interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}
interface DocumentItem {
  id: string;
  title: string;
  fileName: string;
  status: string;
}

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

function compactArg(value: unknown) {
  if (typeof value === "string")
    return value.length > 72 ? `${value.slice(0, 69)}…` : value;
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `${value.length} items`;
  return "Structured data";
}

export default function ChatPage() {
  const { user } = useAuth();
  const toast = useToast();
  
  // Load conversations with React Query (parallel with documents)
  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<{ conversations: ConversationItem[] }>("/api/conversations"),
  });
  
  // Load documents in background with React Query
  const documentsQuery = useQuery({
    queryKey: ['documents'],
    queryFn: () => api<{ documents: DocumentItem[] }>("/api/documents"),
    staleTime: 2 * 60 * 1000,
  });
  
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";
  
  // Derive conversations from query
  const conversations = conversationsQuery.data?.conversations ?? [];
  
  // Derive ready documents from query
  const readyDocuments = documentsQuery.data?.documents?.filter(
    (doc) => doc.status === "READY"
  ) ?? null;

  // For backward compatibility with existing JSX that uses 'documents'
  const documents = readyDocuments;
  
  // Helper to refetch documents (for refresh button)
  const loadDocuments = () => documentsQuery.refetch();

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const openConversation = useCallback(
    async (id: string, resetSources = false) => {
      setOpeningId(id);
      try {
        const r = await api<{ conversation: { messages: ChatMessage[] } }>(
          `/api/conversations/${id}`,
        );
        setActiveId(id);
        setMessages(r.conversation.messages);
        setPanelOpen(false);
        if (resetSources) setSelectedDocuments([]);
      } catch (e) {
        toast(
          e instanceof Error ? e.message : "Unable to open this conversation.",
          "error",
        );
      } finally {
        setOpeningId(null);
      }
    },
    [toast],
  );

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setPanelOpen(false);
    setSelectedDocuments([]);
  }

  async function removeConversation(id: string) {
    await api(`/api/conversations/${id}`, { method: "DELETE" }).catch((e) =>
      toast(e.message, "error"),
    );
    if (id === activeId) newChat();
    // Refetch conversations from React Query
    conversationsQuery.refetch();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    const assistantId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", content: message },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        toolCalls: [],
        streaming: true,
      },
    ]);
    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId ?? undefined,
          message,
          documentIds: selectedDocuments.length ? selectedDocuments : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        setInput(message);
        throw new Error(
          (await res.json().catch(() => ({}))).error ?? "Request failed",
        );
      }

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
          if (event === "conversation") {
            convId = payload.id;
            setActiveId(payload.id);
          } else if (event === "text")
            patch((m) => ({ ...m, content: m.content + payload }));
          else if (event === "tool")
            patch((m) => ({
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []).filter((t) => t.id !== payload.id),
                payload as ToolCall,
              ],
            }));
          else if (event === "error") {
            streamFailed = true;
            patch((m) => ({
              ...m,
              content: m.content
                ? `${m.content}\n\n⚠️ ${payload.message}`
                : `⚠️ ${payload.message}`,
              streaming: false,
            }));
          } else if (event === "done")
            patch((m) => ({
              ...m,
              id: payload.messageId,
              citations: payload.citations as Citation[],
              streaming: false,
            }));
        }
      }
      if (convId && !streamFailed) {
        await openConversation(convId);
        conversationsQuery.refetch();
      }
    } catch (err) {
      patch((m) => ({
        ...m,
        content: `⚠️ ${err instanceof Error ? err.message : "Something went wrong"}`,
        streaming: false,
      }));
    } finally {
      setSending(false);
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    try {
      await api(`/api/approvals/${id}/${action}`, { method: "POST" });
      toast(
        action === "approve"
          ? "Action approved and executed"
          : "Action rejected",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
    if (activeId) await openConversation(activeId);
  }

  const list = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button variant="secondary" className="w-full" onClick={newChat}>
          <Plus className="size-4" /> New chat
        </Button>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {conversationsQuery.isLoading && !conversations.length ? (
          <>
            {[1, 2, 3].map((i) => (
              <li key={`skeleton-${i}`} className="rounded-xl bg-surface-2 p-3">
                <Skeleton className="mb-2 h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </li>
            ))}
          </>
        ) : (
          conversations.map((c) => (
            <li
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-xl",
                c.id === activeId
                  ? "bg-brand-50 dark:bg-brand-600/15"
                  : "hover:bg-surface-2",
              )}
            >
              <button
                onClick={() => openConversation(c.id, c.id !== activeId)}
                disabled={openingId !== null}
                aria-busy={openingId === c.id}
                className="min-w-0 flex-1 cursor-pointer px-3 py-2 text-left disabled:cursor-wait"
              >
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="text-xs text-muted">{timeAgo(c.updatedAt)}</p>
              </button>
              {openingId === c.id && (
                <Loader2
                  className="mr-1 size-4 animate-spin text-muted"
                  aria-label="Opening conversation"
                />
              )}
              <button
                onClick={() => removeConversation(c.id)}
                className="mr-1 cursor-pointer rounded-lg p-2 text-muted hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
                aria-label="Delete conversation"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))
        )}
        {!conversationsQuery.isLoading && !conversations.length && (
          <p className="px-3 py-6 text-center text-sm text-muted">
            No conversations yet
          </p>
        )}
      </ul>
    </div>
  );

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] sm:-mx-6 lg:-mx-8">
      <aside className="hidden w-72 shrink-0 border-r border-line bg-surface lg:block">
        {list}
      </aside>
      {panelOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setPanelOpen(false)}
        >
          <div
            className="h-full w-80 max-w-[85%] bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end p-2">
              <button
                onClick={() => setPanelOpen(false)}
                className="cursor-pointer rounded-lg p-2 hover:bg-surface-2"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            {list}
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
          <Button
            variant="ghost"
            className="min-h-9 px-2"
            onClick={() => setPanelOpen(true)}
          >
            <Menu className="size-4" /> History
          </Button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        >
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && (
              <EmptyState
                icon={<Sparkles className="size-6" />}
                title="How can I help today?"
                description="Ask about your documents, or have me look up Jira, GitHub and Slack."
                action={
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-600/10"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                }
              />
            )}
            {messages.map((m) => (
              <MessageView
                key={m.id}
                message={m}
                canApprove={canApprove}
                onDecide={decide}
              />
            ))}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-line bg-surface p-3 sm:p-4"
        >
          <div className="mx-auto mb-3 max-w-3xl">
            <details className="group rounded-xl border border-line bg-bg">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
                <FileText className="size-4 shrink-0 text-brand-600" />
                <span>
                  {selectedDocuments.length
                    ? `${selectedDocuments.length} selected ${selectedDocuments.length === 1 ? "document" : "documents"}`
                    : "All accessible documents"}
                </span>
                <span className="ml-auto text-xs font-normal text-muted">
                  Choose sources
                </span>
              </summary>
              <div className="border-t border-line px-3 py-3">
                <p className="mb-2 text-xs text-muted">
                  Choose up to 50 ready documents. Selection applies to document
                  searches for each message until changed; other integrations
                  are unaffected.
                </p>
                {documentsQuery.isError && (
                  <p role="alert" className="mb-2 text-xs text-red-600">
                    Failed to load documents. Please try again.
                  </p>
                )}
                <div className="mb-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-8 px-2 text-xs"
                    disabled={documentsQuery.isLoading || sending}
                    onClick={loadDocuments}
                  >
                    {documentsQuery.isLoading ? "Loading…" : "Refresh list"}
                  </Button>
                  {selectedDocuments.length > 0 && (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 text-xs"
                      disabled={sending}
                      onClick={() => setSelectedDocuments([])}
                    >
                      Search all documents
                    </Button>
                  )}
                </div>
                {documents?.length === 0 &&
                  !documentsQuery.isLoading &&
                  !documentsQuery.isError && (
                    <p className="py-2 text-xs text-muted">
                      No ready documents available. Upload a document in the
                      knowledge base and wait for indexing.
                    </p>
                  )}
                <fieldset
                  disabled={sending}
                  className="max-h-48 space-y-1 overflow-y-auto"
                >
                  <legend className="sr-only">
                    Select documents to search
                  </legend>
                  {documents?.map((document) => (
                    <label
                      key={document.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDocuments.includes(document.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          if (checked && selectedDocuments.length >= 50) {
                            toast("Select at most 50 documents.", "error");
                            return;
                          }
                          setSelectedDocuments((selected) =>
                            checked
                              ? [...selected, document.id]
                              : selected.filter((id) => id !== document.id),
                          );
                        }}
                        className="mt-1 accent-brand-600"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {document.title}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {document.fileName}
                        </span>
                      </span>
                    </label>
                  ))}
                  {documents &&
                    selectedDocuments
                      .filter(
                        (id) =>
                          !documents.some((document) => document.id === id),
                      )
                      .map((id) => (
                        <label
                          key={id}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs text-red-600"
                        >
                          <input
                            type="checkbox"
                            checked
                            onChange={() =>
                              setSelectedDocuments((selected) =>
                                selected.filter((item) => item !== id),
                              )
                            }
                          />
                          Selected document no longer available ({id}). Uncheck
                          to remove.
                        </label>
                      ))}
                </fieldset>
              </div>
            </details>
          </div>
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Message Workora…"
              aria-label="Message"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <Button
              type="submit"
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="size-11 shrink-0 px-0"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MessageView({
  message,
  canApprove,
  onDecide,
}: {
  message: ChatMessage;
  canApprove: boolean;
  onDecide: (id: string, a: "approve" | "reject") => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }
  const tools = message.toolCalls ?? [];
  return (
    <div className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-600/20 dark:text-brand-300">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {tools.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-line bg-surface p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium capitalize">
                <Wrench className="size-4 text-muted" />
                {toolLabel(t.tool)}
              </span>
              <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge>
            </div>
            {Object.keys(t.args).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(t.args)
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <span
                      key={key}
                      className="max-w-full truncate rounded-lg bg-surface-2 px-2.5 py-1 text-xs"
                    >
                      <span className="capitalize text-muted">
                        {key.replace(/_/g, " ")}:
                      </span>{" "}
                      {compactArg(value)}
                    </span>
                  ))}
                {Object.keys(t.args).length > 3 && (
                  <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-muted">
                    +{Object.keys(t.args).length - 3} more
                  </span>
                )}
              </div>
            )}
            {t.tool === "slack_post_message" &&
              t.status === "PENDING_APPROVAL" &&
              typeof t.args.recipientDisplayName === "string" && (
                <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-600/30 dark:bg-brand-600/10">
                  <p className="text-xs font-medium text-muted">
                    Slack recipient
                  </p>
                  <p className="mt-1 font-medium">
                    {t.args.recipientDisplayName}
                    {typeof t.args.recipientUsername === "string" && (
                      <span className="ml-1 text-muted">
                        (@{t.args.recipientUsername})
                      </span>
                    )}
                  </p>
                  {typeof t.args.recipientId === "string" && (
                    <p className="mt-1 text-xs text-muted">
                      User ID: {t.args.recipientId}
                    </p>
                  )}
                  {typeof t.args.text === "string" && (
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {t.args.text}
                    </p>
                  )}
                </div>
              )}
            <details className="mt-2 rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted hover:text-fg">
                View request details
              </summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-line bg-surface-2 p-3 text-xs text-muted">
                {JSON.stringify(t.args, null, 2)}
              </pre>
            </details>
            {t.status === "FAILED" && (
              <p
                className="mt-2 whitespace-pre-wrap break-words text-xs text-red-600"
                role="alert"
              >
                {t.error ??
                  (typeof t.result === "object" &&
                  t.result !== null &&
                  "error" in t.result &&
                  typeof t.result.error === "string"
                    ? t.result.error
                    : "The action failed. Check the activity log for details.")}
              </p>
            )}
            {t.status === "PENDING_APPROVAL" &&
              t.isWrite !== false &&
              (canApprove && !message.streaming ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    className="min-h-9 flex-1"
                    onClick={() => onDecide(t.id, "approve")}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-9 flex-1"
                    onClick={() => onDecide(t.id, "reject")}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  Waiting for a manager or admin to approve.
                </p>
              ))}
          </div>
        ))}
        {message.content ? (
          <div className="md break-words text-sm leading-relaxed">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        ) : message.streaming ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Thinking…
          </p>
        ) : null}
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {message.citations.map((c) => (
              <span
                key={c.ref}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs"
              >
                <FileText className="size-3.5 shrink-0 text-brand-600" />
                <span className="font-semibold">[{c.ref}]</span>
                <span className="truncate">
                  {c.title}
                  {c.location && ` · ${c.location}`}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
