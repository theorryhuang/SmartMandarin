"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowUp, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { getConversationContext, logMistake } from "@/app/actions/vocabulary";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";

interface Message {
  role: "user" | "assistant";
  content: string;
  id: string;
}

interface SheetInfo {
  word: string;
  pinyin?: string;
  meaning?: string;
  saved: boolean;
}

interface Props {
  masteryMap: Record<string, VocabularyMastery>;
}

export function ConversationClient({ masteryMap }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [slangMode, setSlangMode] = useState(false);
  const [hskLevel, setHskLevel] = useState<number | null>(null);
  const [unknownWords, setUnknownWords] = useState<
    { hanzi: string; pinyin: string; meaning: string }[]
  >([]);
  const [forcedWords, setForcedWords] = useState<string[]>([]);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getConversationContext().then(({ hskLevel, unknownWords }) => {
      setHskLevel(hskLevel);
      setUnknownWords(unknownWords);
    });
  }, []);

  // Restore persisted chat on mount
  useEffect(() => {
    try {
      const savedMsgs = localStorage.getItem("sm_conv_messages");
      const savedHistory = localStorage.getItem("sm_conv_history");
      if (savedMsgs) setMessages(JSON.parse(savedMsgs));
      if (savedHistory) historyRef.current = JSON.parse(savedHistory);
    } catch { /* ignore */ }
  }, []);

  // Persist messages whenever they change
  useEffect(() => {
    try {
      localStorage.setItem("sm_conv_messages", JSON.stringify(messages));
    } catch { /* ignore */ }
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || hskLevel === null) return;

    setInput("");
    inputRef.current?.focus();

    const userMsg: Message = { role: "user", content: text, id: Date.now().toString() };
    setMessages((prev) => [...prev, userMsg]);

    historyRef.current = [
      ...historyRef.current,
      { role: "user" as const, content: text },
    ].slice(-20);
    try { localStorage.setItem("sm_conv_history", JSON.stringify(historyRef.current)); } catch { /* ignore */ }

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
        historyRef.current = [
          ...historyRef.current,
          { role: "assistant" as const, content: data.reply },
        ].slice(-20);
        try { localStorage.setItem("sm_conv_history", JSON.stringify(historyRef.current)); } catch { /* ignore */ }
        setForcedWords([]);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, hskLevel, slangMode, forcedWords, unknownWords]);

  const handleWordSelect = useCallback(
    async (word: string) => {
      if (!word) return;
      setSheet({ word, saved: savedWords.has(word) });

      // Check mastery map for single-char or the exact multi-char word
      const mastery = masteryMap[word];
      if (mastery?.pinyin || mastery?.meaning) {
        setSheet((s) =>
          s?.word === word ? { ...s, pinyin: mastery.pinyin, meaning: mastery.meaning } : s
        );
        return;
      }

      try {
        const res = await fetch("/api/define-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hanzi: word, hsk_level: hskLevel ?? 1 }),
        });
        const def = await res.json();
        if (def.pinyin || def.meaning) {
          setSheet((s) =>
            s?.word === word ? { ...s, pinyin: def.pinyin, meaning: def.meaning } : s
          );
        }
      } catch {
        // ignore
      }
    },
    [savedWords, masteryMap, hskLevel]
  );

  const handleSave = useCallback(async () => {
    if (!sheet) return;
    const { word, pinyin, meaning } = sheet;

    setSavedWords((prev) => {
      const next = new Set(prev);
      next.add(word);
      return next;
    });
    setForcedWords((prev) => (prev.includes(word) ? prev : [...prev, word]));
    setSheet((s) => (s ? { ...s, saved: true } : null));

    await logMistake(masteryMap[word]?.id ?? word, {
      pinyin,
      meaning,
      hsk_level: masteryMap[word]?.hsk_level ?? hskLevel ?? 1,
    });
  }, [sheet, masteryMap, hskLevel]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
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
            <span className="text-xs text-[var(--color-text-muted)]">
              {hskLevel !== null ? `HSK ${hskLevel}` : "…"}
            </span>
          </div>
        </div>

        <button
          onClick={() => setSlangMode((s) => !s)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex-shrink-0 ${
            slangMode
              ? "bg-violet-100 border-violet-300 text-violet-700"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? "🔥 Slang" : "Slang"}
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
                Type anything to start chatting in Mandarin
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
          <span className="text-xs text-[var(--color-text-muted)] self-center">will use:</span>
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
            placeholder="Type in Mandarin or English…"
            disabled={isLoading || hskLevel === null}
            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || hskLevel === null}
            className="w-8 h-8 rounded-full bg-violet-600 hover:bg-violet-700 flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <ArrowUp size={15} className="text-white" />
          </button>
        </div>
        <p className="text-center text-[10px] text-[var(--color-text-muted)] mt-1.5">
          Tap or drag to select words · save them for review
        </p>
      </div>

      {/* ── Bottom sheet ── */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSheet(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-3xl px-6 py-6 flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            <span className="text-5xl font-medium tracking-tight text-[var(--color-text-primary)]">
              {sheet.word}
            </span>
            {sheet.pinyin ? (
              <span className="text-lg text-[var(--color-text-secondary)]">{sheet.pinyin}</span>
            ) : (
              <span className="text-sm text-[var(--color-text-muted)] italic animate-pulse">
                Looking up…
              </span>
            )}
            {sheet.meaning ? (
              <span className="text-base text-[var(--color-text-primary)] text-center">
                {sheet.meaning}
              </span>
            ) : sheet.pinyin ? (
              <span className="text-sm text-[var(--color-text-muted)] italic">
                no definition found
              </span>
            ) : null}
            <button
              onClick={handleSave}
              disabled={sheet.saved}
              className={`w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2 ${
                sheet.saved
                  ? "bg-red-50 text-red-500 border border-red-200 cursor-default"
                  : "bg-violet-600 hover:bg-violet-700 text-white cursor-pointer"
              }`}
            >
              {sheet.saved ? "Saved for review" : "Save for review"}
            </button>
            <button
              onClick={() => setSheet(null)}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors pb-2"
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  );
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
  onWordSelect: (word: string) => void;
}) {
  // Parse into Chinese chars vs. punctuation/other segments
  type Seg = { type: "hanzi" | "punct" | "other"; content: string; idx: number };
  const segments: Seg[] = [];
  let hanziIdx = 0;

  // Strip parenthetical pinyin the model might sneak in
  const cleaned = text.replace(/\s*\([^)]{1,30}\)/g, "");

  for (const char of cleaned) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
      segments.push({ type: "hanzi", content: char, idx: hanziIdx++ });
    } else if (/[，。！？、…]/.test(char)) {
      segments.push({ type: "punct", content: char, idx: -1 });
    } else {
      segments.push({ type: "other", content: char, idx: -1 });
    }
  }

  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const selLo = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const selHi = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  function handlePointerDown(hanziI: number) {
    setSelStart(hanziI);
    setSelEnd(hanziI);
    setIsSelecting(true);
  }

  function handlePointerEnter(hanziI: number) {
    if (isSelecting) setSelEnd(hanziI);
  }

  function handlePointerUp() {
    if (!isSelecting || selLo === null || selHi === null) return;
    setIsSelecting(false);
    const word = segments
      .filter((s) => s.type === "hanzi" && s.idx >= selLo && s.idx <= selHi)
      .map((s) => s.content)
      .join("");
    if (word) onWordSelect(word);
    setSelStart(null);
    setSelEnd(null);
  }

  return (
    <div
      className="leading-loose text-[15px] select-none"
      onPointerUp={handlePointerUp}
      onPointerLeave={() => { if (isSelecting) handlePointerUp(); }}
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

        // hanzi
        const isInSel = selLo !== null && selHi !== null && seg.idx >= selLo && seg.idx <= selHi;
        // Match exact single-char save, or this char being part of a saved compound
        const isSaved = savedWords.has(seg.content) ||
          [...savedWords].some((w) => w.length > 1 && w.includes(seg.content));
        const mastery = masteryMap[seg.content];
        const isLearning = mastery && mastery.stability < HIGH_STABILITY_THRESHOLD;

        return (
          <span
            key={i}
            onPointerDown={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              handlePointerDown(seg.idx);
            }}
            onPointerEnter={() => handlePointerEnter(seg.idx)}
            className={`cursor-pointer rounded-sm transition-colors ${
              isInSel
                ? "bg-violet-200 text-violet-900"
                : isSaved
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
