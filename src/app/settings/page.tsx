"use client";

import React, { useEffect, useState } from "react";
import { Plus, Shield, Sliders, Users } from "lucide-react";

interface UserRecord {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login_at: string | null;
  roles: string[];
}

interface StatusRuleRow {
  id: number;
  rule_name: string;
  match_submit_status: string | null;
  match_dlr_state: string | null;
  normalized_status: string;
  is_terminal: boolean;
  priority: number;
}

export default function SettingsPage() {
  const [maskPii, setMaskPii] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [prefSaved, setPrefSaved] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"analyst" | "operator" | "viewer">("analyst");
  const [userMsg, setUserMsg] = useState<string | null>(null);

  const [rules, setRules] = useState<StatusRuleRow[]>([]);

  useEffect(() => {
    fetch("/api/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.preferences) {
          setMaskPii(d.preferences.maskSensitiveIdentifiers);
          setPageSize(d.preferences.defaultPageSize);
          setTheme(d.preferences.theme);
        }
      })
      .catch(() => undefined);

    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.users) setUsers(d.users);
      })
      .catch(() => undefined);

    fetch("/api/settings/status-rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.rules) setRules(d.rules);
      })
      .catch(() => undefined);
  }, []);

  const savePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefSaved(null);
    const res = await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme,
        maskSensitiveIdentifiers: maskPii,
        defaultPageSize: Number(pageSize),
      }),
    });
    if (res.ok) {
      setPrefSaved("Preferences saved to PostgreSQL.");
    } else {
      setPrefSaved("Failed to save preferences (ensure signed in).");
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMsg(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: newEmail,
        fullName: newName,
        password: newPassword,
        role: newRole,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setUserMsg(data.error ?? "Failed to create user");
      return;
    }
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    setUserMsg("User account created.");
    const listRes = await fetch("/api/users");
    if (listRes.ok) {
      const listData = (await listRes.json()) as { users: UserRecord[] };
      setUsers(listData.users);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-b border-[var(--border-subtle)] pb-4">
        <h1 className="text-xl font-semibold tracking-tight">Platform Settings</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Manage display preferences, PII masking, team access, and MediaCore status classification rules.
        </p>
      </div>

      {/* User Preferences */}
      <form
        onSubmit={savePreferences}
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
      >
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Sliders className="h-4 w-4" />
          <span>Workspace Preferences</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">
              Default Theme
            </label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-xs"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">
              Explorer Page Size
            </label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-2 text-xs"
            >
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
              <option value={250}>250 rows</option>
            </select>
          </div>

          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={maskPii}
                onChange={(e) => setMaskPii(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border-subtle)]"
              />
              <span>Mask sensitive ANIs / MSISDNs</span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">
            {prefSaved ?? ""}
          </span>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950"
          >
            Save Preferences
          </button>
        </div>
      </form>

      {/* MediaCore Status Classification Rules */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4" />
          <span>MediaCore Status &amp; DLR State Classification Rules</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                <th className="py-2 pr-3">Rule</th>
                <th className="py-2 pr-3">Submit Status</th>
                <th className="py-2 pr-3">DLR State</th>
                <th className="py-2 pr-3">Normalized Category</th>
                <th className="py-2 pr-3">Terminal?</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border-subtle)]">
                  <td className="py-2 pr-3 font-medium">{r.rule_name}</td>
                  <td className="py-2 pr-3 font-mono">
                    {r.match_submit_status === "" ? "(empty)" : r.match_submit_status ?? "*"}
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    {r.match_dlr_state === "" ? "(empty)" : r.match_dlr_state ?? "*"}
                  </td>
                  <td className="py-2 pr-3 font-semibold">{r.normalized_status}</td>
                  <td className="py-2 pr-3">{r.is_terminal ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Team Users (Admin view) */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" />
          <span>Team Access (1–2 Users)</span>
        </div>

        {users.length > 0 ? (
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Roles</th>
                  <th className="py-2 pr-3">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--border-subtle)]">
                    <td className="py-2 pr-3 font-medium">{u.full_name}</td>
                    <td className="py-2 pr-3">{u.email}</td>
                    <td className="py-2 pr-3">{u.roles.join(", ")}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleString()
                        : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mb-4 text-xs text-[var(--text-secondary)]">
            Admin privileges required to list or create team accounts.
          </p>
        )}

        <form onSubmit={handleCreateUser} className="grid gap-3 border-t border-[var(--border-subtle)] pt-4 sm:grid-cols-5">
          <input
            type="text"
            required
            placeholder="Full Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          />
          <input
            type="email"
            required
            placeholder="Email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (8+ chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          />
          <select
            value={newRole}
            onChange={(e) =>
              setNewRole(e.target.value as "analyst" | "operator" | "viewer")
            }
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs"
          >
            <option value="analyst">Analyst</option>
            <option value="operator">Operator</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1.5 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" /> Add User
          </button>
        </form>
        {userMsg ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">{userMsg}</p>
        ) : null}
      </div>
    </div>
  );
}
