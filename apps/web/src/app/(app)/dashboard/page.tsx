"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, BookOpen, Clock, Layers, MessageSquare, Plug } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo, toolLabel } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, statusLabel, statusTone } from "@/components/ui";

interface Stats {
  documents: number;
  chunks?: number;
  conversations: number;
  toolCalls7d: number;
  pendingApprovals: number;
  recent: { id: string; tool: string; status: string; createdAt: string; user: { name: string } }[];
  integrations: { id: string; name: string; description: string; configured: boolean }[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch((e) => setError(e.message));
  }, []);

  const cards = stats && [
    { label: "Documents", value: stats.documents, icon: BookOpen, href: "/knowledge" },
    { label: "Conversations", value: stats.conversations, icon: MessageSquare, href: "/chat" },
    { label: "Actions (7 days)", value: stats.toolCalls7d, icon: Activity, href: "/activity" },
    { label: "Pending approvals", value: stats.pendingApprovals, icon: Clock, href: "/activity" },
  ];

  return (
    <>
      <PageHeader
        title={`Hello, ${user?.name.split(" ")[0]} 👋`}
        description="Here is what is happening in your workspace."
        actions={<Link href="/chat"><Button><MessageSquare className="size-4" /> Ask the assistant</Button></Link>}
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(cards ?? Array.from({ length: 4 })).map((c, i) =>
          c ? (
            <Link key={c.label} href={c.href}>
              <Card className="p-5 transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted">{c.label}</p>
                  <div className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-600/15"><c.icon className="size-5" /></div>
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-tight">{c.value}</p>
              </Card>
            </Link>
          ) : (
            <Card key={i} className="p-5"><Skeleton className="h-4 w-24" /><Skeleton className="mt-4 h-8 w-16" /></Card>
          ),
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line p-5">
            <h2 className="font-semibold">Recent activity</h2>
            <Link href="/activity" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>
          </div>
          {!stats ? (
            <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : stats.recent.length === 0 ? (
            <EmptyState icon={<Activity className="size-6" />} title="No activity yet" description="Tool calls made by the assistant will show up here." />
          ) : (
            <ul className="divide-y divide-line">
              {stats.recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium capitalize">{toolLabel(r.tool)}</p>
                    <p className="text-xs text-muted">{r.user.name} · {timeAgo(r.createdAt)}</p>
                  </div>
                  <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-line p-5">
            <Plug className="size-4 text-muted" /><h2 className="font-semibold">Integrations</h2>
          </div>
          <ul className="divide-y divide-line">
            {(stats?.integrations ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{i.name}</p>
                  <p className="truncate text-xs text-muted">{i.description}</p>
                </div>
                <Badge tone={i.configured ? "green" : "amber"}>{i.configured ? "Connected" : "Mock mode"}</Badge>
              </li>
            ))}
            {!stats && <li className="p-5"><Skeleton className="h-24" /></li>}
          </ul>
          {stats?.chunks !== undefined && (
            <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-muted"><Layers className="size-4" /> {stats.chunks} indexed passages</div>
          )}
        </Card>
      </div>
    </>
  );
}
