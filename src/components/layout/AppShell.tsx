"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Building2,
  Database,
  FileSpreadsheet,
  Globe2,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  Network,
  PhoneCall,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  TrendingUp,
  UploadCloud,
  User,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Upload CSV", href: "/upload", icon: UploadCloud },
  { label: "OP Analytics", href: "/op-analytics", icon: Network },
  { label: "TP Analytics", href: "/tp-analytics", icon: BarChart3 },
  { label: "Applicant Analytics", href: "/applicant-analytics", icon: Building2 },
  { label: "ANI Analytics", href: "/ani-analytics", icon: PhoneCall },
  { label: "Geographic Analytics", href: "/geographic-analytics", icon: Globe2 },
  { label: "Rejection Intelligence", href: "/rejection-intelligence", icon: ShieldAlert },
  { label: "Performance Monitoring", href: "/performance-monitoring", icon: Activity },
  { label: "Message Explorer", href: "/message-explorer", icon: Search },
  { label: "Historical Comparison", href: "/historical-comparison", icon: TrendingUp },
  { label: "Upload History", href: "/history", icon: History },
  { label: "Reports", href: "/reports", icon: FileSpreadsheet },
  { label: "Settings", href: "/settings", icon: Settings },
];

interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  roles: string[];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "db_error">(
    pathname === "/login" ? "authenticated" : "checking"
  );
  const [dbErrorMsg, setDbErrorMsg] = useState<string | null>(null);
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("mc-qos-theme");
    const prefersDark =
      saved === "dark" ||
      (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
  }, []);

  useEffect(() => {
    if (pathname === "/login") {
      setAuthState("authenticated");
      return;
    }
    fetch("/api/health", { cache: "no-store" })
      .then((r) => setHealthOk(r.ok))
      .catch(() => setHealthOk(false));

    fetch("/api/auth/status", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (data: {
          authenticated?: boolean;
          dbUnavailable?: boolean;
          error?: string;
          user?: SessionUser | null;
        }) => {
          if (data.dbUnavailable) {
            setDbErrorMsg(data.error ?? "Application database unavailable");
            setAuthState("db_error");
            return;
          }
          if (!data.authenticated) {
            router.replace("/login");
            return;
          }
          setUser(data.user ?? null);
          setAuthState("authenticated");
          fetch("/api/datasets", { cache: "no-store" })
            .then((u) => (u.ok ? u.json() : null))
            .then((d: { datasets?: Array<unknown> } | null) => {
              if (d?.datasets) setDatasetCount(d.datasets.length);
            })
            .catch(() => undefined);
        }
      )
      .catch(() => {
        setDbErrorMsg("Failed to check session status.");
        setAuthState("db_error");
      });
  }, [pathname, router]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("mc-qos-theme", next ? "dark" : "light");
    if (user) {
      void fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next ? "dark" : "light" }),
      });
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.replace("/login");
  };

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Left Navigation Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:flex lg:flex-col">
        <div className="flex h-14 items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
          <Database className="h-5 w-5 text-slate-700 dark:text-slate-200" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              MC QoS Intelligence
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              MediaCore XDR Analytics
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
          <span>Zero-Docker ($0/mo)</span>
          <span className="inline-flex items-center gap-1">
            <span
              className={`h-2 w-2 rounded-full ${
                healthOk === true
                  ? "bg-emerald-500"
                  : healthOk === false
                  ? "bg-rose-500"
                  : "bg-slate-400"
              }`}
            />
            {healthOk === true ? "Online" : healthOk === false ? "Degraded" : "..."}
          </span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 lg:px-6">
          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <Link
              href="/history"
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2.5 py-1 font-medium text-[var(--text-primary)] hover:opacity-80"
            >
              {datasetCount === null
                ? "Datasets: —"
                : `Active Datasets: ${datasetCount}`}
            </Link>
            <Link
              href="/upload"
              className="hidden rounded border border-[var(--border-subtle)] px-2.5 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-muted)] sm:inline"
            >
              + Upload CSV
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle Light/Dark theme"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
            >
              {dark ? (
                <>
                  <Sun className="h-3.5 w-3.5" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5" />
                  <span>Dark</span>
                </>
              )}
            </button>

            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-2.5 py-1 text-xs sm:inline-flex">
                  <User className="h-3.5 w-3.5" />
                  <span>{user.fullName}</span>
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign Out"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 text-xs hover:bg-[var(--bg-muted)]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          {authState === "checking" ? (
            <div className="mx-auto max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-center text-xs text-[var(--text-secondary)]">
              Verifying workspace session...
            </div>
          ) : authState === "db_error" ? (
            <div className="mx-auto max-w-lg rounded-lg border border-rose-300 bg-rose-50 p-5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              <p className="font-semibold">Database Initialization Error</p>
              <p className="mt-1">{dbErrorMsg}</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
