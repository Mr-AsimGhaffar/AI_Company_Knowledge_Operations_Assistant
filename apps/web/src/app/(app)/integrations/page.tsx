"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, MessageSquare, Plug, Sparkles, Ticket } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from "@/components/ui";

interface Integration { id: string; name: string; description: string; configured: boolean }

const META: Record<string, { icon: typeof Plug; vars: string[] }> = {
  gemini: { icon: Sparkles, vars: ["GEMINI_API_KEY"] },
  jira: { icon: Ticket, vars: ["JIRA_SITE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT_KEY"] },
  slack: { icon: MessageSquare, vars: ["SLACK_BOT_TOKEN"] },
  github: { icon: GitBranch, vars: ["GITHUB_TOKEN", "GITHUB_REPOS"] },
};

export default function IntegrationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Integration[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const r = await api<{ integrations: Integration[] }>("/api/integrations");
      setItems(r.integrations);
    } catch (e) {
      setItems(null);
      setLoadError(e instanceof Error ? e.message : "Unable to load integrations.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(id: string) {
    setTesting(id);
    try {
      const r = await api<{ configured: boolean; ok?: boolean; message: string }>(`/api/integrations/${id}/test`, { method: "POST" });
      setResults((s) => ({ ...s, [id]: { ok: r.configured && r.ok !== false, message: r.message } }));
    } catch (e) {
      setResults((s) => ({ ...s, [id]: { ok: false, message: e instanceof Error ? e.message : "Failed" } }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <PageHeader title="Integrations" description="Credentials are kept server-side in the .env file and never reach the browser or the model." />
      {loadError ? <ErrorState message={loadError} onRetry={load} /> : items?.length === 0 ? (
        <EmptyState icon={<Plug className="size-6" />} title="No integrations available" />
      ) : <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {!items && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}
        {items?.map((i) => {
          const meta = META[i.id] ?? { icon: Plug, vars: [] };
          const Icon = meta.icon;
          const result = results[i.id];
          return (
            <Card key={i.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-600/15"><Icon className="size-6" /></div>
                <Badge tone={i.configured ? "green" : "amber"}>{i.configured ? "Connected" : i.id === "slack" ? "Not configured" : "Mock mode"}</Badge>
              </div>
              <h2 className="mt-4 font-semibold">{i.name}</h2>
              <p className="mt-1 break-words text-sm text-muted">{i.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {meta.vars.map((v) => <code key={v} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{v}</code>)}
              </div>
              {result && <p className={`mt-3 text-sm ${result.ok ? "text-emerald-600" : "text-red-600"}`}>{result.message}</p>}
              {user?.role === "ADMIN" && (
                <Button variant="secondary" className="mt-auto w-full" loading={testing === i.id} onClick={() => test(i.id)}>Test connection</Button>
              )}
            </Card>
          );
        })}
      </div>}
    </>
  );
}
