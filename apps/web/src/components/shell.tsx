"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, LayoutDashboard, LogOut, Menu, MessageSquare, Moon, Plug, Settings, Sun, Users, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Logo, Skeleton } from "./ui";

const NAV: { href: string; label: string; icon: typeof Activity; roles?: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Assistant", icon: MessageSquare },
  { href: "/knowledge", label: "Knowledge base", icon: BookOpen },
  { href: "/integrations", label: "Integrations", icon: Plug, roles: ["ADMIN", "MANAGER"] },
  { href: "/activity", label: "Activity log", icon: Activity },
  { href: "/users", label: "Users", icon: Users, roles: ["ADMIN"] },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("workora-theme", next ? "dark" : "light");
    setDark(next);
  };
  return { dark, toggle };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { dark, toggle } = useTheme();

  useEffect(() => setOpen(false), [pathname]);

  if (loading || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="w-64 space-y-3"><Skeleton className="h-8" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
      </div>
    );
  }

  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  const current = items.find((n) => pathname.startsWith(n.href));

  return (
    <div className="min-h-dvh">
      {open && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-surface transition-transform duration-200 md:w-[76px] md:translate-x-0 lg:w-64",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-between gap-3 px-4 md:justify-center lg:justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Logo />
            <span className="text-lg font-semibold tracking-tight md:hidden lg:inline">Workora</span>
          </Link>
          <button className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-2 md:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors md:justify-center lg:justify-start",
                  active ? "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-300" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon className="size-5 shrink-0" />
                <span className="md:hidden lg:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 rounded-xl p-2 md:justify-center lg:justify-start">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-600/20 dark:text-brand-300">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 md:hidden lg:block">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs capitalize text-muted">{user.role.toLowerCase()}</p>
            </div>
          </div>
          <button onClick={logout} title="Sign out" className="mt-1 flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg md:justify-center lg:justify-start">
            <LogOut className="size-5 shrink-0" />
            <span className="md:hidden lg:inline">Sign out</span>
          </button>
        </div>
      </aside>

      <div className="md:pl-[76px] lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-6">
          <button className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-2 md:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <h2 className="truncate text-sm font-medium text-muted">{current?.label ?? "Workora"}</h2>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={toggle} className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Toggle theme">
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
