"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Trash2, Loader2 } from "lucide-react";

interface TokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export function ExtensionSettingsClient() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";

  async function loadTokens() {
    setLoading(true);
    try {
      const res = await fetch("/api/extension/tokens");
      const data = await res.json();
      setTokens(data.tokens ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTokens();
  }, []);

  async function handleCreate() {
    setCreating(true);
    setFreshToken(null);
    try {
      const res = await fetch("/api/extension/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.token) {
        setFreshToken(data.token);
        await loadTokens();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setTokens((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/extension/tokens/${id}`, { method: "DELETE" }).catch(() => {});
  }

  function copyToken() {
    if (!freshToken) return;
    navigator.clipboard.writeText(freshToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Setup steps */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 text-sm text-[var(--color-text-secondary)]">
        <div className="font-medium text-[var(--color-text-primary)]">Setup</div>
        <ol className="list-decimal list-inside flex flex-col gap-1.5">
          <li>Install the extension (load unpacked from the <code className="text-xs bg-[var(--color-background)] px-1 py-0.5 rounded">extension/</code> folder in this project).</li>
          <li>Click the extension icon → <span className="text-[var(--color-text-primary)]">Settings</span>.</li>
          <li>Generate a token below, then paste it — and the server URL — into the extension.</li>
        </ol>
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-xs text-[var(--color-text-muted)]">Server URL</span>
          <code className="text-xs bg-[var(--color-background)] px-2 py-1.5 rounded-lg break-all">{serverUrl}</code>
        </div>
      </div>

      {/* Fresh token reveal */}
      {freshToken && (
        <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 flex flex-col gap-2">
          <div className="text-sm font-medium text-violet-800">New token — copy it now, it won't be shown again</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-violet-200 px-2 py-1.5 rounded-lg break-all">{freshToken}</code>
            <button
              onClick={copyToken}
              className="shrink-0 w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-700 flex items-center justify-center text-white transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Create button */}
      <button
        onClick={handleCreate}
        disabled={creating}
        className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {creating && <Loader2 size={14} className="animate-spin" />}
        Generate new token
      </button>

      {/* Token list */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Active tokens</span>
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No tokens yet.</p>
        ) : (
          tokens.map((tok) => (
            <div
              key={tok.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm text-[var(--color-text-primary)] truncate">{tok.label}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Created {new Date(tok.created_at).toLocaleDateString()}
                  {tok.last_used_at && ` · last used ${new Date(tok.last_used_at).toLocaleDateString()}`}
                </div>
              </div>
              <button
                onClick={() => handleRevoke(tok.id)}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
                title="Revoke"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
