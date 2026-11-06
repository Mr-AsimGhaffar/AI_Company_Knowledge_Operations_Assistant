"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileSpreadsheet, FileText, Trash2, UploadCloud } from "lucide-react";
import { api, type Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn, formatDate, formatSize } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Skeleton, statusLabel, statusTone, useToast } from "@/components/ui";

interface Doc {
  id: string; title: string; fileName: string; mimeType: string; size: number;
  status: string; error: string | null; chunkCount: number; visibility: Role[]; createdAt: string;
  uploadedBy: { name: string };
}

const visibilityLabel = (v: Role[]) => (v.includes("EMPLOYEE") ? "Everyone" : v.includes("MANAGER") ? "Managers & admins" : "Admins only");

export default function KnowledgePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState("ALL");
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const load = useCallback(() => api<{ documents: Doc[] }>("/api/documents").then((r) => setDocs(r.documents)).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => { load(); }, [load]);

  const processing = docs?.some((d) => d.status === "PENDING" || d.status === "PROCESSING");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [processing, load]);

  async function upload(files: FileList | File[]) {
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("visibility", visibility);
      try {
        await api("/api/documents", { method: "POST", body: form });
        toast(`Uploaded ${file.name}. Indexing…`);
      } catch (e) {
        toast(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`, "error");
      }
    }
    setUploading(false);
    load();
  }

  async function remove(d: Doc) {
    if (!confirm(`Delete "${d.title}" and its indexed content?`)) return;
    await api(`/api/documents/${d.id}`, { method: "DELETE" }).then(() => toast("Document deleted")).catch((e) => toast(e.message, "error"));
    load();
  }

  const filtered = docs?.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()) || d.fileName.toLowerCase().includes(query.toLowerCase()));
  const Icon = (d: Doc) => (d.fileName.toLowerCase().endsWith(".xlsx") ? FileSpreadsheet : FileText);

  return (
    <>
      <PageHeader title="Knowledge base" description="Documents the assistant can search and cite. PDF and XLSX supported." />

      {canManage && (
        <Card className="mb-6 p-4 sm:p-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
            className={cn("flex flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors", drag ? "border-brand-500 bg-brand-50 dark:bg-brand-600/10" : "border-line")}
          >
            <UploadCloud className="size-9 text-brand-500" />
            <p className="mt-2 text-sm font-medium">Drag & drop files here</p>
            <p className="text-xs text-muted">PDF or XLSX, up to 25 MB each</p>
            <div className="mt-4 flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:items-end sm:justify-center">
              <Select label="Who can see it" value={visibility} onChange={(e) => setVisibility(e.target.value)} className="sm:w-56">
                <option value="ALL">Everyone</option>
                <option value="MANAGERS">Managers & admins</option>
                <option value="ADMINS">Admins only</option>
              </Select>
              <Button onClick={() => input.current?.click()} loading={uploading}>Choose files</Button>
            </div>
            <input ref={input} type="file" multiple accept=".pdf,.xlsx" hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          </div>
        </Card>
      )}

      <Card>
        <div className="border-b border-line p-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
            className="min-h-10 w-full rounded-xl border border-line bg-bg px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:max-w-xs"
          />
        </div>

        {!filtered ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<BookOpen className="size-6" />} title={docs?.length ? "No matching documents" : "No documents yet"} description={canManage ? "Upload a PDF or spreadsheet to get started." : "A manager can upload documents for the assistant."} />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-5 py-3 font-medium">Document</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Access</th><th className="px-3 py-3 font-medium">Uploaded</th><th className="w-12" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((d) => {
                  const I = Icon(d);
                  return (
                    <tr key={d.id}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <I className="size-5 shrink-0 text-brand-600" />
                          <div className="min-w-0"><p className="truncate font-medium">{d.title}</p><p className="text-xs text-muted">{d.fileName} · {formatSize(d.size)}{d.status === "READY" && ` · ${d.chunkCount} passages`}</p></div>
                        </div>
                        {d.error && <p className="mt-1 text-xs text-red-600">{d.error}</p>}
                      </td>
                      <td className="px-3 py-3"><Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge></td>
                      <td className="px-3 py-3 text-muted">{visibilityLabel(d.visibility)}</td>
                      <td className="px-3 py-3 text-muted">{formatDate(d.createdAt)}<br /><span className="text-xs">by {d.uploadedBy.name}</span></td>
                      <td className="px-3 py-3">{canManage && <button onClick={() => remove(d)} className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-red-600" aria-label={`Delete ${d.title}`}><Trash2 className="size-4" /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <ul className="divide-y divide-line md:hidden">
              {filtered.map((d) => {
                const I = Icon(d);
                return (
                  <li key={d.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3"><I className="mt-0.5 size-5 shrink-0 text-brand-600" /><div className="min-w-0"><p className="break-words font-medium">{d.title}</p><p className="text-xs text-muted">{formatSize(d.size)} · {visibilityLabel(d.visibility)}</p></div></div>
                      {canManage && <button onClick={() => remove(d)} className="cursor-pointer rounded-lg p-2 text-muted hover:text-red-600" aria-label={`Delete ${d.title}`}><Trash2 className="size-4" /></button>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted"><Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge><span>{formatDate(d.createdAt)}</span></div>
                    {d.error && <p className="text-xs text-red-600">{d.error}</p>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
