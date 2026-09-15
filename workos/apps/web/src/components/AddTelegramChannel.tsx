"use client";

import { useEffect, useState } from "react";

import type { TelegramConversation } from "@workos/types";

import { api, ApiError, type TelegramAccountDTO } from "@/lib/api";
import { Avatar } from "./Avatar";

type Step = "connect" | "code" | "twofa" | "select" | "configure";

// "Add Telegram Channel" flow (ТЗ §7). Operates against the live Work backend;
// the demo workspace is offline, so this surfaces a clear notice there.
export function AddTelegramChannel({
  workspaceId,
  onClose,
  onAdded,
}: {
  workspaceId: string;
  onClose: () => void;
  onAdded?: (channelId: string) => void;
}) {
  const [step, setStep] = useState<Step>("connect");
  const [account, setAccount] = useState<TelegramAccountDTO | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [chats, setChats] = useState<TelegramConversation[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<TelegramConversation | null>(null);
  const [projectName, setProjectName] = useState("");
  const [channelName, setChannelName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Determine the starting step from the account status.
  useEffect(() => {
    api
      .telegramAccount()
      .then(({ account }) => {
        setAccount(account);
        setStep(account?.status === "connected" ? "select" : "connect");
      })
      .catch((e: unknown) => setError(friendly(e)));
  }, []);

  // Load conversations when entering the selector.
  useEffect(() => {
    if (step !== "select") return;
    const t = setTimeout(() => {
      api
        .chats(search)
        .then(({ chats }) => setChats(chats))
        .catch((e: unknown) => setError(friendly(e)));
    }, 200);
    return () => clearTimeout(t);
  }, [step, search]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Add Telegram Channel</span>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-400">{error}</div>
          )}

          {step === "connect" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.requestCode(phone);
                  setStep("code");
                });
              }}
              className="space-y-3"
            >
              <p className="text-sm text-muted">Connect your Telegram account to pick a conversation.</p>
              <Field label="Phone number">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9665..." className={inputCls} />
              </Field>
              <PrimaryButton disabled={busy || !phone}>Send code</PrimaryButton>
            </form>
          )}

          {step === "code" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  try {
                    await api.signIn(phone, code);
                    setStep("select");
                  } catch (err) {
                    if (err instanceof ApiError && err.code === "password_required") {
                      setStep("twofa");
                    } else {
                      throw err;
                    }
                  }
                });
              }}
              className="space-y-3"
            >
              <Field label="Login code">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345" className={inputCls} />
              </Field>
              <PrimaryButton disabled={busy || !code}>Verify</PrimaryButton>
            </form>
          )}

          {step === "twofa" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.twoFactor(phone, code, password);
                  setStep("select");
                });
              }}
              className="space-y-3"
            >
              <Field label="Two-factor password">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              </Field>
              <PrimaryButton disabled={busy || !password}>Confirm</PrimaryButton>
            </form>
          )}

          {step === "select" && (
            <div className="space-y-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Telegram conversations"
                className={inputCls}
              />
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {chats.map((c) => (
                  <li key={`${c.accountId}:${c.peerId}`}>
                    <button
                      onClick={() => {
                        setPicked(c);
                        setChannelName(c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24));
                        setStep("configure");
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                    >
                      <Avatar name={c.title} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.title}</span>
                        <span className="block truncate text-xs text-muted">
                          {c.chatType}
                          {c.username ? ` · @${c.username}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {chats.length === 0 && <li className="px-2 py-4 text-sm text-muted">No conversations found.</li>}
              </ul>
            </div>
          )}

          {step === "configure" && picked && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const { channel } = await api.importChannel({
                    workspaceId,
                    newProjectName: projectName || undefined,
                    channelName: channelName || picked.title,
                    peerId: picked.peerId,
                    chatType: picked.chatType,
                    title: picked.title,
                  });
                  onAdded?.(channel.id);
                  onClose();
                });
              }}
              className="space-y-3"
            >
              <div className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                <span className="text-muted">Telegram source: </span>
                {picked.title}
              </div>
              <Field label="Project (new)">
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Ha'il Airport" className={inputCls} />
              </Field>
              <Field label="Channel name">
                <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="general" className={inputCls} />
              </Field>
              <p className="text-xs text-muted">
                The channel name is independent of the Telegram title and can be changed anytime.
              </p>
              <PrimaryButton disabled={busy || !channelName}>Create channel</PrimaryButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function PrimaryButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// Map backend error codes to human copy (ТЗ §49 — never show raw errors).
function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "Telegram account not connected":
        return "Connect your Telegram account first.";
      case "Telegram service unavailable":
        return "Telegram service is temporarily unavailable. Try again.";
      case "worker_unavailable":
        return "Telegram service is unreachable.";
      case "Could not load Telegram conversations":
        return "Couldn't load your conversations.";
      case "Forbidden":
        return "You don't have permission to add channels here.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return "Network error. Check your connection.";
}
