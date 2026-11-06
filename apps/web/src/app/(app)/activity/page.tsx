"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Check, Eye, FileJson, X } from "lucide-react";
import { api, type ToolStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, toolLabel } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Skeleton, statusLabel, statusTone, useToast } from "@/components/ui";

interface Entry {
  id: string; tool: string; args: unknown; result: unknown; status: ToolStatus; isWrite: boolean; createdAt: string;
  user: { name: string }; approvedBy: { name: string } | null;
}

export default function ActivityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [status, setStatus] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const canApprove = user?.role === "ADMIN" || user?.role === "MANAGER";

  const load = useCallback(() => {
    api<{ toolCalls: Entry[] }>(`/api/activity${status ? `?status=${status}` : ""}`).then((r) => setEntries(r.toolCalls)).catch((e) => toast(e.message, "error"));
  }, [status, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selectedEntry) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEntry(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEntry]);

  async function decide(id: string, action: "approve" | "reject") {
    try {
      await api(`/api/approvals/${id}/${action}`, { method: "POST" });
      toast(action === "approve" ? "Approved and executed" : "Rejected");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    }
    load();
  }

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
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
            <option value="">All statuses</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="EXECUTED">Executed</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Failed</option>
          </Select>
        }
      />
      <Card>
        {!entries ? (
          <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
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
                    <td className="px-5 py-3"><p className="font-medium capitalize">{toolLabel(e.tool)}</p><Details e={e} /></td>
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
                  <Details e={e} />
                  <Actions e={e} />
                </li>
              ))}
            </ul>
          </>
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
