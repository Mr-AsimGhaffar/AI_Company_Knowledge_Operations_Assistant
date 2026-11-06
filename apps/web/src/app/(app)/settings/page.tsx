"use client";

import { useState, type FormEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/components/shell";
import { Badge, Button, Card, Input, PageHeader, useToast } from "@/components/ui";

export default function SettingsPage() {
  const { user } = useAuth();
  const { dark, toggle } = useTheme();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", json: { current, next } });
      toast("Password updated");
      setCurrent("");
      setNext("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Manage your profile and preferences." />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">Profile</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted">Name</dt><dd className="font-medium">{user?.name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Email</dt><dd className="break-all font-medium">{user?.email}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Role</dt><dd><Badge tone="orange">{user?.role}</Badge></dd></div>
          </dl>
          <div className="flex items-center justify-between border-t border-line pt-4">
            <div><p className="text-sm font-medium">Appearance</p><p className="text-xs text-muted">{dark ? "Dark" : "Light"} theme</p></div>
            <Button variant="secondary" onClick={toggle}>{dark ? <Sun className="size-4" /> : <Moon className="size-4" />} Switch</Button>
          </div>
        </Card>

        <Card className="p-5">
          <form onSubmit={changePassword} className="space-y-4">
            <h2 className="font-semibold">Change password</h2>
            <Input label="Current password" type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <Input label="New password" type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <Button type="submit" loading={busy}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
