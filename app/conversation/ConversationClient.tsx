"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ArrowUp, ChevronLeft, LayoutList, Mic, Plus, Trash2 } from "lucide-react";
import { HomeButton } from "@/app/_components/HomeButton";
import { useRouter } from "next/navigation";
import { getConversationContext } from "@/app/actions/vocabulary";
import { saveMessages } from "@/app/actions/chat";
import type { MasteryMap } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { useLanguage } from "@/app/_components/LanguageContext";
import { segmentIntoWords, charSegmentIndex } from "@/lib/segment";
import { useWordPopup, WordPopupCard } from "@/components/WordPopup";
import { useIsDesktopPointer } from "@/lib/useIsDesktopPointer";
import { useHasExtension } from "@/lib/useHasExtension";

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

function autoTitle(text: string): string {
  return text.length > 28 ? text.slice(0, 28) + "…" : text;
}

export function ConversationClient({ masteryMap }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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
  // once router.refresh() below lands a fresher one. Without this, a word
  // saved just before navigating away — or one that was simply missing from
  // that stale first snapshot — stays permanently unmarked (both here and in
  // the popup's own saved-state, which reads masteryMap directly) until a
  // hard reload. Union, never remove, so this can't clobber an optimistic
  // same-session add that masteryMap hasn't caught up to yet.
  useEffect(() => {
    setSavedWords((prev) => {
      const next = new Set(prev);
      for (const hanzi of Object.keys(masteryMap)) next.add(hanzi);
      return next;
    });
  }, [masteryMap]);

  // Actively self-heal the staleness above rather than hoping it doesn't
  // happen: force a fresh server render every time this page mounts, so a
  // cached masteryMap from before you last saved a word gets replaced with
  // a real one instead of sitting there until the cache's ~30s window lapses
  // on its own (or forever, if you're back before then).
  useEffect(() => {
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The mount effect above misses the common mobile case: navigating to the
  // chatbot away and "coming back" via a swipe-back gesture or the browser's
  // back button restores the page from bfcache — the whole React tree is
  // resumed exactly as it was, so this component never remounts and that
  // effect never re-fires. Without this, a word saved elsewhere while you
  // were away (another tab, the extension, another device) stays unhighlighted
  // until a hard reload. `pageshow`'s `persisted` flag is true only on a
  // bfcache restore; a real mount already got the effect above.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) router.refresh();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

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

  // Init: migrate old single-chat format, then load conversations
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
      }
    } catch {
      // ignore
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
        <HomeButton className="flex-shrink-0" />
      </div>

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
                <TappableMessage
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
      <div className="px-4 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 bg-[var(--color-background)] border border-[var(--color-border)] rounded-2xl px-4 py-2 focus-within:border-violet-400 transition-colors">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder={t.typeInput}
            disabled={isLoading || hskLevel === null}
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none disabled:opacity-50"
          />
          <button
            onPointerDown={startRecording}
            onPointerUp={stopRecording}
            onPointerLeave={stopRecording}
            disabled={isLoading || isTranscribing || hskLevel === null}
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
            disabled={isLoading || !input.trim() || hskLevel === null}
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

// ─── TappableMessage ──────────────────────────────────────────────────────────
// Renders AI message text with drag-to-select multi-character words.
// No extra spacing between characters — uses natural inline text flow.

function TappableMessage({
  text,
  masteryMap,
  savedWords,
  onWordClick,
  onWordHover,
  onHoverLeave,
  resolveRange,
  activeWord,
}: {
  text: string;
  masteryMap: MasteryMap;
  savedWords: Set<string>;
  // `word` here is the raw Intl.Segmenter span, not necessarily a real
  // dictionary word — the popup hook resolves `offset` against CEDICT
  // itself. `exact: true` bypasses that (an explicit text selection).
  onWordClick: (word: string, offset: number, x: number, y: number, exact?: boolean) => void;
  onWordHover: (word: string, offset: number, rect: DOMRect) => void;
  onHoverLeave: () => void;
  // Sync lookup of which char range (within a segment) is the actual
  // resolved CEDICT headword — so the highlight can track e.g. just "步步"
  // inside "一步步" instead of lighting up the whole segmenter span.
  resolveRange: (segWord: string, offset: number) => { start: number; end: number };
  // Only used to force a recompute of the highlight once async resolution
  // lands (resolveRange itself reads a ref, so it won't trigger renders).
  activeWord: string | null;
}) {
  type Seg = { type: "hanzi" | "punct" | "other"; content: string; idx: number };
  const segments: Seg[] = [];
  let hanziIdx = 0;

  const cleaned = text.replace(/\s*\([^)]{1,30}\)/g, "");

  for (const char of cleaned) {
    if (/[一-鿿㐀-䶿]/.test(char)) {
      segments.push({ type: "hanzi", content: char, idx: hanziIdx++ });
    } else if (/[，。！？、…]/.test(char)) {
      segments.push({ type: "punct", content: char, idx: -1 });
    } else {
      segments.push({ type: "other", content: char, idx: -1 });
    }
  }

  // Dictionary-based word segmentation over the same char sequence — hover
  // and click both target the whole word ("北京", not "北" + "京").
  const wordSegments = useMemo(() => segmentIntoWords(cleaned), [cleaned]);
  const segIndexAt = useMemo(() => charSegmentIndex(wordSegments), [wordSegments]);
  const [hoverCharIdx, setHoverCharIdx] = useState<number | null>(null);

  // The actual highlighted range — the resolved CEDICT headword's char span
  // within its segment, not the whole (possibly wider) segmenter span.
  const hoverRange = useMemo(() => {
    if (hoverCharIdx === null) return null;
    const seg = wordSegments[segIndexAt[hoverCharIdx]];
    if (!seg || !seg.isWordLike) return { start: hoverCharIdx, end: hoverCharIdx + 1 };
    const offset = hoverCharIdx - seg.start;
    const range = resolveRange(seg.word, offset);
    return { start: seg.start + range.start, end: seg.start + range.end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverCharIdx, wordSegments, segIndexAt, resolveRange, activeWord]);

  // Desktop (real mouse) defers entirely to the browser extension, which
  // needs a genuine native selection to detect — and would otherwise pop up
  // side-by-side with this component's own card for the same selection.
  // Touch devices (no extension, worse UX for drag-to-select CJK text) keep
  // the in-app popup exactly as before. Only actually defer when the
  // extension is confirmed present on this page (see useHasExtension) —
  // otherwise a desktop browser/profile/window without it installed would
  // get no popup at all, not even this app's own.
  const isDesktop = useIsDesktopPointer();
  const hasExtension = useHasExtension();
  const deferToExtension = isDesktop && hasExtension;
  const containerRef = useRef<HTMLDivElement>(null);
  const onWordClickRef = useRef(onWordClick);
  useEffect(() => { onWordClickRef.current = onWordClick; }, [onWordClick]);
  const hanziSegs = segments.filter((s) => s.type === "hanzi");
  const hanziStr = hanziSegs.map((s) => s.content).join("");
  const savedCoveredIndices = new Set<number>();
  for (const word of savedWords) {
    if (word.length <= 1) continue;
    let pos = 0;
    while ((pos = hanziStr.indexOf(word, pos)) !== -1) {
      for (let j = pos; j < pos + word.length; j++) {
        savedCoveredIndices.add(hanziSegs[j].idx);
      }
      pos++;
    }
  }

  useEffect(() => {
    if (deferToExtension) return; // leave native selection alone for the extension
    const el = containerRef.current;
    if (!el) return;
    const onEnd = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const selected = sel.toString().replace(/[^一-鿿㐀-䶿]/g, "");
        if (selected.length >= 1) {
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          // Explicit text selection — a literal override, skip CEDICT resolution.
          onWordClickRef.current(selected, 0, rect.left + rect.width / 2, rect.top, true);
          setTimeout(() => sel.removeAllRanges(), 150);
        }
      }, 50);
    };
    el.addEventListener("mouseup", onEnd);
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("mouseup", onEnd);
      el.removeEventListener("touchend", onEnd);
    };
  }, [deferToExtension]);

  return (
    <div
      ref={containerRef}
      className="leading-loose text-[15px]"
    >
      {segments.map((seg, i) => {
        if (seg.type === "punct") {
          return (
            <span key={i} className="text-[var(--color-text-muted)]">
              {seg.content}
            </span>
          );
        }
        if (seg.type === "other") {
          return <span key={i}>{seg.content}</span>;
        }

        const isSaved = savedWords.has(seg.content) || savedCoveredIndices.has(seg.idx);
        // Aggregate across every saved sense of this hanzi — the highlight
        // is per-character, not per-sense (the popup handles per-sense detail).
        const isLearning = (masteryMap[seg.content] ?? []).some((s) => s.stability < HIGH_STABILITY_THRESHOLD);
        const wordSeg = wordSegments[segIndexAt[i]];
        const dictWord = wordSeg && wordSeg.isWordLike ? wordSeg.word : seg.content;
        const offset = wordSeg && wordSeg.isWordLike ? i - wordSeg.start : 0;
        const isInHoverWord = hoverRange !== null && i >= hoverRange.start && i < hoverRange.end;

        // No per-token tap-to-open — the extension never responds to a bare
        // tap/click either, only to an actual text selection (the `onEnd`
        // listener above). Matching that exactly means a single tap here
        // does nothing on any device; only drag-select / double-tap-select
        // (a real selection) triggers a lookup, same as the extension.
        return (
          <span
            key={i}
            data-word-token
            onPointerEnter={(e) => {
              if (!deferToExtension && e.pointerType === "mouse") {
                setHoverCharIdx(i);
                onWordHover(dictWord, offset, e.currentTarget.getBoundingClientRect());
              }
            }}
            onPointerLeave={(e) => {
              if (!deferToExtension && e.pointerType === "mouse") {
                setHoverCharIdx(null);
                onHoverLeave();
              }
            }}
            className={`cursor-text rounded-sm transition-colors ${
              isSaved
                ? "word-token word-token--mistake"
                : isLearning
                ? "word-token word-token--unknown"
                : isInHoverWord
                ? "bg-violet-500/15"
                : "hover:bg-slate-100"
            }`}
          >
            {seg.content}
          </span>
        );
      })}
    </div>
  );
}
