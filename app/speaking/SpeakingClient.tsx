"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, ChevronLeft, LayoutList, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { useTurnPlayback } from "@/hooks/useTurnPlayback";
import { TranscriptView } from "@/components/TranscriptView";
import { getConversationContext } from "@/app/actions/vocabulary";
import { useWordPopup, WordPopupCard } from "@/components/WordPopup";
import { saveSpeakingTurns, loadRecentSpeakingTurns, getSpeakingConversationList, deleteSpeakingConversationTurns } from "@/app/actions/speaking";
import type { ConversationTurn, MasteryMap, TranscriptToken } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";
import { HomeButton } from "@/app/_components/HomeButton";

interface Props {
  masteryMap: MasteryMap;
}

interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// Keep at most this many turns in localStorage; older ones live in Supabase.
const MAX_LOCAL_TURNS = 60;

// Matches p_max_age in supabase/migrations/017_stale_conversation_cleanup.sql —
// a conversation the nightly cron has reaped server-side should also drop
// out of the locally-cached list (see the reconciliation effect below).
const STALE_CONVERSATION_MS = 14 * 24 * 60 * 60 * 1000;

function autoTitle(text: string): string {
  return text.length > 28 ? text.slice(0, 28) + "…" : text;
}

function loadTurns(convId: string): ConversationTurn[] {
  if (typeof window === "undefined" || !convId) return [];
  try {
    const raw = localStorage.getItem(`sm_speaking_conv_turns_${convId}`);
    return raw ? (JSON.parse(raw) as ConversationTurn[]) : [];
  } catch {
    return [];
  }
}

function loadRevealed(convId: string, turns: ConversationTurn[]): Set<number> {
  if (typeof window === "undefined" || !convId) return new Set();
  try {
    const raw = localStorage.getItem(`sm_speaking_revealed_${convId}`);
    if (!raw) return new Set();
    const timestamps = new Set(JSON.parse(raw) as string[]);
    const revealed = new Set<number>();
    turns.forEach((t, i) => { if (timestamps.has(t.timestamp)) revealed.add(i); });
    return revealed;
  } catch {
    return new Set();
  }
}

export function SpeakingClient({ masteryMap }: Props) {
  const router = useRouter();
  const { t } = useLanguage();

  // ── Multi-conversation state — mirrors ConversationClient.tsx's pattern,
  //    adapted for turns/speaking_turns instead of messages/chat_messages. ──
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>("");
  const [showChatList, setShowChatList] = useState(false);
  const activeConvIdRef = useRef<string>("");
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  // ── Turns for the active conversation ─────────────────────────────────────
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [revealedTurns, setRevealedTurns] = useState<Set<number>>(new Set());

  const [slangMode, setSlangMode] = useState(false);
  useEffect(() => {
    setSlangMode(localStorage.getItem("sm_slang_mode") === "1");
  }, []);
  const [speechRate, setSpeechRate] = useState(1);
  const [playingTurnIndex, setPlayingTurnIndex] = useState<number | null>(null);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const [forcedWords, setForcedWords] = useState<string[]>([]);
  // Seeded from masteryMap (fetched fresh from the DB on every SSR render of
  // this page) — previously seeded from getConversationContext()'s
  // unknownWords instead, which is a capped list of just the flagged/weak
  // words used for AI context, not the full saved-vocab set, so most saved
  // words never actually highlighted in the transcript.
  const [savedWords, setSavedWords] = useState<Set<string>>(
    () => new Set(Object.keys(masteryMap))
  );
  useEffect(() => {
    setSavedWords((prev) => {
      const next = new Set(prev);
      for (const hanzi of Object.keys(masteryMap)) next.add(hanzi);
      return next;
    });
  }, [masteryMap]);
  const [hskLevel, setHskLevel] = useState(1);
  const [unknownWords, setUnknownWords] = useState<
    { hanzi: string; pinyin: string; meaning: string }[]
  >([]);

  // Track which client_ids have been persisted to Supabase already — reset
  // on every conversation switch (see switchConversation et al. below).
  const persistedIdsRef = useRef<Set<string>>(new Set());
  const isFirstRender = useRef(true);

  // ── Init: migrate the old single-session format (one global transcript,
  //    no conversation concept), then load the conversation list —
  //    synchronous, no network wait. Must render whatever's cached locally
  //    instantly (same reasoning as ConversationClient's equivalent effect);
  //    DB reconciliation happens in a separate, non-blocking effect below. ──
  useEffect(() => {
    const oldTurns = localStorage.getItem("sm_speaking_turns");
    const existingConvs = localStorage.getItem("sm_speaking_conversations");

    if (oldTurns && !existingConvs) {
      const id = `sconv_${Date.now()}`;
      let parsedTurns: ConversationTurn[] = [];
      try { parsedTurns = JSON.parse(oldTurns); } catch {}
      const firstUser = parsedTurns.find((turn) => turn.role === "user");
      const title = firstUser ? autoTitle(firstUser.raw_text) : "";
      const meta: ConversationMeta = { id, title, createdAt: Date.now(), updatedAt: Date.now() };
      localStorage.setItem("sm_speaking_conversations", JSON.stringify([meta]));
      localStorage.setItem(`sm_speaking_conv_turns_${id}`, oldTurns);
      const oldRevealed = localStorage.getItem("sm_revealed_turns");
      if (oldRevealed) {
        localStorage.setItem(`sm_speaking_revealed_${id}`, oldRevealed);
        localStorage.removeItem("sm_revealed_turns");
      }
      localStorage.removeItem("sm_speaking_turns");
      localStorage.setItem("sm_speaking_active_conv", id);
    }

    let convs: ConversationMeta[] = [];
    try {
      const data = localStorage.getItem("sm_speaking_conversations");
      convs = data ? JSON.parse(data) : [];
    } catch {}

    let activeId = localStorage.getItem("sm_speaking_active_conv") ?? "";

    if (convs.length === 0) {
      const id = `sconv_${Date.now()}`;
      convs = [{ id, title: "", createdAt: Date.now(), updatedAt: Date.now() }];
      localStorage.setItem("sm_speaking_conversations", JSON.stringify(convs));
      activeId = id;
    }

    if (!activeId || !convs.find((c) => c.id === activeId)) {
      activeId = convs[0].id;
    }

    localStorage.setItem("sm_speaking_active_conv", activeId);

    const initTurns = loadTurns(activeId);
    setTurns(initTurns);
    setRevealedTurns(loadRevealed(activeId, initTurns));
    persistedIdsRef.current = new Set(initTurns.map((turn) => turn.timestamp));

    setConversations(convs);
    setActiveConvId(activeId);
  }, []);

  // ── If the active conversation has nothing cached locally, fall back to
  //    Supabase — covers a fresh device/browser/reinstalled PWA, or a
  //    conversation the reconciliation effect below just discovered. ──
  useEffect(() => {
    if (!activeConvId) return;
    if (localStorage.getItem(`sm_speaking_conv_turns_${activeConvId}`)) return;
    const id = activeConvId;
    let cancelled = false;
    loadRecentSpeakingTurns(MAX_LOCAL_TURNS, id)
      .then((loaded) => {
        if (cancelled || activeConvIdRef.current !== id || loaded.length === 0) return;
        setTurns(loaded);
        setRevealedTurns(new Set(loaded.map((_, i) => i)));
        persistedIdsRef.current = new Set(loaded.map((turn) => turn.timestamp));
        localStorage.setItem(`sm_speaking_conv_turns_${id}`, JSON.stringify(loaded));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeConvId]);

  // ── Background reconciliation with the database — same reasoning as
  //    ConversationClient's getConversationList() effect: never blocks what's
  //    already on screen — it only adds conversations local storage doesn't
  //    know about yet, and prunes ones the server no longer has (see below). ──
  useEffect(() => {
    let cancelled = false;
    getSpeakingConversationList()
      .then((remote) => {
        if (cancelled) return;
        const remoteIds = new Set(remote.map((r) => r.id));
        const cutoff = Date.now() - STALE_CONVERSATION_MS;
        setConversations((prev) => {
          const localIds = new Set(prev.map((c) => c.id));
          const additions = remote.filter((r) => !localIds.has(r.id));

          // Drop local entries the nightly cron has already reaped
          // server-side — stale *and* missing remotely, so a conversation
          // that simply hasn't synced yet (too new to have a server copy)
          // is never touched. The active conversation is exempted even if
          // it somehow qualifies, so it can't disappear out from under
          // whoever's looking at it right now.
          const keep = prev.filter(
            (c) => c.id === activeConvIdRef.current || remoteIds.has(c.id) || c.updatedAt >= cutoff
          );
          const keptIds = new Set(keep.map((c) => c.id));
          for (const c of prev) {
            if (!keptIds.has(c.id)) {
              localStorage.removeItem(`sm_speaking_conv_turns_${c.id}`);
              localStorage.removeItem(`sm_speaking_revealed_${c.id}`);
            }
          }

          if (additions.length === 0 && keep.length === prev.length) return prev;
          const merged = [...keep, ...additions].sort((a, b) => b.updatedAt - a.updatedAt);
          localStorage.setItem("sm_speaking_conversations", JSON.stringify(merged));
          return merged;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    getConversationContext().then(({ hskLevel, unknownWords }) => {
      setHskLevel(hskLevel);
      setUnknownWords(unknownWords);
    });
  }, []);

  // ── Persist turns whenever they change ───────────────────────────────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!activeConvId) return;

    // Save recent turns to localStorage
    const toStore = turns.slice(-MAX_LOCAL_TURNS);
    try {
      localStorage.setItem(`sm_speaking_conv_turns_${activeConvId}`, JSON.stringify(toStore));
    } catch { /* ignore quota errors */ }

    // Push any turns not yet in Supabase
    const newTurns = turns.filter((turn) => !persistedIdsRef.current.has(turn.timestamp));
    if (newTurns.length > 0) {
      saveSpeakingTurns(newTurns, activeConvId).catch(() => {});
      for (const turn of newTurns) persistedIdsRef.current.add(turn.timestamp);
    }
  }, [turns, activeConvId]);

  const handleTranscriptUpdate = useCallback(
    (tokens: TranscriptToken[], role: "user" | "assistant", rawText: string, audioUrl?: string) => {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role) {
          // Merge tokens into the existing turn (shouldn't normally happen but safe)
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              tokens: [...last.tokens, ...tokens],
              // A space keeps this from fusing two sentences together with
              // no boundary at all if this merge path is ever actually hit.
              raw_text: last.raw_text + " " + rawText,
            },
          ];
        }
        const newTurn: ConversationTurn = {
          role,
          tokens,
          raw_text: rawText,
          timestamp: new Date().toISOString(),
          audioUrl,
        };
        return [...prev, newTurn];
      });

      // Auto-title on first user turn; bump updatedAt on every one —
      // mirrors ConversationClient.tsx's sendMessage.
      if (role === "user") {
        const convId = activeConvIdRef.current;
        setConversations((prev) => {
          const isFirst = !prev.find((c) => c.id === convId)?.title;
          const updated = prev.map((c) =>
            c.id === convId
              ? { ...c, updatedAt: Date.now(), title: isFirst ? autoTitle(rawText) : c.title }
              : c
          );
          localStorage.setItem("sm_speaking_conversations", JSON.stringify(updated));
          return updated;
        });
      }
    },
    []
  );

  const handleAITurnEnd = useCallback(() => setForcedWords([]), []);

  useEffect(() => {
    if (!activeConvId) return;
    const timestamps = [...revealedTurns].map((i) => turns[i]?.timestamp).filter(Boolean);
    localStorage.setItem(`sm_speaking_revealed_${activeConvId}`, JSON.stringify(timestamps));
  }, [revealedTurns, turns, activeConvId]);

  const revealTurn = useCallback(
    (i: number) => setRevealedTurns((s) => new Set(s).add(i)),
    []
  );

  const hideTurn = useCallback(
    (i: number) => setRevealedTurns((s) => { const next = new Set(s); next.delete(i); return next; }),
    []
  );

  const { state, error, startRecording, stopRecording, cancel, resetHistory } = useVoiceConversation({
    slangMode,
    forcedWords,
    hskLevel,
    unknownWords,
    onTranscriptUpdate: handleTranscriptUpdate,
    onAITurnEnd: handleAITurnEnd,
    speechRate,
  });

  // Turn-replay playback (the per-turn Play/Pause button + speed slider) —
  // separate from the hook's own auto-speak-the-reply flow above, and
  // deliberately the *only* place touching window.speechSynthesis for it
  // (see useTurnPlayback's doc comment for why that matters).
  const turnPlayback = useTurnPlayback();

  // Re-seed the hook's AI-context history from whatever `turns` currently
  // holds — fires on every turn added (a no-op re-derivation of what the
  // hook just appended internally itself) AND on every conversation switch
  // (the case that actually matters: the hook only reads a seed once at
  // mount, so without this, switching conversations without remounting the
  // component would leave it talking with the *previous* conversation's
  // context).
  useEffect(() => {
    resetHistory(turns.slice(-20).map((turn) => ({ role: turn.role, content: turn.raw_text })));
  }, [turns, resetHistory]);

  const switchConversation = useCallback((convId: string) => {
    const currentId = activeConvIdRef.current;
    if (convId === currentId) { setShowChatList(false); return; }

    cancel(); // stop any in-flight recording/speaking before swapping context

    const newTurns = loadTurns(convId);
    setTurns(newTurns);
    setRevealedTurns(loadRevealed(convId, newTurns));
    persistedIdsRef.current = new Set(newTurns.map((turn) => turn.timestamp));
    setForcedWords([]);
    setActiveConvId(convId);
    localStorage.setItem("sm_speaking_active_conv", convId);
    setShowChatList(false);
    // If nothing's cached locally for convId, the activeConvId-keyed
    // backfill effect above picks it up from the DB automatically.
  }, [cancel]);

  const createNewConversation = useCallback(() => {
    const id = `sconv_${Date.now()}`;
    const meta: ConversationMeta = { id, title: "", createdAt: Date.now(), updatedAt: Date.now() };

    setConversations((prev) => {
      const updated = [meta, ...prev];
      localStorage.setItem("sm_speaking_conversations", JSON.stringify(updated));
      return updated;
    });

    cancel();
    setTurns([]);
    setRevealedTurns(new Set());
    persistedIdsRef.current = new Set();
    setForcedWords([]);
    setActiveConvId(id);
    localStorage.setItem("sm_speaking_active_conv", id);
    setShowChatList(false);
  }, [cancel]);

  const deleteConversation = useCallback((convId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Fire-and-forget: the local list below updates immediately regardless,
    // and this is what makes the deletion actually stick — without it the
    // conversation's speaking_turns rows survive server-side and
    // getSpeakingConversationList() resurrects it the next time it rebuilds
    // the list from the DB (fresh device, reinstalled PWA, or just a reload).
    deleteSpeakingConversationTurns(convId).catch((err) => console.error("[SmartMandarin] failed to delete conversation:", err));

    localStorage.removeItem(`sm_speaking_conv_turns_${convId}`);
    localStorage.removeItem(`sm_speaking_revealed_${convId}`);

    let remaining: ConversationMeta[] = [];
    try {
      const data = localStorage.getItem("sm_speaking_conversations");
      const all: ConversationMeta[] = data ? JSON.parse(data) : [];
      remaining = all.filter((c) => c.id !== convId);
    } catch {}

    localStorage.setItem("sm_speaking_conversations", JSON.stringify(remaining));
    setConversations(remaining);

    if (activeConvIdRef.current === convId) {
      cancel();
      if (remaining.length > 0) {
        const target = remaining[0];
        const newTurns = loadTurns(target.id);
        setTurns(newTurns);
        setRevealedTurns(loadRevealed(target.id, newTurns));
        persistedIdsRef.current = new Set(newTurns.map((turn) => turn.timestamp));
        setForcedWords([]);
        setActiveConvId(target.id);
        localStorage.setItem("sm_speaking_active_conv", target.id);
      } else {
        const newId = `sconv_${Date.now()}`;
        const meta: ConversationMeta = { id: newId, title: "", createdAt: Date.now(), updatedAt: Date.now() };
        localStorage.setItem("sm_speaking_conversations", JSON.stringify([meta]));
        localStorage.setItem("sm_speaking_active_conv", newId);
        setConversations([meta]);
        setTurns([]);
        setRevealedTurns(new Set());
        persistedIdsRef.current = new Set();
        setForcedWords([]);
        setActiveConvId(newId);
      }
    }
  }, [cancel]);

  // ── Word lookup popup — same useWordPopup/WordPopupCard the chatbot uses
  //    (hover/click, browser-extension deferral, per-sense add/remove, the
  //    decomposed-parts breakdown), replacing the old hand-rolled bottom
  //    sheet that just dumped every CEDICT sense concatenated into one
  //    paragraph and had no extension support at all. ──────────────────────
  const { popup, popupRef, showHover, hideHover, toggleClick, toggleSense, togglePartSense, navigateToWord, navigateToPart, resolveRange } = useWordPopup({
    masteryMap,
    slangMode,
    onQueueChange: (word, _pinyin, queued) => {
      setSavedWords((prev) => {
        const next = new Set(prev);
        queued ? next.add(word) : next.delete(word);
        return next;
      });
      setForcedWords((prev) => (queued ? (prev.includes(word) ? prev : [...prev, word]) : prev.filter((w) => w !== word)));
    },
    onAlreadySaved: (word) => {
      setSavedWords((prev) => (prev.has(word) ? prev : new Set(prev).add(word)));
    },
  });

  const isRecording = state === "recording";
  const isBusy = state === "transcribing" || state === "thinking" || state === "speaking";

  const statusLabel: Record<typeof state, string> = {
    idle: t.holdToSpeak,
    recording: t.recording,
    transcribing: t.transcribing,
    thinking: t.thinking,
    speaking: t.speaking,
    error: t.error,
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => router.push("/")}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--color-background)] transition-colors flex-shrink-0"
        >
          <ChevronLeft size={20} className="text-[var(--color-text-muted)]" />
        </button>
        <div className="flex-1">
          <h1 className="font-semibold text-sm text-[var(--color-text-primary)]">
            {t.speakingPractice}
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {t.tapWordToFlag(hskLevel)}
          </p>
        </div>
        <button
          onClick={() => setShowChatList(true)}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--color-background)] transition-colors flex-shrink-0"
          title="All chats"
        >
          <LayoutList size={18} className="text-[var(--color-text-muted)]" />
        </button>
        <button
          onClick={() => setSlangMode((s) => {
            const next = !s;
            localStorage.setItem("sm_slang_mode", next ? "1" : "0");
            return next;
          })}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex-shrink-0 ${
            slangMode
              ? "bg-violet-100 border-violet-300 text-violet-700"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? t.slangActive : t.slang}
        </button>
        <HomeButton className="flex-shrink-0" />
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <TranscriptView
          turns={turns}
          revealedTurns={revealedTurns}
          masteryMap={masteryMap}
          savedWords={savedWords}
          onWordClick={toggleClick}
          onWordHover={showHover}
          onHoverLeave={hideHover}
          resolveRange={resolveRange}
          activeWord={popup?.word ?? null}
          onRevealTurn={revealTurn}
          onHideTurn={hideTurn}
          playingTurnIndex={playingTurnIndex}
          isSpeechPaused={isSpeechPaused}
          onReplayTurn={(i) => {
            const turn = turns[i];
            if (!turn) return;
            const isUser = turn.role === "user";

            // Toggle pause/resume for the currently playing turn. The rate
            // actually applied here is always the slider's *current* value —
            // the slider itself is disabled except while paused (see below),
            // so "change speed" and "resume" are the same click for TTS turns.
            if (playingTurnIndex === i) {
              if (isSpeechPaused) {
                if (isUser && activeAudioRef.current) {
                  activeAudioRef.current.playbackRate = speechRate;
                  activeAudioRef.current.play();
                } else {
                  turnPlayback.resume(speechRate, () => setPlayingTurnIndex(null));
                }
                setIsSpeechPaused(false);
              } else {
                if (isUser && activeAudioRef.current) {
                  activeAudioRef.current.pause();
                } else {
                  turnPlayback.pause();
                }
                setIsSpeechPaused(true);
              }
              return;
            }

            // Switching to a different turn — stop whatever's currently playing.
            turnPlayback.stop();
            if (activeAudioRef.current) {
              activeAudioRef.current.pause();
              activeAudioRef.current = null;
            }
            setIsSpeechPaused(false);
            setPlayingTurnIndex(i);

            if (isUser && turn.audioUrl) {
              const audio = new Audio(turn.audioUrl);
              audio.playbackRate = speechRate;
              activeAudioRef.current = audio;
              audio.onended = () => { setPlayingTurnIndex(null); activeAudioRef.current = null; };
              audio.play();
            } else {
              turnPlayback.play(turn.raw_text, speechRate, () => setPlayingTurnIndex(null));
            }
          }}
        />
      </div>

      {/* Flagged words */}
      {forcedWords.length > 0 && (
        <div className="flex gap-2 px-4 py-2 flex-wrap bg-[var(--color-surface)] border-t border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-muted)] self-center">{t.willUse}</span>
          {forcedWords.map((w) => (
            <span
              key={w}
              className="px-2 py-0.5 rounded-full bg-[var(--color-highlight-mistake)] border border-red-200 text-red-600 text-xs"
            >
              {w}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 text-center py-2 px-4 bg-[var(--color-surface)]">
          {error}
        </p>
      )}

      {/* Controls */}
      <div className="flex flex-col items-center gap-3 py-6 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-2 w-48">
          <span className="text-xs text-[var(--color-text-muted)] w-6">1x</span>
          <input
            type="range"
            min={1}
            max={2}
            step={0.1}
            value={speechRate}
            onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
            // Only adjustable while a turn is paused (or nothing's playing at
            // all — sets the rate the *next* playback starts at). TTS has no
            // way to apply a rate change to audio already playing, and
            // silently queuing it up for "whenever this happens to end" read
            // as broken; disabling makes it obvious the change is a paused-
            // state action instead of a while-playing one.
            disabled={playingTurnIndex !== null && !isSpeechPaused}
            className="flex-1 accent-violet-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className="text-xs text-[var(--color-text-muted)] w-6 text-right">2x</span>
          <span className="text-xs text-violet-600 font-medium w-8 text-right">{speechRate.toFixed(1)}x</span>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">{statusLabel[state]}</p>

        <button
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            startRecording();
          }}
          onPointerUp={stopRecording}
          onPointerCancel={cancel}
          disabled={isBusy}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all select-none touch-none shadow-md disabled:opacity-40 ${
            isRecording
              ? "bg-red-500 border-2 border-red-300 scale-110"
              : "bg-violet-600 hover:bg-violet-700 border border-violet-300 shadow-violet-100"
          }`}
        >
          <Mic size={28} className="text-white" />
        </button>

        {isBusy && (
          <button
            onClick={cancel}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {t.cancel}
          </button>
        )}
      </div>

      {/* ── Chat list panel ── */}
      {showChatList && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowChatList(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] bg-[var(--color-surface)] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-[var(--color-border)]">
              <span className="font-semibold text-sm text-[var(--color-text-primary)]">{t.chats}</span>
              <button
                onClick={createNewConversation}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--color-background)] transition-colors text-violet-600"
                title={t.newChat}
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => switchConversation(conv.id)}
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 group transition-colors ${
                    conv.id === activeConvId
                      ? "bg-violet-50 border-r-2 border-violet-500"
                      : "hover:bg-[var(--color-background)]"
                  }`}
                >
                  <span className="flex-1 text-sm text-[var(--color-text-primary)] truncate">
                    {conv.title || t.newChat}
                  </span>
                  <span
                    onClick={(e) => deleteConversation(conv.id, e)}
                    className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] active:text-red-500 flex-shrink-0"
                  >
                    <Trash2 size={14} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Word definition popup — same component the chatbot uses (hover
          previews, click pins, extension deferral, per-sense add/remove). */}
      {popup && (
        <WordPopupCard
          popup={popup}
          popupRef={popupRef}
          onNavigate={() => navigateToWord(popup)}
          onToggleSense={(sense) => toggleSense(popup, sense)}
          onNavigatePart={navigateToPart}
          onTogglePartSense={(part, sense) => togglePartSense(popup, part, sense)}
        />
      )}
    </div>
  );
}
