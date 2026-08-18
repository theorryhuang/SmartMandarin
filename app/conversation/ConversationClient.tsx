"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowUp, ChevronLeft, LayoutList, Mic, MicOff, Phone, PhoneOff, Plus, Trash2 } from "lucide-react";
import { HomeButton } from "@/app/_components/HomeButton";
import { useRouter } from "next/navigation";
import { getConversationContext, getSavedHanziSet } from "@/app/actions/vocabulary";
import { saveMessages, loadOlderMessages, getConversationList, deleteConversationMessages } from "@/app/actions/chat";
import type { MasteryMap } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";
import { useWordPopup, WordPopupCard } from "@/components/WordPopup";
import { TappableText } from "@/components/TappableText";
import { useGeminiLive } from "@/hooks/useGeminiLive";

interface Message {
  role: "user" | "assistant";
  content: string;
  id: string;
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
  const router = useRouter();
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

  const [slangMode, setSlangMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sm_slang_mode") === "1";
  });

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
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activeConvIdRef = useRef<string>("");

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
  }, []);

  const createNewConversation = useCallback(() => {
    const id = `conv_${Date.now()}`;
    const meta: ConversationMeta = { id, title: "", createdAt: Date.now(), updatedAt: Date.now() };

    setConversations((prev) => {
      const updated = [meta, ...prev];
      localStorage.setItem("sm_conversations", JSON.stringify(updated));
      return updated;
    });

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
  }, []);

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
  }, []);

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

  const startRecording = useCallback(async () => {
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "audio.webm");
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await res.json();
          const text = data.text?.trim() ?? "";
          const blocked = isBoilerplate(text);
          console.log("[transcribe] raw:", JSON.stringify(text));
          console.log("[transcribe] blob size:", blob.size, "mime:", mimeType);
          console.log("[transcribe] boilerplate blocked:", blocked);
          if (text && !blocked) {
            setInput(text);
            inputRef.current?.focus();
          }
        } catch { /* ignore */ } finally {
          setIsTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch { /* mic denied */ }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
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
  const activeConvTitle = conversations.find((c) => c.id === activeConvId)?.title || t.newChat;

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => router.push("/")}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--color-background)] transition-colors flex-shrink-0"
        >
          <ChevronLeft size={20} className="text-[var(--color-text-muted)]" />
        </button>

        <div className="w-9 h-9 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm font-medium select-none">灵</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-[var(--color-text-primary)]">小灵</div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-xs text-[var(--color-text-muted)] truncate">
              {activeConvTitle}
            </span>
          </div>
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
        <button
          onClick={() => (liveActive ? liveConv.disconnect() : liveConv.connect())}
          disabled={hskLevel === null}
          title={liveConv.connectionState === "connected" ? "End live voice call" : "Start live voice call"}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-40 ${
            liveActive
              ? "bg-red-500 text-white"
              : "hover:bg-[var(--color-background)] text-[var(--color-text-muted)]"
          }`}
        >
          {liveActive ? <PhoneOff size={16} /> : <Phone size={16} />}
        </button>
        <HomeButton className="flex-shrink-0" />
      </div>

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

        {messages.map((msg) => (
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
              className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] ${
                msg.role === "user"
                  ? "bg-violet-600 text-white rounded-tr-sm"
                  : "bg-[var(--color-surface)] text-[var(--color-text-primary)] rounded-tl-sm border border-[var(--color-border)] shadow-sm"
              }`}
            >
              {msg.role === "assistant" ? (
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
              )}
            </div>
          </div>
        ))}

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
      {chatError && (
        <div className="px-4 py-2.5 bg-red-900/10 border-t border-red-800/30">
          <p className="text-sm text-red-500">{chatError}</p>
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

      {/* ── Input ── */}
      {/* Disabled while a live call is up — that session owns the mic and
          drives its own turns, a text/hold-to-record message alongside it
          would interleave unpredictably with the open audio stream. */}
      <div className="px-4 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 bg-[var(--color-background)] border border-[var(--color-border)] rounded-2xl px-4 py-2 focus-within:border-violet-400 transition-colors">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder={liveActive ? "Live call in progress…" : t.typeInput}
            disabled={isLoading || hskLevel === null || liveActive}
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none disabled:opacity-50"
          />
          <button
            onPointerDown={startRecording}
            onPointerUp={stopRecording}
            onPointerLeave={stopRecording}
            disabled={isLoading || isTranscribing || hskLevel === null || liveActive}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0 ${
              isRecording
                ? "bg-red-500"
                : "bg-[var(--color-border)] hover:bg-slate-300"
            }`}
          >
            {isTranscribing ? (
              <span className="w-3 h-3 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            ) : (
              <Mic size={15} className={isRecording ? "text-white" : "text-[var(--color-text-muted)]"} />
            )}
          </button>
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || hskLevel === null || liveActive}
            className="w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-700 flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <ArrowUp size={15} className="text-white" />
          </button>
        </div>
        <p className="text-center text-[10px] text-[var(--color-text-muted)] mt-1.5">
          {t.tapToSelect}
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

function isBoilerplate(text: string): boolean {
  return /点赞|订阅|转发|打赏|明镜|点点栏目/.test(text);
}

function getSupportedMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const type of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "audio/webm";
}
