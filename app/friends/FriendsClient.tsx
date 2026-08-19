"use client";

import { useEffect, useState, useTransition } from "react";
import { UserPlus, Users, Inbox, Check, X, Loader2, Flame, TrendingUp, Trash2 } from "lucide-react";
import { useLanguage } from "@/app/_components/LanguageContext";
import type { Friend, FriendRequest, FriendProgress } from "@/lib/types";
import {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  getFriends,
  getOutgoingRequests,
  getFriendProgress,
} from "@/app/actions/friends";

type Tab = "friends" | "requests" | "add";

interface Props {
  initialFriends: Friend[];
  initialIncoming: FriendRequest[];
  initialOutgoing: FriendRequest[];
  initialProgress: Record<string, FriendProgress>;
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="w-11 h-11 rounded-full object-cover ring-1 ring-[var(--color-border)] shrink-0" />;
  }
  return (
    <div className="w-11 h-11 rounded-full bg-violet-700 flex items-center justify-center text-lg font-semibold text-white shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function FriendsClient({ initialFriends, initialIncoming, initialOutgoing, initialProgress }: Props) {
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<Tab>(initialIncoming.length > 0 ? "requests" : "friends");
  const [friends, setFriends] = useState(initialFriends);
  const [incoming, setIncoming] = useState(initialIncoming);
  const [outgoing, setOutgoing] = useState(initialOutgoing);
  const [progress, setProgress] = useState(initialProgress);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);
  const [, startTransition] = useTransition();

  // Marks "now" as seen — clears the profile badge's "newly accepted friend"
  // count (see getFriendNotificationCount) the moment this page is opened.
  // Incoming requests aren't cookie-gated at all; they clear themselves by
  // leaving the pending set on accept/decline.
  useEffect(() => {
    document.cookie = `sm_friends_seen_at=${encodeURIComponent(new Date().toISOString())}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  function withBusy(id: string, run: () => Promise<void>) {
    setBusyIds((prev) => new Set(prev).add(id));
    run().finally(() => {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  async function refreshFriendsAndProgress() {
    const fresh = await getFriends();
    setFriends(fresh);
    const missing = fresh.filter((f) => !(f.friendId in progress));
    if (missing.length === 0) return;
    const entries = await Promise.all(
      missing.map(async (f): Promise<[string, FriendProgress]> => [f.friendId, await getFriendProgress(f.friendId)])
    );
    setProgress((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }

  function handleSend() {
    setSending(true);
    setAddError(null);
    setAddSuccess(false);
    startTransition(async () => {
      try {
        const result = await sendFriendRequest(email.trim());
        if (!result.ok) {
          setAddError(result.error);
          return;
        }
        setEmail("");
        setAddSuccess(true);
        // Covers both "sent a new request" (shows up under outgoing) and
        // "they'd already requested us, so this accepted theirs instead"
        // (shows up under friends) — refreshing both is cheap and correct
        // either way, without the action needing to say which happened.
        await Promise.all([refreshFriendsAndProgress(), getOutgoingRequests().then(setOutgoing)]);
      } finally {
        setSending(false);
      }
    });
  }

  function handleAccept(req: FriendRequest) {
    withBusy(req.requestId, async () => {
      await acceptFriendRequest(req.requestId);
      setIncoming((prev) => prev.filter((r) => r.requestId !== req.requestId));
      await refreshFriendsAndProgress();
    });
  }

  function handleDecline(req: FriendRequest) {
    withBusy(req.requestId, async () => {
      await declineFriendRequest(req.requestId);
      setIncoming((prev) => prev.filter((r) => r.requestId !== req.requestId));
    });
  }

  function handleCancel(req: FriendRequest) {
    withBusy(req.requestId, async () => {
      await cancelFriendRequest(req.requestId);
      setOutgoing((prev) => prev.filter((r) => r.requestId !== req.requestId));
    });
  }

  function handleRemove(friend: Friend) {
    withBusy(friend.requestId, async () => {
      await removeFriend(friend.requestId);
      setFriends((prev) => prev.filter((f) => f.friendId !== friend.friendId));
      setProgress((prev) => {
        const next = { ...prev };
        delete next[friend.friendId];
        return next;
      });
      setConfirmingRemove(null);
    });
  }

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" });

  const requestCount = incoming.length;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold px-1">{t.friendsPageTitle}</h1>

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)]">
        {([
          { id: "friends" as Tab, label: t.friendsTabFriends, icon: Users },
          { id: "requests" as Tab, label: t.friendsTabRequests, icon: Inbox },
          { id: "add" as Tab, label: t.friendsTabAdd, icon: UserPlus },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              tab === id
                ? "bg-violet-700 text-white"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            <Icon size={15} />
            {label}
            {id === "requests" && requestCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
                {requestCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Friends tab ── */}
      {tab === "friends" && (
        <div className="flex flex-col gap-2">
          {friends.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] px-1 py-6 text-center">{t.friendsEmptyFriends}</p>
          ) : (
            friends.map((f) => {
              const p = progress[f.friendId];
              const busy = busyIds.has(f.requestId);
              const confirming = confirmingRemove === f.friendId;
              return (
                <div
                  key={f.friendId}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 flex flex-col gap-3"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={f.displayName} url={f.avatarUrl} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-[var(--color-text-primary)] truncate">{f.displayName}</div>
                      {f.since && <div className="text-[11px] text-[var(--color-text-muted)]">{t.friendSince(dateFmt(f.since))}</div>}
                    </div>
                    {!confirming ? (
                      <button
                        onClick={() => setConfirmingRemove(f.friendId)}
                        disabled={busy}
                        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                        title={t.removeFriendBtn}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <div className="shrink-0 flex items-center gap-1">
                        <button
                          onClick={() => setConfirmingRemove(null)}
                          className="px-2 py-1 rounded-lg text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                        >
                          {t.cancel}
                        </button>
                        <button
                          onClick={() => handleRemove(f)}
                          disabled={busy}
                          className="px-2 py-1 rounded-lg text-xs bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1 disabled:opacity-50"
                        >
                          {busy && <Loader2 size={11} className="animate-spin" />}
                          {t.removeFriendBtn}
                        </button>
                      </div>
                    )}
                  </div>

                  {p && (
                    <div className="flex items-center gap-4 pl-[3.5rem] text-xs text-[var(--color-text-secondary)]">
                      <span className="flex items-center gap-1">
                        <TrendingUp size={12} className="text-blue-500" />
                        {p.currentHSK != null ? `HSK ${(p.currentHSK + p.currentLevelMasteryPct / 100).toFixed(1)}` : "–"}
                      </span>
                      <span>{t.friendWordsTracked(p.wordsTracked)}</span>
                      <span className="flex items-center gap-1">
                        <Flame size={12} className={p.streak.current > 0 ? "text-amber-500" : "text-[var(--color-text-muted)]"} />
                        {p.streak.current > 0 ? t.friendStreakDays(p.streak.current) : t.friendNoStreak}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Requests tab ── */}
      {tab === "requests" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-1">{t.friendsIncomingTitle}</h2>
            {incoming.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] px-1 py-3">{t.friendsEmptyIncoming}</p>
            ) : (
              incoming.map((r) => {
                const busy = busyIds.has(r.requestId);
                return (
                  <div key={r.requestId} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 flex items-center gap-3">
                    <Avatar name={r.displayName} url={r.avatarUrl} />
                    <div className="flex-1 min-w-0 font-medium text-sm text-[var(--color-text-primary)] truncate">{r.displayName}</div>
                    <button
                      onClick={() => handleDecline(r)}
                      disabled={busy}
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title={t.declineRequestBtn}
                    >
                      <X size={16} />
                    </button>
                    <button
                      onClick={() => handleAccept(r)}
                      disabled={busy}
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      title={t.acceptRequestBtn}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide px-1">{t.friendsOutgoingTitle}</h2>
            {outgoing.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] px-1 py-3">{t.friendsEmptyOutgoing}</p>
            ) : (
              outgoing.map((r) => {
                const busy = busyIds.has(r.requestId);
                return (
                  <div key={r.requestId} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 flex items-center gap-3">
                    <Avatar name={r.displayName} url={r.avatarUrl} />
                    <div className="flex-1 min-w-0 font-medium text-sm text-[var(--color-text-primary)] truncate">{r.displayName}</div>
                    <button
                      onClick={() => handleCancel(r)}
                      disabled={busy}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {busy && <Loader2 size={11} className="animate-spin" />}
                      {t.cancelRequestBtn}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Add tab ── */}
      {tab === "add" && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
          <div>
            <div className="font-medium text-sm text-[var(--color-text-primary)]">{t.addFriendTitle}</div>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t.addFriendDesc}</p>
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setAddError(null); setAddSuccess(false); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !sending && email.trim()) handleSend(); }}
            placeholder={t.addFriendPlaceholder}
            className="w-full px-3 py-2.5 rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-400 transition-colors"
          />
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          {addSuccess && <p className="text-xs text-emerald-600">{t.addFriendSuccess}</p>}
          <button
            onClick={handleSend}
            disabled={sending || !email.trim()}
            className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending && <Loader2 size={14} className="animate-spin" />}
            {sending ? t.addFriendSending : t.addFriendButton}
          </button>
        </div>
      )}
    </div>
  );
}
