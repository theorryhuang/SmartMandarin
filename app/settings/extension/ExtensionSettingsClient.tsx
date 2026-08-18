"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Trash2, Loader2, Download, Plug } from "lucide-react";
import { useLanguage } from "@/app/_components/LanguageContext";
import { useHasExtension } from "@/lib/useHasExtension";

interface TokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Hands a freshly-minted token to the extension without the user ever
 * seeing/copying it, and waits for the extension to actually finish
 * connecting with it (background.js calls the server itself before acking —
 * see connectFromSite in background.js) — no click inside the extension's
 * own UI needed. Not a direct chrome.runtime.sendMessage(extensionId, …) —
 * that needs the extension to declare `externally_connectable`, and Chrome
 * rejects match patterns broad enough to cover every origin, which is what
 * self-hosting would need since the server's domain isn't known at the
 * extension's build time. Instead this posts to `window`, and the
 * extension's content script (already injected on every page) relays it to
 * its own background script and posts back an ack once connected (see
 * content.js). Resolves `null` — not a rejection — when nothing acks in
 * time, whether that's a non-Chromium browser, the extension not being
 * installed, or its content script not having loaded yet on this page.
 */
function sendToExtension(payload: { serverUrl: string; token: string }): Promise<{ ok: boolean; message?: string } | null> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    let settled = false;

    function finish(result: { ok: boolean; message?: string } | null) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "smartmandarin-extension" || data.type !== "connectExtensionAck") return;
      if (data.requestId !== requestId) return;
      console.log("[SmartMandarin] connect: got ack from extension:", data);
      finish({ ok: !!data.ok, message: data.message });
    }

    window.addEventListener("message", onMessage);
    // Generous timeout — unlike the old prefill-only handoff, the ack now
    // waits on background.js actually calling the server first.
    const timer = setTimeout(() => {
      console.warn("[SmartMandarin] connect: no ack from extension within 10s — content.js not present/listening on this tab?");
      finish(null);
    }, 10000);
    console.log("[SmartMandarin] connect: posting connect request", { requestId, serverUrl: payload.serverUrl });
    window.postMessage(
      { source: "smartmandarin-site", type: "connectExtension", requestId, serverUrl: payload.serverUrl, token: payload.token },
      window.location.origin
    );
  });
}

export function ExtensionSettingsClient() {
  const { t } = useLanguage();
  const hasExtension = useHasExtension();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<{ ok: boolean; message: string } | null>(null);
  // Read in an effect, not during render — `window` is already defined by
  // the time this client component's first render runs (hydration happens
  // in the browser), so reading it inline made that first render disagree
  // with the server's SSR pass (which always sees "") and triggered a
  // hydration mismatch. Starting both at "" and filling in after mount
  // keeps them in sync.
  const [serverUrl, setServerUrl] = useState("");
  useEffect(() => {
    setServerUrl(window.location.origin);
  }, []);

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

  /**
   * Zero-click connect: mints a token server-side (same endpoint the manual
   * flow below uses) and hands it to the extension, which calls the server
   * itself and only acks once actually connected — no token ever visible
   * here, no separate click inside the extension's own UI either.
   */
  async function handleConnect() {
    if (!serverUrl) return;
    // hasExtension means content.js has already marked *this* page — if it
    // hasn't, sendToExtension's 10s wait is a foregone conclusion: content
    // scripts only inject on an actual page load, so a tab opened before the
    // extension was installed/reloaded (the common case coming from
    // onboarding — download, install in a *different* tab, come back to
    // this one) never got it and never will until this tab itself reloads.
    // Skip the pointless wait and say so directly instead of the generic
    // "couldn't reach the extension" message that follows a real timeout.
    if (!hasExtension) {
      setConnectStatus({ ok: false, message: t.extConnectReloadHint });
      return;
    }
    setConnecting(true);
    setConnectStatus(null);
    try {
      const res = await fetch("/api/extension/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Browser extension" }),
      });
      const data = await res.json();
      if (!data.token) {
        setConnectStatus({ ok: false, message: t.extConnectFailed });
        return;
      }
      const result = await sendToExtension({ serverUrl, token: data.token });
      if (result?.ok) {
        setConnectStatus({ ok: true, message: t.extConnectSuccess });
        await loadTokens();
      } else {
        setConnectStatus({ ok: false, message: result?.message || t.extConnectUnreachable });
      }
    } catch {
      setConnectStatus({ ok: false, message: t.extConnectFailed });
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Download */}
      <a
        href="/smartmandarin-extension.zip"
        download
        className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        <Download size={15} />
        {t.extDownloadBtn}
      </a>

      {/* Setup steps */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3 text-sm text-[var(--color-text-secondary)]">
        <div className="font-medium text-[var(--color-text-primary)]">{t.extSetupTitle}</div>
        <ol className="list-decimal list-inside flex flex-col gap-1.5">
          <li>{t.extStep1}</li>
          <li>
            {t.extStep2Open} <code className="text-xs bg-[var(--color-background)] px-1 py-0.5 rounded">chrome://extensions</code>,
            {" "}{t.extStep2TurnOn} <span className="text-[var(--color-text-primary)]">{t.extStep2DevMode}</span> {t.extStep2TopRightThen}{" "}
            <span className="text-[var(--color-text-primary)]">{t.extStep2LoadUnpacked}</span> {t.extStep2SelectFolder}
          </li>
          <li>{t.extStep4}</li>
        </ol>
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-xs text-[var(--color-text-muted)]">{t.extServerUrlLabel}</span>
          <code className="text-xs bg-[var(--color-background)] px-2 py-1.5 rounded-lg break-all">{serverUrl}</code>
        </div>
      </div>

      {/* One-click connect */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleConnect}
          disabled={connecting || !serverUrl}
          className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {connecting ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
          {connecting ? t.extConnecting : t.extConnectBtn}
        </button>
        {!hasExtension && !connectStatus && (
          <p className="text-xs text-[var(--color-text-muted)]">{t.extConnectInstallFirst}</p>
        )}
        {connectStatus && (
          <p className={`text-xs ${connectStatus.ok ? "text-emerald-600" : "text-red-500"}`}>{connectStatus.message}</p>
        )}
      </div>

      {/* Fresh token reveal (manual flow) */}
      {freshToken && (
        <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 flex flex-col gap-2">
          <div className="text-sm font-medium text-violet-800">{t.extNewTokenTitle}</div>
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

      {/* Manual/advanced setup — fallback for non-Chromium browsers, or when
          the one-click connect above can't reach the extension */}
      <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-secondary)]">
        <summary className="cursor-pointer font-medium text-[var(--color-text-primary)]">{t.extAdvancedManual}</summary>
        <div className="flex flex-col gap-3 pt-3">
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-2.5 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-background)] text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {t.extGenerateToken}
          </button>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">{t.extActiveTokens}</span>
            {loading ? (
              <p className="text-sm text-[var(--color-text-muted)]">{t.loading}</p>
            ) : tokens.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">{t.extNoTokens}</p>
            ) : (
              tokens.map((tok) => (
                <div
                  key={tok.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--color-text-primary)] truncate">{tok.label}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {t.extTokenCreated(new Date(tok.created_at).toLocaleDateString())}
                      {tok.last_used_at && t.extTokenLastUsed(new Date(tok.last_used_at).toLocaleDateString())}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(tok.id)}
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
                    title={t.extRevokeTitle}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
