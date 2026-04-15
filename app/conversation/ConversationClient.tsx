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
  char: string;
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
  const [savedChars, setSavedChars] = useState<Set<string>>(new Set());
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
        setForcedWords([]);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, hskLevel, slangMode, forcedWords, unknownWords]);

  const handleCharTap = useCallback(
    async (char: string) => {
      if (/[，。！？、…\s\n()（）\[\]]/.test(char)) return;
      setSheet({ char, saved: savedChars.has(char) });

      const mastery = masteryMap[char];
      if (mastery?.pinyin || mastery?.meaning) {
        setSheet((s) =>
          s?.char === char ? { ...s, pinyin: mastery.pinyin, meaning: mastery.meaning } : s
        );
        return;
      }

      try {
        const res = await fetch("/api/define-word", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hanzi: char, hsk_level: hskLevel ?? 1 }),
        });
        const def = await res.json();
        if (def.pinyin || def.meaning) {
          setSheet((s) =>
            s?.char === char ? { ...s, pinyin: def.pinyin, meaning: def.meaning } : s
          );
        }
      } catch {
        // ignore
      }
    },
    [savedChars, masteryMap, hskLevel]
  );

  const handleSave = useCallback(async () => {
    if (!sheet) return;
    const { char, pinyin, meaning } = sheet;
    setSavedChars((prev) => new Set([...prev, char]));
    setForcedWords((prev) => (prev.includes(char) ? prev : [...prev, char]));
    setSheet((s) => (s ? { ...s, saved: true } : null));
    await logMistake(masteryMap[char]?.id ?? char, {
      pinyin,
      meaning,
      hsk_level: masteryMap[char]?.hsk_level ?? hskLevel ?? 1,
    });
  }, [sheet, masteryMap, hskLevel]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-background)]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => router.push("/")}
          className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-[var(--color-surface-raised)] transition-colors flex-shrink-0"
        >
          <ChevronLeft size={20} className="text-[var(--color-text-muted)]" />
        </button>

        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0">
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
              ? "bg-violet-900/40 border-violet-700 text-violet-300"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? "🔥 Slang" : "Slang"}
        </button>
      </div>

      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center pb-12">
            <div className="w-16 h-16 rounded-full bg-violet-700 flex items-center justify-center shadow-lg">
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
              <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-white text-xs font-medium select-none">灵</span>
              </div>
            )}
            <div
              className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                msg.role === "user"
                  ? "bg-violet-700 text-white rounded-tr-sm"
                  : "bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] rounded-tl-sm border border-[var(--color-border)]"
              }`}
            >
              {msg.role === "assistant" ? (
                <TappableText
                  text={msg.content}
                  masteryMap={masteryMap}
                  savedChars={savedChars}
                  onCharTap={handleCharTap}
                />
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-white text-xs font-medium select-none">灵</span>
            </div>
            <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
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
              className="px-2 py-0.5 rounded-full bg-[var(--color-highlight-mistake)] border border-red-800/40 text-red-300 text-xs"
            >
              {w}
            </span>
          ))}
        </div>
      )}

      {/* ── Input ── */}
      <div className="px-4 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-2xl px-4 py-2 focus-within:border-violet-600 transition-colors">
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
            className="w-8 h-8 rounded-full bg-violet-700 hover:bg-violet-600 flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0"
          >
            <ArrowUp size={15} className="text-white" />
          </button>
        </div>
        <p className="text-center text-[10px] text-[var(--color-text-muted)] mt-1.5">
          Tap any word to save it for review
        </p>
      </div>

      {/* ── Bottom sheet ── */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setSheet(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-3xl px-6 py-6 flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-[var(--color-surface-raised)]" />
            <span className="text-6xl font-medium tracking-tight text-[var(--color-text-primary)]">
              {sheet.char}
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
                no definition saved
              </span>
            ) : null}
            <button
              onClick={handleSave}
              disabled={sheet.saved}
              className="w-full max-w-xs py-3 rounded-2xl text-sm font-medium transition-all mt-2"
              style={{
                backgroundColor: sheet.saved ? "rgba(127,29,29,0.4)" : "#6d28d9",
                color: sheet.saved ? "#fca5a5" : "#fff",
                border: sheet.saved ? "1px solid rgba(153,27,27,0.5)" : "none",
                cursor: sheet.saved ? "default" : "pointer",
              }}
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

// ─── TappableText ─────────────────────────────────────────────────────────────

function TappableText({
  text,
  masteryMap,
  savedChars,
  onCharTap,
}: {
  text: string;
  masteryMap: Record<string, VocabularyMastery>;
  savedChars: Set<string>;
  onCharTap: (char: string) => void;
}) {
  const segments: { type: "hanzi" | "pinyin" | "punct" | "other"; content: string }[] = [];
  const re = /\(([^)]+)\)|（([^）]+)）|([，。！？、…])|([^\s，。！？、…（()）\n]+)|(\s+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1] !== undefined) {
      segments.push({ type: "pinyin", content: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ type: "pinyin", content: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ type: "punct", content: match[3] });
    } else if (match[4] !== undefined) {
      for (const char of match[4]) {
        const isChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(char);
        segments.push({ type: isChinese ? "hanzi" : "other", content: char });
      }
    } else if (match[5] !== undefined) {
      segments.push({ type: "other", content: " " });
    }
  }

  return (
    <span className="inline leading-relaxed">
      {segments.map((seg, i) => {
        // Strip any residual pinyin the model accidentally includes
        if (seg.type === "pinyin") return null;

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

        // hanzi — tappable
        const mastery = masteryMap[seg.content];
        const isSaved = savedChars.has(seg.content);
        const isLearning = mastery && mastery.stability < HIGH_STABILITY_THRESHOLD;

        return (
          <span
            key={i}
            onClick={() => onCharTap(seg.content)}
            className={`cursor-pointer px-0.5 rounded transition-colors ${
              isSaved
                ? "word-token word-token--mistake"
                : isLearning
                ? "word-token word-token--unknown"
                : "word-token"
            }`}
          >
            {seg.content}
          </span>
        );
      })}
    </span>
  );
}
