"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useGroqConversation } from "@/hooks/useGroqConversation";
import { TranscriptView } from "@/components/TranscriptView";
import { logMistake, removeFromReviewQueue, getConversationContext } from "@/app/actions/vocabulary";
import { saveSpeakingTurns, loadRecentSpeakingTurns } from "@/app/actions/speaking";
import type { ConversationTurn, TranscriptToken } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

interface SheetInfo {
  word: string;
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  saved: boolean;
}

// Keep at most this many turns in localStorage; older ones live in Supabase.
const MAX_LOCAL_TURNS = 60;

function loadTurnsFromStorage(): ConversationTurn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("sm_speaking_turns");
    return raw ? (JSON.parse(raw) as ConversationTurn[]) : [];
  } catch {
    return [];
  }
}

export function SpeakingClient() {
  const router = useRouter();
  const { t } = useLanguage();

  // ── Turns — initialised synchronously from localStorage ──────────────────
  const [turns, setTurns] = useState<ConversationTurn[]>(loadTurnsFromStorage);
  const [revealedTurns, setRevealedTurns] = useState<Set<number>>(() => {
    // Reveal all restored turns so history is immediately readable
    const loaded = loadTurnsFromStorage();
    return new Set(loaded.map((_, i) => i));
  });

  const [slangMode, setSlangMode] = useState(false);
  const [forcedWords, setForcedWords] = useState<string[]>([]);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [hskLevel, setHskLevel] = useState(1);
  const [unknownWords, setUnknownWords] = useState<
    { hanzi: string; pinyin: string; meaning: string }[]
  >([]);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);

  // Track which client_ids have been persisted to Supabase already
  const persistedIdsRef = useRef<Set<string>>(new Set(turns.map((t) => t.timestamp)));
  const isFirstRender = useRef(true);

  // ── If localStorage was empty, fall back to Supabase ─────────────────────
  useEffect(() => {
    if (turns.length > 0) return; // already have data
    loadRecentSpeakingTurns(MAX_LOCAL_TURNS)
      .then((loaded) => {
        if (loaded.length === 0) return;
        setTurns(loaded);
        setRevealedTurns(new Set(loaded.map((_, i) => i)));
        persistedIdsRef.current = new Set(loaded.map((t) => t.timestamp));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Save recent turns to localStorage
    const toStore = turns.slice(-MAX_LOCAL_TURNS);
    try {
      localStorage.setItem("sm_speaking_turns", JSON.stringify(toStore));
    } catch { /* ignore quota errors */ }

    // Push any turns not yet in Supabase
    const newTurns = turns.filter((t) => !persistedIdsRef.current.has(t.timestamp));
    if (newTurns.length > 0) {
      saveSpeakingTurns(newTurns).catch(() => {});
      for (const t of newTurns) persistedIdsRef.current.add(t.timestamp);
    }
  }, [turns]);

  // ── Derive LLM history from loaded turns (for AI context continuity) ─────
  const initialHistory = useRef(
    turns.slice(-20).map((t) => ({ role: t.role, content: t.raw_text }))
  );

  const handleTranscriptUpdate = useCallback(
    (tokens: TranscriptToken[], role: "user" | "assistant", audioUrl?: string) => {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role) {
          // Merge tokens into the existing turn (shouldn't normally happen for Groq but safe)
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              tokens: [...last.tokens, ...tokens],
              raw_text: last.raw_text + tokens.map((tk) => tk.hanzi).join(""),
            },
          ];
        }
        const newTurn: ConversationTurn = {
          role,
          tokens,
          raw_text: tokens.map((tk) => tk.hanzi).join(""),
          timestamp: new Date().toISOString(),
          audioUrl,
        };
        // Auto-reveal new turns
        setRevealedTurns((s) => new Set([...s, prev.length]));
        return [...prev, newTurn];
      });
    },
    []
  );

  const handleAITurnEnd = useCallback(() => setForcedWords([]), []);

  const revealTurn = useCallback(
    (i: number) => setRevealedTurns((s) => new Set(s).add(i)),
    []
  );

  const { state, error, startRecording, stopRecording, cancel, replay } = useGroqConversation({
    slangMode,
    forcedWords,
    hskLevel,
    unknownWords,
    onTranscriptUpdate: handleTranscriptUpdate,
    onAITurnEnd: handleAITurnEnd,
    initialHistory: initialHistory.current,
  });

  // ── Word lookup sheet ─────────────────────────────────────────────────────
  const handleWordSelect = useCallback(
    async (word: string) => {
      const cached = unknownWords.find((w) => w.hanzi === word);
      setSheet({
        word,
        pinyin: cached?.pinyin,
        meaning: cached?.meaning,
        saved: savedWords.has(word),
      });

      if (!cached?.pinyin && !cached?.meaning) {
        try {
          const res = await fetch("/api/define-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hanzi: word }),
          });
          const def = await res.json();
          if (def.pinyin || def.meaning) {
            setSheet((s) =>
              s?.word === word
                ? { ...s, pinyin: def.pinyin || s.pinyin, meaning: def.meaning || s.meaning, hsk_level: def.hsk_level ?? null }
                : s
            );
          }
        } catch { /* ignore */ }
      }
    },
    [unknownWords, savedWords]
  );

  const handleAddToSaved = useCallback(async () => {
    if (!sheet) return;
    const { word } = sheet;
    setSavedWords((prev) => new Set([...prev, word]));
    setForcedWords((prev) => (prev.includes(word) ? prev : [...prev, word]));
    setSheet((s) => (s ? { ...s, saved: true } : s));
    await logMistake(word, {
      pinyin: sheet.pinyin,
      meaning: sheet.meaning,
      hsk_level: sheet.hsk_level ?? undefined,
    }).catch(() => {});
  }, [sheet]);

  const handleRemoveFromSaved = useCallback(async () => {
    if (!sheet) return;
    const { word } = sheet;
    setSavedWords((prev) => { const next = new Set(prev); next.delete(word); return next; });
    setForcedWords((prev) => prev.filter((w) => w !== word));
    setSheet((s) => (s ? { ...s, saved: false } : s));
    await removeFromReviewQueue(word).catch(() => {});
  }, [sheet]);

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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
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
          onClick={() => setSlangMode((s) => !s)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex-shrink-0 ${
            slangMode
              ? "bg-violet-100 border-violet-300 text-violet-700"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? t.slangActive : t.slang}
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <TranscriptView
          turns={turns}
          revealedTurns={revealedTurns}
          savedWords={savedWords}
          onWordSelect={handleWordSelect}
          onRevealTurn={revealTurn}
          onReplayTurn={(i) => {
            const turn = turns[i];
            if (turn?.role === "user" && turn.audioUrl) {
              new Audio(turn.audioUrl).play();
            } else {
              replay(turn?.raw_text ?? "");
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

      {/* Bottom sheet — word lookup */}
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
                {t.lookingUp}
              </span>
            )}
            {sheet.meaning ? (
              <span className="text-base text-[var(--color-text-primary)] text-center">
                {sheet.meaning}
              </span>
            ) : sheet.pinyin ? (
              <span className="text-sm text-[var(--color-text-muted)] italic">
                {t.noDefinition}
              </span>
            ) : null}
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
