"use client";

import { useCallback, useState } from "react";
import { Mic, MicOff, PhoneOff, Phone } from "lucide-react";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { TranscriptView } from "@/components/TranscriptView";
import { logMistake } from "@/app/actions/vocabulary";
import type { ConversationTurn, TranscriptToken } from "@/lib/types";

export function ConversationClient() {
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [slangMode, setSlangMode] = useState(false);
  // Words flagged since session start — fed back to the AI on next turn
  const [forcedWords, setForcedWords] = useState<string[]>([]);

  // ── Transcript handling ────────────────────────────────────────────────────

  const handleTranscriptUpdate = useCallback(
    (tokens: TranscriptToken[], role: "user" | "assistant") => {
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        // Append to current turn if same role, else open a new turn
        if (last && last.role === role) {
          const merged = [...last.tokens, ...tokens];
          return [
            ...prev.slice(0, -1),
            { ...last, tokens: merged, raw_text: last.raw_text + tokens.map((t) => t.hanzi).join("") },
          ];
        }
        return [
          ...prev,
          {
            role,
            tokens,
            raw_text: tokens.map((t) => t.hanzi).join(""),
            timestamp: new Date().toISOString(),
          },
        ];
      });
    },
    []
  );

  // After each AI turn, clear forced words (they've been used)
  const handleAITurnEnd = useCallback(() => {
    setForcedWords([]);
  }, []);

  // ── Gemini Live connection ─────────────────────────────────────────────────

  const { connectionState, isMuted, connect, disconnect, toggleMute } =
    useGeminiLive({
      slangMode,
      forcedWords,
      onTranscriptUpdate: handleTranscriptUpdate,
      onAITurnEnd: handleAITurnEnd,
    });

  // ── Word tap → logMistake ──────────────────────────────────────────────────

  const handleWordTap = useCallback(
    async (token: TranscriptToken, turnIndex: number, tokenIndex: number) => {
      // Optimistically flag the token in UI
      setTurns((prev) =>
        prev.map((turn, ti) =>
          ti !== turnIndex
            ? turn
            : {
                ...turn,
                tokens: turn.tokens.map((t, idx) =>
                  idx === tokenIndex ? { ...t, flagged: true } : t
                ),
              }
        )
      );

      // Queue for re-injection into next AI prompt
      setForcedWords((prev) =>
        prev.includes(token.hanzi) ? prev : [...prev, token.hanzi]
      );

      // Persist to Supabase
      await logMistake(token.mastery_id ?? token.hanzi, {
        pinyin: token.pinyin,
        meaning: token.meaning,
      });
    },
    []
  );

  // ── UI ─────────────────────────────────────────────────────────────────────

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto w-full px-4">
      {/* Header */}
      <div className="flex items-center justify-between py-4 border-b border-[var(--color-border)]">
        <div>
          <h1 className="font-medium">Conversation</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Tap any word you didn't understand to flag it
          </p>
        </div>

        {/* Slang mode toggle */}
        <button
          onClick={() => setSlangMode((s) => !s)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            slangMode
              ? "bg-violet-900/40 border-violet-700 text-violet-300"
              : "bg-transparent border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? "🔥 Slang ON" : "Slang"}
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto py-4">
        <TranscriptView turns={turns} onWordTap={handleWordTap} />
      </div>

      {/* Forced words chip row */}
      {forcedWords.length > 0 && (
        <div className="flex gap-2 py-2 flex-wrap">
          <span className="text-xs text-[var(--color-text-muted)]">queued:</span>
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

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 py-6 border-t border-[var(--color-border)]">
        {isConnected && (
          <button
            onClick={toggleMute}
            className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${
              isMuted
                ? "bg-red-900/40 border-red-800 text-red-300"
                : "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}

        <button
          onClick={isConnected ? disconnect : connect}
          disabled={isConnecting}
          className={`w-16 h-16 rounded-full flex items-center justify-center font-medium text-sm transition-all disabled:opacity-50 ${
            isConnected
              ? "bg-red-900/60 border border-red-700 text-red-200 hover:bg-red-800/60"
              : "bg-violet-700 hover:bg-violet-600 text-white border border-violet-600"
          }`}
        >
          {isConnecting ? (
            <span className="animate-pulse text-xs">...</span>
          ) : isConnected ? (
            <PhoneOff size={22} />
          ) : (
            <Phone size={22} />
          )}
        </button>
      </div>
    </div>
  );
}
