"use client";

import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 font-bold text-white shadow-sm"
      aria-hidden
    >
      <span style={{ fontSize: size * 0.5 }}>W</span>
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary", loading, className, children, disabled, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
    secondary: "bg-surface text-fg border border-line hover:bg-surface-2",
    ghost: "text-muted hover:bg-surface-2 hover:text-fg",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        styles[variant], className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const fieldClass =
  "w-full min-h-10 rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function Input({ label, className, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const fid = id ?? props.name;
  return (
    <label htmlFor={fid} className="block space-y-1.5">
      {label && <span className="text-sm font-medium">{label}</span>}
      <input id={fid} {...props} className={cn(fieldClass, className)} />
    </label>
  );
}

export function Select({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium">{label}</span>}
      <select {...props} className={cn(fieldClass, "pr-8", className)}>
        {children}
      </select>
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-sm", className)}>{children}</div>;
}

type Tone = "gray" | "orange" | "green" | "red" | "blue" | "amber";
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    gray: "bg-surface-2 text-muted",
    orange: "bg-brand-100 text-brand-700 dark:bg-brand-600/20 dark:text-brand-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "READY": case "EXECUTED": return "green";
    case "FAILED": case "REJECTED": return "red";
    case "PENDING_APPROVAL": return "amber";
    case "PROCESSING": case "PENDING": return "blue";
    default: return "gray";
  }
}

export const statusLabel = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-surface-2", className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-600/15">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-xl sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Close"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface Toast { id: number; message: string; type: "success" | "error" }
const ToastContext = createContext<(message: string, type?: Toast["type"]) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
            {t.type === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
