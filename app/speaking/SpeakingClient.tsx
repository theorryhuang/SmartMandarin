"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useVoiceConversation } from "@/hooks/useVoiceConversation";
import { TranscriptView } from "@/components/TranscriptView";
import { getConversationContext } from "@/app/actions/vocabulary";
import { persistVocabToggle } from "@/components/WordPopup";
import { saveSpeakingTurns, loadRecentSpeakingTurns } from "@/app/actions/speaking";
import type { ConversationTurn, TranscriptToken } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";
import { HomeButton } from "@/app/_components/HomeButton";

interface WordSense {
  pinyin: string;
  meaning: string;
  hsk_level?: number | null;
}

interface SheetInfo {
  word: string;
  pinyin?: string;
  meaning?: string;
  hsk_level?: number | null;
  saved: boolean;
  source?: string;
  senses?: WordSense[];
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

function initRevealedTurns(turns: ConversationTurn[]): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem("sm_revealed_turns");
    if (!raw) return new Set();
    const timestamps = new Set(JSON.parse(raw) as string[]);
    const revealed = new Set<number>();
    turns.forEach((t, i) => { if (timestamps.has(t.timestamp)) revealed.add(i); });
    return revealed;
  } catch {
    return new Set();
  }
}

export function SpeakingClient() {
  const router = useRouter();
  const { t } = useLanguage();

  // ── Turns — initialised synchronously from localStorage ──────────────────
  const [turns, setTurns] = useState<ConversationTurn[]>(loadTurnsFromStorage);
  const [revealedTurns, setRevealedTurns] = useState<Set<number>>(() => initRevealedTurns(loadTurnsFromStorage()));

  const [slangMode, setSlangMode] = useState(false);
  useEffect(() => {
    setSlangMode(localStorage.getItem("sm_slang_mode") === "1");
  }, []);
  const [speechRate, setSpeechRate] = useState(1);
  const [playingTurnIndex, setPlayingTurnIndex] = useState<number | null>(null);
  const [isSpeechPaused, setIsSpeechPaused] = useState(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
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
      setSavedWords(new Set(unknownWords.map((w) => w.hanzi)));
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
          // Merge tokens into the existing turn (shouldn't normally happen but safe)
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
        return [...prev, newTurn];
      });
    },
    []
  );

  const handleAITurnEnd = useCallback(() => setForcedWords([]), []);

  useEffect(() => {
    const timestamps = [...revealedTurns].map((i) => turns[i]?.timestamp).filter(Boolean);
    localStorage.setItem("sm_revealed_turns", JSON.stringify(timestamps));
  }, [revealedTurns, turns]);

  const revealTurn = useCallback(
    (i: number) => setRevealedTurns((s) => new Set(s).add(i)),
    []
  );

  const hideTurn = useCallback(
    (i: number) => setRevealedTurns((s) => { const next = new Set(s); next.delete(i); return next; }),
    []
  );

  const { state, error, startRecording, stopRecording, cancel, replay } = useVoiceConversation({
    slangMode,
    forcedWords,
    hskLevel,
    unknownWords,
    onTranscriptUpdate: handleTranscriptUpdate,
    onAITurnEnd: handleAITurnEnd,
    initialHistory: initialHistory.current,
    speechRate,
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
            body: JSON.stringify({ hanzi: word, slang_mode: slangMode }),
          });
          const def = await res.json();
          if (def.pinyin || def.meaning) {
            setSheet((s) =>
              s?.word === word
                ? { ...s, pinyin: def.pinyin || s.pinyin, meaning: def.meaning || s.meaning, hsk_level: def.hsk_level ?? null, source: def.source, senses: def.senses, saved: s.saved || !!def.already_saved }
                : s
            );
          }
        } catch { /* ignore */ }
      }
    },
    [unknownWords, savedWords, slangMode]
  );

  // User picked a specific sense from the sheet's disambiguation list.
  const handlePickSense = useCallback((sense: WordSense) => {
    setSheet((s) =>
      s ? { ...s, pinyin: sense.pinyin, meaning: sense.meaning, hsk_level: sense.hsk_level ?? s.hsk_level, senses: undefined } : s
    );
  }, []);

  const handleAddToSaved = useCallback(async () => {
    if (!sheet) return;
    const { word } = sheet;
    setSavedWords((prev) => new Set([...prev, word]));
    setForcedWords((prev) => (prev.includes(word) ? prev : [...prev, word]));
    setSheet((s) => (s ? { ...s, saved: true } : s));
    // keepalive fetch, not a Server Action — see persistVocabToggle for why
    // (this fires right before the user is free to navigate away).
    const ok = await persistVocabToggle("add", word, {
      pinyin: sheet.pinyin ?? "",
      meaning: sheet.meaning ?? "",
      hsk_level: sheet.hsk_level ?? null,
    });
    if (!ok) {
      // Didn't actually land — undo the optimistic flip instead of leaving
      // the UI claiming a save the database doesn't have.
      setSavedWords((prev) => { const next = new Set(prev); next.delete(word); return next; });
      setForcedWords((prev) => prev.filter((w) => w !== word));
      setSheet((s) => (s ? { ...s, saved: false } : s));
      return;
    }
    router.refresh();
  }, [sheet, router]);

  const handleRemoveFromSaved = useCallback(async () => {
    if (!sheet) return;
    const { word } = sheet;
    setSavedWords((prev) => { const next = new Set(prev); next.delete(word); return next; });
    setForcedWords((prev) => prev.filter((w) => w !== word));
    setSheet((s) => (s ? { ...s, saved: false } : s));
    // Actually delete — this is the "remove from my vocab list" action, not
    // just clearing the forced-reinjection flag (see WordPopup's toggleSense
    // for the same fix and why) — and keepalive for the same reason as
    // handleAddToSaved above.
    const ok = await persistVocabToggle("remove", word, { pinyin: sheet.pinyin ?? "", meaning: sheet.meaning ?? "" });
    if (!ok) {
      setSavedWords((prev) => new Set([...prev, word]));
      setForcedWords((prev) => (prev.includes(word) ? prev : [...prev, word]));
      setSheet((s) => (s ? { ...s, saved: true } : s));
      return;
    }
    router.refresh();
  }, [sheet, router]);

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
          savedWords={savedWords}
          onWordSelect={handleWordSelect}
          onRevealTurn={revealTurn}
          onHideTurn={hideTurn}
          playingTurnIndex={playingTurnIndex}
          isSpeechPaused={isSpeechPaused}
          onReplayTurn={(i) => {
            const turn = turns[i];
            const isUser = turn?.role === "user";

            // Toggle pause/resume for the currently playing turn
            if (playingTurnIndex === i) {
              if (isSpeechPaused) {
                if (isUser && activeAudioRef.current) {
                  activeAudioRef.current.play();
                } else {
                  window.speechSynthesis?.resume();
                }
                setIsSpeechPaused(false);
              } else {
                if (isUser && activeAudioRef.current) {
                  activeAudioRef.current.pause();
                } else {
                  window.speechSynthesis?.pause();
                }
                setIsSpeechPaused(true);
              }
              return;
            }

            // Stop whatever is currently playing
            window.speechSynthesis?.cancel();
            if (activeAudioRef.current) {
              activeAudioRef.current.pause();
              activeAudioRef.current = null;
            }
            setIsSpeechPaused(false);
            setPlayingTurnIndex(i);

            if (isUser && turn?.audioUrl) {
              const audio = new Audio(turn.audioUrl);
              activeAudioRef.current = audio;
              audio.onended = () => { setPlayingTurnIndex(null); activeAudioRef.current = null; };
              audio.play();
            } else {
              replay(turn?.raw_text ?? "", () => setPlayingTurnIndex(null));
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
            className="flex-1 accent-violet-600 cursor-pointer"
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

      {/* Bottom sheet — word lookup */}
      {sheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSheet(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-3xl px-6 py-6 flex flex-col items-center gap-4 shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            <span className="text-5xl font-medium tracking-tight text-[var(--color-text-primary)]">
              {sheet.word}
            </span>
            {sheet.senses && sheet.senses.length > 1 ? (
              <div className="w-full max-w-xs flex flex-col gap-2">
                <span className="text-xs text-[var(--color-text-muted)] text-center">{t.multipleSenses}</span>
                {sheet.senses.map((sense, i) => (
                  <button
                    key={i}
                    onClick={() => handlePickSense(sense)}
                    className="w-full text-left px-3 py-2 rounded-xl border border-[var(--color-border)] hover:border-violet-400 hover:bg-violet-50 transition-colors"
                  >
                    <div className="text-sm text-[var(--color-text-secondary)]">{sense.pinyin}</div>
                    <div className="text-sm text-[var(--color-text-primary)]">{sense.meaning}</div>
                  </button>
                ))}
              </div>
            ) : (
              <>
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
              </>
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
