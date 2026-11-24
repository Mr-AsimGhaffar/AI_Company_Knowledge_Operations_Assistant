"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Check, Eye, FileJson, X } from "lucide-react";
import { api, type ToolStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, toolLabel } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, statusLabel, statusTone, useToast } from "@/components/ui";

interface Entry {
  id: string; tool: string; args: unknown; result: unknown; status: ToolStatus; isWrite: boolean; createdAt: string;
  user: { name: string }; approvedBy: { name: string } | null;
}

interface ActivityResponse {
  toolCalls: Entry[];
  hasMore?: boolean;
  total?: number;
}

export default function ActivityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";
  const pageSize = 20;

  // Use React Query for activity data with pagination
  const activityQuery = useQuery({
    queryKey: ['activity', page, status],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      if (status) params.append('status', status);
      return api<ActivityResponse>(`/api/activity?${params}`);
    },
  });

  const entries = activityQuery.data?.toolCalls ?? [];
  const hasMore = activityQuery.data?.hasMore ?? false;
  const loadError = activityQuery.isError ? (activityQuery.error instanceof Error ? activityQuery.error.message : "Unable to load activity.") : "";
  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    setPage(1); // Reset to first page when filter changes
  };

  async function decide(id: string, action: "approve" | "reject") {
    try {
      await api(`/api/approvals/${id}/${action}`, { method: "POST" });
      toast(action === "approve" ? "Approved and executed" : "Rejected");
      activityQuery.refetch(); // Refetch after decision
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
  }

  useEffect(() => {
    if (!selectedEntry) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEntry(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEntry]);

  const Details = ({ e }: { e: Entry }) => (
    <button
      type="button"
      onClick={() => setSelectedEntry(e)}
      aria-expanded={selectedEntry?.id === e.id}
      aria-controls="activity-details-panel"
      className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg py-1 text-xs font-medium text-muted transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <Eye className="size-3.5" />
      View details
    </button>
  );

  const SlackDestination = ({ e }: { e: Entry }) => {
    if (e.tool !== "slack_post_message" || e.status !== "PENDING_APPROVAL" || typeof e.args !== "object" || e.args === null) return null;
    const args = e.args as Record<string, unknown>;
    const destination = typeof args.recipientDisplayName === "string"
      ? `${args.recipientDisplayName}${typeof args.recipientUsername === "string" ? ` (@${args.recipientUsername})` : ""} · ${String(args.recipientId)}`
      : typeof args.recipientEmail === "string"
        ? `Email (not yet resolved): ${args.recipientEmail}. Reject and recreate this request before approving.`
        : typeof args.channel === "string"
          ? `Channel: ${args.channel}`
          : "Destination not resolved. Reject and recreate this request before approving.";
    return (
      <div className="mt-2 max-w-sm rounded-lg border border-brand-200 bg-brand-50 p-2 text-xs dark:border-brand-600/30 dark:bg-brand-600/10">
        <p className="font-medium">To: {destination}</p>
        {typeof args.text === "string" && <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-muted">{args.text}</p>}
      </div>
    );
  };

  const Actions = ({ e }: { e: Entry }) =>
    canApprove && e.status === "PENDING_APPROVAL" ? (
      <div className="flex gap-2">
        <Button className="min-h-9 px-3" onClick={() => decide(e.id, "approve")}><Check className="size-4" /> Approve</Button>
        <Button variant="secondary" className="min-h-9 px-3" onClick={() => decide(e.id, "reject")}><X className="size-4" /> Reject</Button>
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Audit trail of every tool call made by the assistant."
        actions={
          <Select aria-label="Filter by status" value={status} onChange={(e) => handleStatusChange(e.target.value)} className="w-48">
            <option value="">All statuses</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="EXECUTED">Executed</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Failed</option>
          </Select>
        }
      />
      <Card>
        {activityQuery.isLoading && entries.length === 0 ? (
          <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : loadError ? (
          <div className="p-4"><ErrorState message={loadError} onRetry={() => activityQuery.refetch()} /></div>
        ) : entries.length === 0 ? (
          <EmptyState icon={<Activity className="size-6" />} title="Nothing here yet" description="Tool calls will be recorded here with who requested and who approved them." />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-5 py-3 font-medium">Tool</th><th className="px-3 py-3 font-medium">Requested by</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">When</th><th className="px-5 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="px-5 py-3"><p className="font-medium capitalize">{toolLabel(e.tool)}</p><SlackDestination e={e} /><Details e={e} /></td>
                    <td className="px-3 py-3 text-muted">{e.user.name}{e.approvedBy && <><br /><span className="text-xs">approved by {e.approvedBy.name}</span></>}</td>
                    <td className="px-3 py-3"><Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDate(e.createdAt)}</td>
                    <td className="px-5 py-3 text-right"><Actions e={e} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {entries.map((e) => (
                <li key={e.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2"><p className="font-medium capitalize">{toolLabel(e.tool)}</p><Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge></div>
                  <p className="text-xs text-muted">{e.user.name} · {formatDate(e.createdAt)}{e.approvedBy && ` · approved by ${e.approvedBy.name}`}</p>
                  <SlackDestination e={e} />
                  <Details e={e} />
                  <Actions e={e} />
                </li>
              ))}
            </ul>
          </>
        )}
        {entries.length > 0 && (
          <div className="border-t border-line px-5 py-4 sm:px-7 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Page <span className="font-semibold">{page}</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={page === 1 || activityQuery.isLoading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="text-xs"
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={!hasMore || activityQuery.isLoading}
                onClick={() => setPage(p => p + 1)}
                className="text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
      <button
        type="button"
        aria-label="Close activity details"
        aria-hidden={!selectedEntry}
        tabIndex={selectedEntry ? 0 : -1}
        onClick={() => setSelectedEntry(null)}
        className={`fixed inset-0 z-40 cursor-pointer bg-black/40 transition-opacity duration-300 ease-out motion-reduce:transition-none ${selectedEntry ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        id="activity-details-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-details-title"
        aria-hidden={!selectedEntry}
        inert={!selectedEntry}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:max-w-xl ${selectedEntry ? "translate-x-0" : "translate-x-full"}`}
      >
        {selectedEntry && (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:px-7">
              <div className="min-w-0">
                <div className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-600/20 dark:text-brand-300">
                  <FileJson className="size-5" />
                </div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Activity details</p>
                <h2 id="activity-details-title" className="mt-1 truncate text-xl font-semibold capitalize tracking-tight">
                  {toolLabel(selectedEntry.tool)}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(selectedEntry.status)}>{statusLabel(selectedEntry.status)}</Badge>
                  <span className="text-xs text-muted">{formatDate(selectedEntry.createdAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                className="cursor-pointer rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                aria-label="Close details"
              >
                <X className="size-5" />
              </button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
              <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Request arguments</h3>
                    <p className="mt-0.5 text-xs text-muted">Input sent to the tool</p>
                  </div>
                  <FileJson className="size-4 text-muted" />
                </div>
                <pre className="max-h-[34vh] overflow-auto rounded-xl bg-surface-2 p-4 font-mono text-xs leading-5 text-fg">{JSON.stringify(selectedEntry.args, null, 2) ?? "null"}</pre>
              </section>
              <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Tool result</h3>
                    <p className="mt-0.5 text-xs text-muted">Output returned by the tool</p>
                  </div>
                  <FileJson className="size-4 text-muted" />
                </div>
                <pre className="max-h-[34vh] overflow-auto rounded-xl bg-surface-2 p-4 font-mono text-xs leading-5 text-fg">{JSON.stringify(selectedEntry.result, null, 2) ?? "null"}</pre>
              </section>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
