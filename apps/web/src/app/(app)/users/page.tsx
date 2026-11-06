"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import { api, type Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Skeleton, useToast } from "@/components/ui";

interface Row { id: string; email: string; name: string; role: Role; createdAt: string }
const ROLES: Role[] = ["ADMIN", "MANAGER", "EMPLOYEE"];

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "EMPLOYEE" as Role });

  const load = useCallback(() => api<{ users: Row[] }>("/api/users").then((r) => setUsers(r.users)).catch((e) => toast(e.message, "error")), [toast]);
  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/users", { method: "POST", json: form });
      toast("User created");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "EMPLOYEE" });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, role: Role) {
    await api(`/api/users/${id}`, { method: "PATCH", json: { role } }).then(() => toast("Role updated")).catch((e) => toast(e.message, "error"));
    load();
  }

  async function remove(u: Row) {
    if (!confirm(`Delete ${u.name}?`)) return;
    await api(`/api/users/${u.id}`, { method: "DELETE" }).then(() => toast("User deleted")).catch((e) => toast(e.message, "error"));
    load();
  }

  const roleSelect = (u: Row) => (
    <Select aria-label={`Role for ${u.name}`} value={u.role} disabled={u.id === me?.id} onChange={(e) => changeRole(u.id, e.target.value as Role)} className="w-36">
      {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
    </Select>
  );

  return (
    <>
      <PageHeader title="Users" description="Admins can add people and control what they can do." actions={<Button onClick={() => setOpen(true)}><UserPlus className="size-4" /> Add user</Button>} />
      <Card>
        {!users ? (
          <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : users.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-6" />} title="No users" />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-5 py-3 font-medium">User</th><th className="px-3 py-3 font-medium">Role</th><th className="px-3 py-3 font-medium">Joined</th><th className="w-12" /></tr></thead>
              <tbody className="divide-y divide-line">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3"><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></td>
                    <td className="px-3 py-3">{roleSelect(u)}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-3">{u.id !== me?.id && <button onClick={() => remove(u)} className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-red-600" aria-label={`Delete ${u.name}`}><Trash2 className="size-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {users.map((u) => (
                <li key={u.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="font-medium">{u.name} {u.id === me?.id && <Badge tone="orange">You</Badge>}</p><p className="break-all text-xs text-muted">{u.email}</p></div>
                    {u.id !== me?.id && <button onClick={() => remove(u)} className="cursor-pointer rounded-lg p-2 text-muted hover:text-red-600" aria-label={`Delete ${u.name}`}><Trash2 className="size-4" /></button>}</div>
                  {roleSelect(u)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add user">
        <form onSubmit={create} className="space-y-4">
          <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Temporary password" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
          </Select>
          <Button type="submit" loading={busy} className="w-full">Create user</Button>
        </form>
      </Modal>
    </>
  );
}
