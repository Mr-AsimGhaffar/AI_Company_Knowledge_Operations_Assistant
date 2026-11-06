"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, MessageSquare, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button, Input, Logo } from "@/components/ui";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-brand-500 to-brand-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3 text-xl font-semibold"><Logo size={40} /> Workora</div>
        <div className="relative max-w-md space-y-6">
          <h1 className="text-4xl font-semibold leading-tight">Your company knowledge, ready to act on.</h1>
          <ul className="space-y-4 text-white/90">
            <li className="flex gap-3"><BookOpen className="mt-0.5 size-5 shrink-0" /> Ask questions and get cited answers from your PDFs and spreadsheets.</li>
            <li className="flex gap-3"><MessageSquare className="mt-0.5 size-5 shrink-0" /> Create Jira tickets and post to Slack right from the chat.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0" /> Role-based access and human approval for every change.</li>
          </ul>
        </div>
        <p className="relative text-sm text-white/70">© {new Date().getFullYear()} Workora</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div className="flex items-center gap-3 lg:hidden"><Logo /><span className="text-xl font-semibold">Workora</span></div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-muted">Sign in to your workspace.</p>
          </div>
          <Input label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          <Input label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          <Button type="submit" loading={busy} className="w-full">Sign in</Button>
          <p className="text-center text-xs text-muted">Need access? Ask an administrator to create your account.</p>
        </form>
      </section>
    </div>
  );
}
