"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Lock, ShieldCheck } from "lucide-react";

interface AuthStatusResponse {
  dbUnavailable?: boolean;
  needsSetup?: boolean;
  authenticated?: boolean;
  error?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: AuthStatusResponse) => {
        setStatus(data);
        if (data.authenticated) {
          router.replace("/");
        }
      })
      .catch(() => setStatus({ dbUnavailable: true }));
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = status?.needsSetup
        ? "/api/auth/setup"
        : "/api/auth/login";
      const payload = status?.needsSetup
        ? { email, fullName, password }
        : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Authentication failed");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error while contacting authentication service.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] px-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
        <div className="mb-6 flex items-center gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)]">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">MC QoS Intelligence</h1>
            <p className="text-xs text-[var(--text-secondary)]">
              MediaCore SMS Analytics Platform
            </p>
          </div>
        </div>

        {status === null ? (
          <p className="text-xs text-[var(--text-secondary)]">
            Checking platform status...
          </p>
        ) : status.dbUnavailable ? (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-semibold">Application database requires setup</p>
            {status.error ? <p>{status.error}</p> : null}
            <p className="opacity-85">
              Locally, verify <code className="rounded bg-black/10 px-1 py-0.5">.env</code>. On Vercel, link Neon Free PostgreSQL in Vercel Storage (<code className="rounded bg-black/10 px-1 py-0.5">DATABASE_URL</code>).
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              {status.needsSetup ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>First-Run Setup: Create Admin Account</span>
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Sign in to Operations Workspace</span>
                </>
              )}
            </div>

            {status.needsSetup ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Operations Lead"
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@company.local"
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                Password {status.needsSetup ? "(min 8 characters)" : ""}
              </label>
              <input
                type="password"
                required
                minLength={status.needsSetup ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
            </div>

            {error ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-200"
            >
              {submitting
                ? "Submitting..."
                : status.needsSetup
                ? "Create Admin & Launch Platform"
                : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
