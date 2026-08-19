"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ArrowUp, LayoutList, Mic, MicOff, Pause, Phone, PhoneOff, Play, Plus, Trash2 } from "lucide-react";
import { getConversationContext, getSavedHanziSet } from "@/app/actions/vocabulary";
import { saveMessages, loadOlderMessages, getConversationList, deleteConversationMessages } from "@/app/actions/chat";
import type { MasteryMap } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";
import { useHeaderOverride } from "@/app/_components/HeaderContext";
import { useWordPopup, WordPopupCard } from "@/components/WordPopup";
import { TappableText } from "@/components/TappableText";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { useVoiceConversation, type ConvState } from "@/hooks/useVoiceConversation";
import { useTurnPlayback } from "@/hooks/useTurnPlayback";

interface Message {
  role: "user" | "assistant";
  content: string;
  id: string;
  /** Object URL for the user's recorded audio blob (practice-mic turns only,
   *  session-local — never persisted, same as ConversationTurn.audioUrl used
   *  to be on the old standalone Speaking Practice page). */
  audioUrl?: string;
}

interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface Props {
  masteryMap: MasteryMap;
}

const MAX_LOCAL_MESSAGES = 100;

// Matches p_max_age in supabase/migrations/017_stale_conversation_cleanup.sql —
// a conversation the nightly cron has reaped server-side should also drop
// out of the locally-cached list (see the reconciliation effect below).
const STALE_CONVERSATION_MS = 14 * 24 * 60 * 60 * 1000;

function autoTitle(text: string): string {
  return text.length > 28 ? text.slice(0, 28) + "…" : text;
}

export function ConversationClient({ masteryMap }: Props) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // Seeded from masteryMap (fetched fresh from the DB on every SSR render of
  // this page), not the capped getConversationContext() query below — that one
  // is limit(15)'d and used for AI context, not as the source of truth for
  // which words are actually saved. Session-local toggleSense() adds/removes
  // layer on top of this base via onQueueChange.
  const [savedWords, setSavedWords] = useState<Set<string>>(
    () => new Set(Object.keys(masteryMap))
  );

  // The useState initializer above only ever runs once, at mount — but
  // masteryMap can arrive stale on that very first mount (Next.js's
  // client-side Router Cache can serve an up-to-30s-old cached render of
  // this route on a soft navigation back to it) and only becomes correct
  // once the resync effect below lands a fresher one. Without this, a word
  // saved just before navigating away — or one that was simply missing from
  // that stale first snapshot — stays permanently unmarked until a hard
  // reload. Union, never remove, so this can't clobber an optimistic
  // same-session add that masteryMap hasn't caught up to yet.
  useEffect(() => {
    setSavedWords((prev) => {
      const next = new Set(prev);
      for (const hanzi of Object.keys(masteryMap)) next.add(hanzi);
      return next;
    });
  }, [masteryMap]);

  // Actively self-heal the staleness above rather than hoping it doesn't
  // happen: pull a fresh saved-hanzi set every time this page mounts, so a
  // cached masteryMap from before you last saved a word gets replaced with
  // a real one instead of sitting there until the cache's ~30s window lapses
  // on its own (or forever, if you're back before then).
  //
  // Deliberately a plain fetch (getSavedHanziSet), not router.refresh() —
  // that was tried first and had to be reverted: refresh() re-renders the
  // whole route and can't be cancelled once called, so if you navigated
  // away again before it resolved, its response could land *after* you'd
  // already left and briefly re-render this page over wherever you'd gone —
  // reported as "back out of chat, and it flashes back for a couple
  // seconds." A plain promise is safe to just ignore via `cancelled` below.
  useEffect(() => {
    let cancelled = false;
    getSavedHanziSet()
      .then((hanzi) => {
        if (cancelled) return;
        setSavedWords((prev) => {
          const next = new Set(prev);
          for (const h of hanzi) next.add(h);
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The mount effect above misses the common mobile case: navigating to the
  // chatbot away and "coming back" via a swipe-back gesture or the browser's
  // back button restores the page from bfcache — the whole React tree is
  // resumed exactly as it was, so this component never remounts and that
  // effect never re-fires. Without this, a word saved elsewhere while you
  // were away (another tab, the extension, another device) stays unhighlighted
  // until a hard reload. `pageshow`'s `persisted` flag is true only on a
  // bfcache restore; a real mount already got the effect above. Same
  // plain-fetch-not-router.refresh() reasoning as above.
  useEffect(() => {
    let cancelled = false;
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      getSavedHanziSet()
        .then((hanzi) => {
          if (cancelled) return;
          setSavedWords((prev) => {
            const next = new Set(prev);
            for (const h of hanzi) next.add(h);
            return next;
          });
        })
        .catch(() => {});
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Slang mode disabled for now (feature parked, not deleted).
  const [slangMode] = useState(false);
  // const [slangMode, setSlangMode] = useState(() => {
  //   if (typeof window === "undefined") return false;
  //   return localStorage.getItem("sm_slang_mode") === "1";
  // });

  const [hskLevel, setHskLevel] = useState<number | null>(null);
  const [unknownWords, setUnknownWords] = useState<
    { hanzi: string; pinyin: string; meaning: string }[]
  >([]);
  // "将使用" — words queued this chat *session*, not "everything ever
  // flagged": flagged_for_immediate_use in the DB is set by every save
  // action app-wide and is never cleared, so deriving this from masteryMap
  // pulls in a user's entire saved-word history instead of just this
  // conversation's additions. Persisted per-conversation in localStorage
  // instead (same pattern as sm_conv_messages_/sm_conv_history_ below) so it
  // survives navigating away and back without accumulating across sessions.
  const [forcedWords, setForcedWords] = useState<string[]>([]);

  // TTS playback speed for both the practice mic's auto-spoken replies and
  // any message's manual replay button — shared single control, same range
  // the old standalone Speaking Practice page used.
  const [speechRate, setSpeechRate] = useState(1);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  // Messages toggled hidden via the per-bubble "Hide transcript" button
  // (ported from Speaking Practice's blur-to-quiz-yourself transcript).
  // Deliberately opt-in/empty by default — unlike the old standalone page,
  // this chat's messages are visible by default so typed conversations
  // don't regress into a blurred-by-default surprise.
  const [hiddenMessageIds, setHiddenMessageIds] = useState<Set<string>>(new Set());

  const { popup, popupRef, showHover, hideHover, toggleClick, toggleSense, togglePartSense, navigateToWord, navigateToPart, resolveRange } = useWordPopup({
    masteryMap,
    slangMode,
    // Styling (blue/red highlight) and forced-word injection are per-hanzi,
    // not per-sense — any sense of this hanzi being queued is enough.
    onQueueChange: (word, _pinyin, queued) => {
      setSavedWords((prev) => {
        const next = new Set(prev);
        queued ? next.add(word) : next.delete(word);
        return next;
      });
      setForcedWords((prev) => (queued ? (prev.includes(word) ? prev : [...prev, word]) : prev.filter((w) => w !== word)));
    },
    // Passive discovery (opening a popup for an already-saved word, not
    // tapping +/-) — only touch the highlight, not the "will use this turn"
    // list, since the user didn't actually queue anything just now.
    onAlreadySaved: (word) => {
      setSavedWords((prev) => (prev.has(word) ? prev : new Set(prev).add(word)));
    },
  });

  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>("");
  const [showChatList, setShowChatList] = useState(false);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeConvIdRef = useRef<string>("");
  // Disambiguates ids for the two messages (user + assistant) a single
  // practice-mic turn produces back-to-back — they can otherwise land in
  // the same millisecond.
  const practiceIdSeq = useRef(0);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  useEffect(() => {
    // hskLevel/unknownWords here are AI-context only (capped, sent to the
    // model) — savedWords/forcedWords are already seeded from masteryMap
    // above and must not be overwritten by this narrower, capped fetch.
    getConversationContext().then(({ hskLevel, unknownWords }) => {
      setHskLevel(hskLevel);
      setUnknownWords(unknownWords);
    });
  }, []);

  // ── Practice mic (push-to-talk) — replaces the old standalone Speaking
  //    Practice page. Hold to speak → transcribe → Gemini reply → browser
  //    TTS auto-speaks the reply, all as one turn-based hold-and-release
  //    cycle. Distinct from the Live Call button below, which streams
  //    full-duplex via Gemini Live instead of one turn at a time. ──────────
  const practiceConv = useVoiceConversation({
    slangMode,
    forcedWords,
    hskLevel: hskLevel ?? 1,
    unknownWords,
    speechRate,
    onTranscriptUpdate: (_tokens, role, rawText, audioUrl) => {
      const id = `practice_${Date.now()}_${practiceIdSeq.current++}`;
      const msg: Message = { role, content: rawText, id, audioUrl };
      setMessages((prev) => [...prev, msg]);

      const convId = activeConvIdRef.current;
      saveMessages([{ role, content: rawText, id }], convId).catch(() => {});

      historyRef.current = [...historyRef.current, { role, content: rawText }].slice(-20);
      try { localStorage.setItem(`sm_conv_history_${convId}`, JSON.stringify(historyRef.current)); } catch {}

      if (role === "user") {
        setConversations((prev) => {
          const isFirst = !prev.find((c) => c.id === convId)?.title;
          const updated = prev.map((c) =>
            c.id === convId ? { ...c, updatedAt: Date.now(), title: isFirst ? autoTitle(rawText) : c.title } : c
          );
          localStorage.setItem("sm_conversations", JSON.stringify(updated));
          return updated;
        });
      }
    },
    onAITurnEnd: () => setForcedWords([]),
  });

  const turnPlayback = useTurnPlayback();

  // Stops whatever's currently audible (practice mic recording/speaking,
  // manual message replay, or a playing recorded-audio blob) — called
  // whenever the active conversation is about to change out from under it.
  const stopVoicePlayback = useCallback(() => {
    practiceConv.cancel();
    turnPlayback.stop();
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    setPlayingMessageId(null);
    setIsSpeechPaused(false);
  }, [practiceConv, turnPlayback]);

  // Init: migrate old single-chat format, then load conversations —
  // entirely synchronous, no network wait. This must render whatever's
  // cached locally *instantly*: a previous version of this effect awaited a
  // database call before its first setState, which meant navigating back to
  // this page rendered a blank chat for however long that round trip took
  // (worse on mobile) even though the real messages were sitting in local
  // storage the whole time, unchanged. DB reconciliation now happens in a
  // separate, non-blocking effect below.
  useEffect(() => {
    const oldMsgs = localStorage.getItem("sm_conv_messages");
    const existingConvs = localStorage.getItem("sm_conversations");

    if (oldMsgs && !existingConvs) {
      let msgs: Message[] = [];
      try { msgs = JSON.parse(oldMsgs); } catch {}
      const id = `conv_${Date.now()}`;
      const firstUserMsg = msgs.find((m) => m.role === "user");
      const title = firstUserMsg ? autoTitle(firstUserMsg.content) : "Chat 1";
      const meta: ConversationMeta = { id, title, createdAt: Date.now(), updatedAt: Date.now() };
      localStorage.setItem("sm_conversations", JSON.stringify([meta]));
      localStorage.setItem(`sm_conv_messages_${id}`, oldMsgs);
      const oldHistory = localStorage.getItem("sm_conv_history");
      if (oldHistory) {
        localStorage.setItem(`sm_conv_history_${id}`, oldHistory);
        localStorage.removeItem("sm_conv_history");
      }
      localStorage.removeItem("sm_conv_messages");
      localStorage.setItem("sm_active_conv", id);
    }

    let convs: ConversationMeta[] = [];
    try {
      const data = localStorage.getItem("sm_conversations");
      convs = data ? JSON.parse(data) : [];
    } catch {}

    let activeId = localStorage.getItem("sm_active_conv") ?? "";

    if (convs.length === 0) {
      const id = `conv_${Date.now()}`;
      convs = [{ id, title: "", createdAt: Date.now(), updatedAt: Date.now() }];
      localStorage.setItem("sm_conversations", JSON.stringify(convs));
      activeId = id;
    }

    if (!activeId || !convs.find((c) => c.id === activeId)) {
      activeId = convs[0].id;
    }

    localStorage.setItem("sm_active_conv", activeId);

    try {
      const msgs = localStorage.getItem(`sm_conv_messages_${activeId}`);
      const hist = localStorage.getItem(`sm_conv_history_${activeId}`);
      const forced = localStorage.getItem(`sm_conv_forced_${activeId}`);
      if (msgs) setMessages(JSON.parse(msgs));
      if (hist) historyRef.current = JSON.parse(hist);
      if (forced) setForcedWords(JSON.parse(forced));
    } catch {}

    setConversations(convs);
    setActiveConvId(activeId);
  }, []);

  // Background reconciliation with the database — covers a fresh device,
  // browser, or reinstalled home-screen PWA, all of which start with empty
  // local storage even though nothing was actually deleted (see
  // getConversationList). Runs once; deliberately separate from the sync
  // effect above and never blocks what's already on screen — it only adds
  // conversations local storage doesn't know about yet, and prunes ones the
  // server no longer has (see below).
  useEffect(() => {
    let cancelled = false;
    getConversationList()
      .then((remote) => {
        if (cancelled) return; // page navigated away before this landed
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
              localStorage.removeItem(`sm_conv_messages_${c.id}`);
              localStorage.removeItem(`sm_conv_history_${c.id}`);
              localStorage.removeItem(`sm_conv_forced_${c.id}`);
            }
          }

          if (additions.length === 0 && keep.length === prev.length) return prev;
          const merged = [...keep, ...additions].sort((a, b) => b.updatedAt - a.updatedAt);
          localStorage.setItem("sm_conversations", JSON.stringify(merged));
          return merged;
        });
      })
      .catch(() => {}); // offline or logged out — whatever's local stands as-is
    return () => { cancelled = true; };
  }, []);

  // Backfill messages for whichever conversation is active whenever it has
  // nothing cached locally — it only exists in the DB (from before a
  // reinstall, or another device, or it was just added by the reconciliation
  // effect above). Runs on every switch, not just mount.
  useEffect(() => {
    if (!activeConvId) return;
    if (localStorage.getItem(`sm_conv_messages_${activeConvId}`)) return;
    const id = activeConvId;
    let cancelled = false;
    loadOlderMessages(null, id)
      .then((remoteMsgs) => {
        if (cancelled) return; // page navigated away, or switched conversations again, before this landed
        if (remoteMsgs.length === 0 || activeConvIdRef.current !== id) return;
        const remoteHist = remoteMsgs.map((m) => ({ role: m.role, content: m.content }));
        historyRef.current = remoteHist;
        setMessages(remoteMsgs);
        localStorage.setItem(`sm_conv_messages_${id}`, JSON.stringify(remoteMsgs));
        localStorage.setItem(`sm_conv_history_${id}`, JSON.stringify(remoteHist));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeConvId]);

  // Persist messages whenever they change
  useEffect(() => {
    if (!activeConvId) return;
    try {
      const toStore = messages.slice(-MAX_LOCAL_MESSAGES);
      localStorage.setItem(`sm_conv_messages_${activeConvId}`, JSON.stringify(toStore));
      if (messages.length > MAX_LOCAL_MESSAGES) {
        const overflow = messages.slice(0, messages.length - MAX_LOCAL_MESSAGES);
        saveMessages(overflow, activeConvId).catch(() => {});
      }
    } catch {}
  }, [messages, activeConvId]);

  // Persist "将使用" whenever it changes
  useEffect(() => {
    if (!activeConvId) return;
    try {
      localStorage.setItem(`sm_conv_forced_${activeConvId}`, JSON.stringify(forcedWords));
    } catch {}
  }, [forcedWords, activeConvId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const switchConversation = useCallback((convId: string) => {
    const currentId = activeConvIdRef.current;
    if (convId === currentId) { setShowChatList(false); return; }

    stopVoicePlayback();

    if (currentId) {
      try { localStorage.setItem(`sm_conv_history_${currentId}`, JSON.stringify(historyRef.current)); } catch {}
    }

    let newMsgs: Message[] = [];
    let newHist: { role: "user" | "assistant"; content: string }[] = [];
    let newForced: string[] = [];
    try {
      const msgs = localStorage.getItem(`sm_conv_messages_${convId}`);
      const hist = localStorage.getItem(`sm_conv_history_${convId}`);
      const forced = localStorage.getItem(`sm_conv_forced_${convId}`);
      if (msgs) newMsgs = JSON.parse(msgs);
      if (hist) newHist = JSON.parse(hist);
      if (forced) newForced = JSON.parse(forced);
    } catch {}

    historyRef.current = newHist;
    setMessages(newMsgs);
    setForcedWords(newForced);
    setActiveConvId(convId);
    localStorage.setItem("sm_active_conv", convId);
    setShowChatList(false);
    // If nothing's cached locally for convId, the activeConvId-keyed
    // backfill effect above picks it up from the DB automatically.
  }, [stopVoicePlayback]);

  const createNewConversation = useCallback(() => {
    const id = `conv_${Date.now()}`;
    const meta: ConversationMeta = { id, title: "", createdAt: Date.now(), updatedAt: Date.now() };

    setConversations((prev) => {
      const updated = [meta, ...prev];
      localStorage.setItem("sm_conversations", JSON.stringify(updated));
      return updated;
    });

    stopVoicePlayback();

    const currentId = activeConvIdRef.current;
    if (currentId) {
      try { localStorage.setItem(`sm_conv_history_${currentId}`, JSON.stringify(historyRef.current)); } catch {}
    }

    historyRef.current = [];
    setMessages([]);
    setForcedWords([]);
    setActiveConvId(id);
    localStorage.setItem("sm_active_conv", id);
    setShowChatList(false);
  }, [stopVoicePlayback]);

  const deleteConversation = useCallback((convId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Fire-and-forget: the local list below updates immediately regardless,
    // and this is what makes the deletion actually stick — without it the
    // conversation's chat_messages rows survive server-side and
    // getConversationList() resurrects it the next time it rebuilds the
    // list from the DB (fresh device, reinstalled PWA, or just a reload).
    deleteConversationMessages(convId).catch((err) => console.error("[SmartMandarin] failed to delete conversation:", err));

    localStorage.removeItem(`sm_conv_messages_${convId}`);
    localStorage.removeItem(`sm_conv_history_${convId}`);
    localStorage.removeItem(`sm_conv_forced_${convId}`);

    let remaining: ConversationMeta[] = [];
    try {
      const data = localStorage.getItem("sm_conversations");
      const all: ConversationMeta[] = data ? JSON.parse(data) : [];
      remaining = all.filter((c) => c.id !== convId);
    } catch {}

    localStorage.setItem("sm_conversations", JSON.stringify(remaining));
    setConversations(remaining);

    if (activeConvIdRef.current === convId) {
      stopVoicePlayback();
      if (remaining.length > 0) {
        const target = remaining[0];
        let newMsgs: Message[] = [];
        let newHist: { role: "user" | "assistant"; content: string }[] = [];
        let newForced: string[] = [];
        try {
          const msgs = localStorage.getItem(`sm_conv_messages_${target.id}`);
          const hist = localStorage.getItem(`sm_conv_history_${target.id}`);
          const forced = localStorage.getItem(`sm_conv_forced_${target.id}`);
          if (msgs) newMsgs = JSON.parse(msgs);
          if (hist) newHist = JSON.parse(hist);
          if (forced) newForced = JSON.parse(forced);
        } catch {}
        historyRef.current = newHist;
        setMessages(newMsgs);
        setForcedWords(newForced);
        setActiveConvId(target.id);
        localStorage.setItem("sm_active_conv", target.id);
      } else {
        const newId = `conv_${Date.now()}`;
        const meta: ConversationMeta = { id: newId, title: "", createdAt: Date.now(), updatedAt: Date.now() };
        localStorage.setItem("sm_conversations", JSON.stringify([meta]));
        localStorage.setItem("sm_active_conv", newId);
        setConversations([meta]);
        historyRef.current = [];
        setMessages([]);
        setForcedWords([]);
        setActiveConvId(newId);
      }
    }
  }, [stopVoicePlayback]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || hskLevel === null || !activeConvId) return;

    setInput("");
    inputRef.current?.focus();

    setChatError(null);
    const userMsg: Message = { role: "user", content: text, id: Date.now().toString() };

    // Auto-title on first message; update updatedAt on subsequent ones
    setConversations((prev) => {
      const isFirst = !prev.find((c) => c.id === activeConvId)?.title;
      const updated = prev.map((c) =>
        c.id === activeConvId
          ? { ...c, updatedAt: Date.now(), title: isFirst ? autoTitle(text) : c.title }
          : c
      );
      localStorage.setItem("sm_conversations", JSON.stringify(updated));
      return updated;
    });

    setMessages((prev) => [...prev, userMsg]);
    saveMessages([userMsg], activeConvId).catch(() => {});

    historyRef.current = [
      ...historyRef.current,
      { role: "user" as const, content: text },
    ].slice(-20);
    try { localStorage.setItem(`sm_conv_history_${activeConvId}`, JSON.stringify(historyRef.current)); } catch {}

    setIsLoading(true);
    try {
      const res = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: text,
          history: historyRef.current.slice(0, -1),
          slang_mode: slangMode,
          forced_words: forcedWords,
          hsk_level: hskLevel,
          unknown_words: unknownWords,
        }),
      });
      const data = await res.json();
      if (data.reply) {
        const aiMsg: Message = {
          role: "assistant",
          content: data.reply,
          id: (Date.now() + 1).toString(),
        };
        setMessages((prev) => [...prev, aiMsg]);
        saveMessages([aiMsg], activeConvId).catch(() => {});
        historyRef.current = [
          ...historyRef.current,
          { role: "assistant" as const, content: data.reply },
        ].slice(-20);
        try { localStorage.setItem(`sm_conv_history_${activeConvId}`, JSON.stringify(historyRef.current)); } catch {}
        setForcedWords([]);
      } else {
        // No reply and no thrown exception — e.g. missing Gemini key, rate
        // limit, etc. Used to fail silently here (isLoading just flipped
        // back off with nothing on screen, which read as the request
        // hanging) — data.error is already localized server-side.
        setChatError(data.error || t.chatSendFailed);
      }
    } catch {
      setChatError(t.chatSendFailed);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, hskLevel, slangMode, forcedWords, unknownWords, activeConvId]);

  // Replays one message's audio: the user's actual recorded clip if this
  // session still has it (practice-mic turns only, an in-memory blob URL —
  // see the Message.audioUrl doc comment), otherwise browser TTS reading
  // the text back — which covers every assistant reply and any typed
  // message too. Toggling the same message pauses/resumes in place; picking
  // a different one stops whatever was playing and starts fresh.
  const handleReplayMessage = useCallback((msg: Message) => {
    const isUserAudio = msg.role === "user" && !!msg.audioUrl;

    if (playingMessageId === msg.id) {
      if (isSpeechPaused) {
        if (isUserAudio && activeAudioRef.current) {
          activeAudioRef.current.playbackRate = speechRate;
          activeAudioRef.current.play();
        } else {
          turnPlayback.resume(speechRate, () => setPlayingMessageId(null));
        }
        setIsSpeechPaused(false);
      } else {
        if (isUserAudio && activeAudioRef.current) {
          activeAudioRef.current.pause();
        } else {
          turnPlayback.pause();
        }
        setIsSpeechPaused(true);
      }
      return;
    }

    turnPlayback.stop();
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    setIsSpeechPaused(false);
    setPlayingMessageId(msg.id);

    if (isUserAudio) {
      const audio = new Audio(msg.audioUrl);
      audio.playbackRate = speechRate;
      activeAudioRef.current = audio;
      audio.onended = () => { setPlayingMessageId(null); activeAudioRef.current = null; };
      audio.play();
    } else {
      turnPlayback.play(msg.content, speechRate, () => setPlayingMessageId(null));
    }
  }, [playingMessageId, isSpeechPaused, speechRate, turnPlayback]);

  const toggleHidden = useCallback((id: string) => {
    setHiddenMessageIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── Live voice call (Gemini Live — full-duplex, replaces hold-to-record
  //    + text reply + browser TTS with one streaming audio-to-audio session
  //    while connected) ──────────────────────────────────────────────────
  // Tracks the in-flight assistant utterance so onAITurnEnd can persist the
  // final text without re-reading React state (which would need a stale-
  // closure-prone functional setState just to peek at the latest value).
  const liveAssistantRef = useRef<{ id: string; text: string } | null>(null);

  const liveConv = useGeminiLive({
    slangMode,
    forcedWords,
    hskLevel: hskLevel ?? 1,
    unknownWords,
    onTranscriptUpdate: (text, role, turnId) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === turnId);
        if (idx === -1) return [...prev, { id: turnId, role, content: text }];
        const next = [...prev];
        next[idx] = { ...next[idx], content: text };
        return next;
      });

      if (role === "assistant") {
        liveAssistantRef.current = { id: turnId, text };
        return;
      }

      // User speech transcription arrives as one complete message (not
      // streamed) — safe to fold into history/persist immediately rather
      // than waiting for a turn-end signal the way the assistant side does.
      const convId = activeConvIdRef.current;
      historyRef.current = [...historyRef.current, { role: "user" as const, content: text }].slice(-20);
      try { localStorage.setItem(`sm_conv_history_${convId}`, JSON.stringify(historyRef.current)); } catch {}
      if (convId) saveMessages([{ id: turnId, role: "user", content: text }], convId).catch(() => {});

      setConversations((prev) => {
        const isFirst = !prev.find((c) => c.id === convId)?.title;
        if (!isFirst) return prev;
        const updated = prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now(), title: autoTitle(text) } : c
        );
        localStorage.setItem("sm_conversations", JSON.stringify(updated));
        return updated;
      });
    },
    onAITurnEnd: () => {
      const finished = liveAssistantRef.current;
      liveAssistantRef.current = null;
      const convId = activeConvIdRef.current;
      if (finished) {
        historyRef.current = [...historyRef.current, { role: "assistant" as const, content: finished.text }].slice(-20);
        try { localStorage.setItem(`sm_conv_history_${convId}`, JSON.stringify(historyRef.current)); } catch {}
        if (convId) saveMessages([{ id: finished.id, role: "assistant", content: finished.text }], convId).catch(() => {});
      }
      setForcedWords([]);
    },
  });

  const liveActive = liveConv.connectionState === "connecting" || liveConv.connectionState === "connected";
  const practiceBusy = practiceConv.state !== "idle";
  const activeConvTitle = conversations.find((c) => c.id === activeConvId)?.title || t.newChat;

  const practiceStatusLabel: Record<Exclude<ConvState, "idle">, string> = {
    recording: t.recording,
    transcribing: t.transcribing,
    thinking: t.thinking,
    speaking: t.speaking,
    error: t.error,
  };

  // Merged into the global fixed header instead of a second local bar —
  // see app/_components/AppHeader.tsx's center/actions slots. Memoized so
  // this only rebuilds (and re-registers with the header) when its actual
  // inputs change, not on every one of this component's own re-renders
  // (streaming transcript, live-call audio state, etc. are frequent here).
  const headerCenter = useMemo(
    () => (
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm font-medium select-none">灵</span>
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm text-[var(--color-text-primary)]">小灵</div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-xs text-[var(--color-text-muted)] truncate">
              {activeConvTitle}
            </span>
          </div>
        </div>
      </div>
    ),
    [activeConvTitle]
  );
  const headerActions = useMemo(
    () => (
      <>
        <button
          onClick={() => setShowChatList(true)}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--color-background)] transition-colors flex-shrink-0"
          title="All chats"
        >
          <LayoutList size={18} className="text-[var(--color-text-muted)]" />
        </button>
        <button
          onClick={() => (liveActive ? liveConv.disconnect() : liveConv.connect())}
          disabled={hskLevel === null || practiceBusy}
          title={liveConv.connectionState === "connected" ? "End live voice call" : "Start live voice call"}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-40 ${
            liveActive
              ? "bg-red-500 text-white"
              : "hover:bg-[var(--color-background)] text-[var(--color-text-muted)]"
          }`}
        >
          {liveActive ? <PhoneOff size={16} /> : <Phone size={16} />}
        </button>
      </>
    ),
    // liveConv itself is a fresh object every render (useGeminiLive doesn't
    // memoize its return value) — depend on the stable pieces actually used
    // here instead (connect/disconnect are useCallback'd, connectionState
    // is a plain string) so this doesn't defeat the memo by rebuilding
    // every render regardless.
    [liveActive, liveConv.connectionState, liveConv.connect, liveConv.disconnect, hskLevel, practiceBusy]
  );
  // Also memoized as a whole — React bails out of re-rendering AppHeader
  // when the context value it reads is reference-equal to last time, which
  // only holds if this outer object is stable too, not just its fields.
  const headerOverride = useMemo(
    () => ({ center: headerCenter, actions: headerActions }),
    [headerCenter, headerActions]
  );
  useHeaderOverride("conversation-header", headerOverride);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* ── Live call status ── */}
      {liveConv.connectionState !== "idle" && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-violet-50 border-b border-violet-200 text-sm">
          <span className="flex items-center gap-2 text-violet-700 min-w-0">
            {liveConv.connectionState === "connecting" && t.loading}
            {liveConv.connectionState === "connected" && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <span className="truncate">Live call — speak naturally</span>
              </>
            )}
            {liveConv.connectionState === "error" && (
              <span className="text-red-600 truncate">{liveConv.error ?? "Voice call failed"}</span>
            )}
          </span>
          {liveConv.connectionState === "connected" && (
            <button
              onClick={liveConv.toggleMute}
              title={liveConv.isMuted ? "Unmute" : "Mute"}
              className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                liveConv.isMuted ? "bg-red-100 text-red-600" : "bg-white text-violet-700 border border-violet-200"
              }`}
            >
              {liveConv.isMuted ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
          )}
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center pb-12">
            <div className="w-16 h-16 rounded-full bg-violet-600 flex items-center justify-center shadow-lg">
              <span className="text-white text-2xl font-medium select-none">灵</span>
            </div>
            <div>
              <p className="font-medium text-[var(--color-text-primary)]">小灵</p>
              <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-[220px]">
                {t.typeToStart}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const hidden = hiddenMessageIds.has(msg.id);
          const isPlayingThis = playingMessageId === msg.id && !isSpeechPaused;
          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-white text-xs font-medium select-none">灵</span>
                </div>
              )}
              <div
                className={`flex flex-col gap-1.5 max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] ${
                  msg.role === "user"
                    ? "bg-violet-600 text-white rounded-tr-sm"
                    : "bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-tl-sm border border-[var(--color-border)] shadow-sm"
                }`}
              >
                {/* Replay (recorded audio, or TTS) + hide/show — ported
                    from the old standalone Speaking Practice page's
                    per-turn controls. */}
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => handleReplayMessage(msg)}
                    title={isPlayingThis ? t.pause : t.play}
                    className={`flex items-center transition-colors ${
                      msg.role === "user" ? "text-violet-200 hover:text-white" : "text-violet-600 hover:text-violet-800"
                    }`}
                  >
                    {isPlayingThis ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    onClick={() => toggleHidden(msg.id)}
                    className={`text-[10px] underline underline-offset-2 transition-colors ${
                      msg.role === "user" ? "text-violet-200 hover:text-white" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {hidden ? t.showTranscript : t.hideTranscript}
                  </button>
                </div>

                {!hidden && (
                  msg.role === "assistant" ? (
                    <TappableText
                      text={msg.content}
                      masteryMap={masteryMap}
                      savedWords={savedWords}
                      onWordClick={toggleClick}
                      onWordHover={showHover}
                      onHoverLeave={hideHover}
                      resolveRange={resolveRange}
                      activeWord={popup?.word ?? null}
                    />
                  ) : (
                    <span className="leading-relaxed">{msg.content}</span>
                  )
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-white text-xs font-medium select-none">灵</span>
            </div>
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] animate-bounce" />
            </div>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {(chatError || practiceConv.error) && (
        <div className="px-4 py-2.5 bg-red-900/10 border-t border-red-800/30">
          <p className="text-sm text-red-500">{chatError || practiceConv.error}</p>
        </div>
      )}

      {/* ── Forced words ── */}
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

      {/* ── TTS speed — shared by the practice mic's auto-spoken replies
          and every message's manual replay button. ── */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <span className="text-[10px] text-[var(--color-text-muted)] w-6">1x</span>
        <input
          type="range"
          min={1}
          max={2}
          step={0.1}
          value={speechRate}
          onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
          // See useTurnPlayback's doc comment — rate can't change mid-utterance,
          // only take effect on the next play/resume, so this is disabled
          // while something's actively playing (not just paused).
          disabled={playingMessageId !== null && !isSpeechPaused}
          className="flex-1 accent-violet-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <span className="text-[10px] text-[var(--color-text-muted)] w-6 text-right">2x</span>
        <span className="text-[10px] text-violet-600 font-medium w-8 text-right">{speechRate.toFixed(1)}x</span>
      </div>

      {/* ── Input ── */}
      {/* Disabled while a live call is up — that session owns the mic and
          drives its own turns, a text/hold-to-record message alongside it
          would interleave unpredictably with the open audio stream. Same
          reasoning applies to the practice mic mid-turn. */}
      <div className="px-4 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 bg-[var(--color-background)] border border-[var(--color-border)] rounded-2xl px-4 py-2 focus-within:border-violet-400 transition-colors">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder={
              liveActive
                ? "Live call in progress…"
                : practiceConv.state !== "idle"
                ? practiceStatusLabel[practiceConv.state]
                : t.typeInput
            }
            disabled={isLoading || hskLevel === null || liveActive || practiceBusy}
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none disabled:opacity-50"
          />
          <button
            onPointerDown={() => {
              if (liveActive || practiceConv.state !== "idle") return;
              practiceConv.resetHistory(historyRef.current);
              practiceConv.startRecording();
            }}
            onPointerUp={() => practiceConv.state === "recording" && practiceConv.stopRecording()}
            onPointerLeave={() => practiceConv.state === "recording" && practiceConv.stopRecording()}
            disabled={isLoading || hskLevel === null || liveActive || (practiceBusy && practiceConv.state !== "recording")}
            title={t.holdToSpeak}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0 ${
              practiceConv.state === "recording"
                ? "bg-red-500"
                : "bg-[var(--color-border)] hover:bg-slate-300"
            }`}
          >
            {practiceConv.state === "transcribing" || practiceConv.state === "thinking" ? (
              <span className="w-3 h-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            ) : practiceConv.state === "speaking" ? (
              <span className="w-3 h-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            ) : (
              <Mic size={15} className={practiceConv.state === "recording" ? "text-white" : "text-[var(--color-text-muted)]"} />
            )}
          </button>
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || hskLevel === null || liveActive || practiceBusy}
            className="w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-700 flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <ArrowUp size={15} className="text-white" />
          </button>
        </div>
        <p className="text-center text-[10px] text-[var(--color-text-muted)] mt-1.5 flex items-center justify-center gap-2">
          <span>{practiceConv.state !== "idle" ? practiceStatusLabel[practiceConv.state] : t.tapToSelect}</span>
          {(practiceConv.state === "transcribing" || practiceConv.state === "thinking" || practiceConv.state === "speaking") && (
            <button onClick={practiceConv.cancel} className="underline underline-offset-2">
              {t.cancel}
            </button>
          )}
        </p>
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

      {/* Word definition popup — hover previews, click pins, click again to
          navigate through to the full word page. Each sense has its own
          add/remove button — ambiguous words don't force a single pick. */}
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
