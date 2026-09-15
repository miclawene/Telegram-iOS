"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useRefreshWorkspace } from "@/lib/live";

// Email + password sign-in / sign-up against the Work backend. On success the
// backend sets an httpOnly session cookie and we return to the workspace.
export default function LoginPage() {
  const router = useRouter();
  const refresh = useRefreshWorkspace();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await api.register(email, name, password);
        // First workspace so the app has somewhere to land.
        await api.createWorkspace(`${name || "My"} Workspace`);
      } else {
        await api.login(email, password);
      }
      refresh();
      router.push("/");
    } catch (err) {
      setError(friendly(err, mode));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-accent-fg">
            C
          </div>
          <span className="text-lg font-semibold">Cityscape</span>
        </div>

        <p className="text-sm text-muted">
          {mode === "login" ? "Sign in to your workspace." : "Create your account."}
        </p>

        {error && (
          <div className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-400">{error}</div>
        )}

        {mode === "register" && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className={inputCls}
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
          className={inputCls}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "Password (min 8 characters)" : "Password"}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          minLength={mode === "register" ? 8 : 1}
          className={inputCls}
        />

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="w-full text-center text-xs text-muted hover:text-text"
        >
          {mode === "login" ? "No account? Create one" : "Have an account? Sign in"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/")}
          className="w-full text-center text-xs text-muted hover:text-text"
        >
          Continue with demo workspace
        </button>
      </form>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

function friendly(err: unknown, mode: "login" | "register"): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Wrong email or password.";
    if (err.status === 409) return "This email is already registered.";
    if (err.status === 400) return mode === "register" ? "Check your name, email and password." : "Check your input.";
  }
  return "Can't reach the server. Is the backend running?";
}
