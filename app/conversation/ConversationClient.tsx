"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowUp, ChevronLeft, LayoutList, Mic, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { getConversationContext, logMistake, removeFromReviewQueue } from "@/app/actions/vocabulary";
import { saveMessages } from "@/app/actions/chat";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { useLanguage } from "@/app/_components/LanguageContext";

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

interface SheetInfo {
  word: string;
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  saved: boolean;
  source?: string;
}

interface Props {
  masteryMap: Record<string, VocabularyMastery>;
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
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [slangMode, setSlangMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sm_slang_mode") === "1";
  });
  const [hskLevel, setHskLevel] = useState<number | null>(null);
  const [unknownWords, setUnknownWords] = useState<
    { hanzi: string; pinyin: string; meaning: string }[]
  >([]);
  const [forcedWords, setForcedWords] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showFullMeaning, setShowFullMeaning] = useState(false);

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
    getConversationContext().then(({ hskLevel, unknownWords }) => {
      setHskLevel(hskLevel);
      setUnknownWords(unknownWords);
      setSavedWords(new Set(unknownWords.map((w) => w.hanzi)));
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
      if (msgs) setMessages(JSON.parse(msgs));
      if (hist) historyRef.current = JSON.parse(hist);
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
    try {
      const msgs = localStorage.getItem(`sm_conv_messages_${convId}`);
      const hist = localStorage.getItem(`sm_conv_history_${convId}`);
      if (msgs) newMsgs = JSON.parse(msgs);
      if (hist) newHist = JSON.parse(hist);
    } catch {}

    historyRef.current = newHist;
    setMessages(newMsgs);
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
    setActiveConvId(id);
    localStorage.setItem("sm_active_conv", id);
    setShowChatList(false);
  }, []);

  const deleteConversation = useCallback((convId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    localStorage.removeItem(`sm_conv_messages_${convId}`);
    localStorage.removeItem(`sm_conv_history_${convId}`);

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
        try {
          const msgs = localStorage.getItem(`sm_conv_messages_${target.id}`);
          const hist = localStorage.getItem(`sm_conv_history_${target.id}`);
          if (msgs) newMsgs = JSON.parse(msgs);
          if (hist) newHist = JSON.parse(hist);
        } catch {}
        historyRef.current = newHist;
        setMessages(newMsgs);
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

  const handleWordSelect = useCallback(
    async (word: string, context?: string) => {
      if (!word) return;
      const mastery = masteryMap[word];
      const isSaved = savedWords.has(word) || !!mastery;

      setShowFullMeaning(false);
      setSheet({
        word,
        saved: isSaved,
        pinyin: mastery?.pinyin,
        meaning: mastery?.meaning,
      });

      if (!mastery?.pinyin && !mastery?.meaning) {
        try {
          const res = await fetch("/api/define-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hanzi: word, slang_mode: slangMode, context }),
          });
          const def = await res.json();
          if (def.pinyin || def.meaning) {
            setSheet((s) =>
              s?.word === word
                ? { ...s, pinyin: def.pinyin || s.pinyin, meaning: def.meaning || s.meaning, hsk_level: def.hsk_level ?? null, source: def.source, saved: s.saved || !!def.already_saved }
                : s
            );
          }
        } catch {}
      }
    },
    [savedWords, masteryMap, slangMode]
  );

  const handleAddToSaved = useCallback(async () => {
    if (!sheet) return;
    const { word } = sheet;
    const mastery = masteryMap[word];
    setSavedWords((prev) => new Set([...prev, word]));
    setForcedWords((prev) => (prev.includes(word) ? prev : [...prev, word]));
    setSheet((s) => s ? { ...s, saved: true } : s);
    await logMistake(mastery?.id ?? word, {
      pinyin: mastery?.pinyin ?? sheet.pinyin,
      meaning: mastery?.meaning ?? sheet.meaning,
      hsk_level: mastery?.hsk_level ?? sheet.hsk_level ?? undefined,
    }).catch(() => {});
  }, [sheet, masteryMap]);

  const handleRemoveFromSaved = useCallback(async () => {
    if (!sheet) return;
    const { word } = sheet;
    setSavedWords((prev) => { const next = new Set(prev); next.delete(word); return next; });
    setForcedWords((prev) => prev.filter((w) => w !== word));
    setSheet((s) => s ? { ...s, saved: false } : s);
    const mastery = masteryMap[word];
    await removeFromReviewQueue(mastery?.id ?? word).catch(() => {});
  }, [sheet, masteryMap]);

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
                  onWordSelect={handleWordSelect}
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

      {/* ── Bottom sheet ── */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSheet(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-3xl px-6 py-6 flex flex-col items-center gap-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            <span className="text-5xl font-medium tracking-tight text-[var(--color-text-primary)]">
              {sheet.word}
            </span>
            {sheet.pinyin ? (
              <span className="text-lg text-[var(--color-text-secondary)]">{sheet.pinyin}</span>
            ) : (
              <span className="text-sm text-[var(--color-text-muted)] italic animate-pulse">
                {t.lookingUp}
              </span>
            )}
            {sheet.meaning ? (
              <div className="text-center w-full max-w-xs">
                <span className={`text-base text-[var(--color-text-primary)] ${!showFullMeaning && sheet.meaning.length > 60 ? "line-clamp-3" : ""}`}>
                  {sheet.meaning}
                </span>
                {sheet.meaning.length > 60 && (
                  <button
                    onClick={() => setShowFullMeaning((s) => !s)}
                    className="text-xs text-violet-500 mt-1 block mx-auto"
                  >
                    {showFullMeaning ? t.showLess : t.showMore}
                  </button>
                )}
              </div>
            ) : sheet.pinyin ? (
              <span className="text-sm text-[var(--color-text-muted)] italic">
                {t.noDefinition}
              </span>
            ) : null}
            {sheet.source === "ai" && !sheet.saved && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center max-w-xs">
                {t.aiDefinitionWarning}
              </p>
            )}
            {sheet.saved ? (
              <button
                onClick={handleRemoveFromSaved}
                className="w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2 bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 cursor-pointer"
              >
                {t.removeFromReview}
              </button>
            ) : (
              <button
                onClick={handleAddToSaved}
                className="w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2 bg-violet-50 hover:bg-violet-100 text-violet-600 border border-violet-200 cursor-pointer"
              >
                {t.queueForReview}
              </button>
            )}
            <button
              onClick={() => setSheet(null)}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors pb-2"
            >
              {t.dismiss}
            </button>
          </div>
        </>
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
  onWordSelect,
}: {
  text: string;
  masteryMap: Record<string, VocabularyMastery>;
  savedWords: Set<string>;
  onWordSelect: (word: string, context: string) => void;
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

  const containerRef = useRef<HTMLDivElement>(null);
  const onWordSelectRef = useRef(onWordSelect);
  useEffect(() => { onWordSelectRef.current = onWordSelect; }, [onWordSelect]);

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
    const el = containerRef.current;
    if (!el) return;
    const onEnd = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const selected = sel.toString().replace(/[^一-鿿㐀-䶿]/g, "");
        if (selected.length >= 1) {
          onWordSelectRef.current(selected, text);
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
  }, []);

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
        const mastery = masteryMap[seg.content];
        const isLearning = mastery && mastery.stability < HIGH_STABILITY_THRESHOLD;

        return (
          <span
            key={i}
            onClick={() => {
              const sel = window.getSelection();
              if (sel && !sel.isCollapsed) return;
              onWordSelect(seg.content, text);
            }}
            className={`cursor-pointer rounded-sm transition-colors ${
              isSaved
                ? "word-token word-token--mistake"
                : isLearning
                ? "word-token word-token--unknown"
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
