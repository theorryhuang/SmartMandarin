"use client";

import { Play, Pause } from "lucide-react";
import type { ConversationTurn, MasteryMap } from "@/lib/types";
import { TappableText } from "@/components/TappableText";

interface Props {
  turns: ConversationTurn[];
  revealedTurns: Set<number>;
  masteryMap: MasteryMap;
  savedWords: Set<string>;
  // Same word-popup wiring ConversationClient's chat bubbles use (see
  // useWordPopup) — `word` here is the raw Intl.Segmenter span, resolved
  // against CEDICT (and the browser extension, when present) by the hook.
  onWordClick: (word: string, offset: number, x: number, y: number, exact?: boolean) => void;
  onWordHover: (word: string, offset: number, rect: DOMRect) => void;
  onHoverLeave: () => void;
  resolveRange: (segWord: string, offset: number) => { start: number; end: number };
  activeWord: string | null;
  onRevealTurn: (turnIndex: number) => void;
  onHideTurn: (turnIndex: number) => void;
  onReplayTurn: (turnIndex: number) => void;
  playingTurnIndex: number | null;
  isSpeechPaused: boolean;
}

export function TranscriptView({
  turns,
  revealedTurns,
  masteryMap,
  savedWords,
  onWordClick,
  onWordHover,
  onHoverLeave,
  resolveRange,
  activeWord,
  onRevealTurn,
  onHideTurn,
  onReplayTurn,
  playingTurnIndex,
  isSpeechPaused,
}: Props) {
  if (turns.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--color-text-muted)]">
        Hold the button to start speaking
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full overflow-y-auto max-h-[60vh] pb-4">
      {turns.map((turn, ti) => (
        <TurnRow
          key={ti}
          turn={turn}
          revealed={revealedTurns.has(ti)}
          masteryMap={masteryMap}
          savedWords={savedWords}
          onWordClick={onWordClick}
          onWordHover={onWordHover}
          onHoverLeave={onHoverLeave}
          resolveRange={resolveRange}
          activeWord={activeWord}
          onReveal={() => onRevealTurn(ti)}
          onHide={() => onHideTurn(ti)}
          onReplay={() => onReplayTurn(ti)}
          isPlaying={playingTurnIndex === ti && !isSpeechPaused}
        />
      ))}
    </div>
  );
}

function TurnRow({
  turn,
  revealed,
  masteryMap,
  savedWords,
  onWordClick,
  onWordHover,
  onHoverLeave,
  resolveRange,
  activeWord,
  onReveal,
  onHide,
  onReplay,
  isPlaying,
}: {
  turn: ConversationTurn;
  revealed: boolean;
  masteryMap: MasteryMap;
  savedWords: Set<string>;
  onWordClick: (word: string, offset: number, x: number, y: number, exact?: boolean) => void;
  onWordHover: (word: string, offset: number, rect: DOMRect) => void;
  onHoverLeave: () => void;
  resolveRange: (segWord: string, offset: number) => { start: number; end: number };
  activeWord: string | null;
  onReveal: () => void;
  onHide: () => void;
  onReplay: () => void;
  isPlaying: boolean;
}) {
  const isAI = turn.role === "assistant";

  return (
    <div className={`flex gap-3 ${isAI ? "flex-row" : "flex-row-reverse"}`}>
      <div
        className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs mt-1 ${
          isAI ? "bg-violet-100 text-violet-700" : "bg-violet-600 text-white"
        }`}
      >
        {isAI ? "AI" : "你"}
      </div>

      <div
        className={`flex flex-col gap-2 max-w-[85%] rounded-2xl px-4 py-3 text-base leading-loose ${
          isAI
            ? "bg-[var(--color-surface)] border border-[var(--color-border)] shadow-sm"
            : "bg-violet-600 text-white"
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onReplay}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              isAI
                ? "text-violet-600 hover:text-violet-800"
                : "text-violet-200 hover:text-white"
            }`}
          >
            {isPlaying ? (
              <Pause size={13} className={isAI ? "fill-violet-600" : "fill-violet-200"} />
            ) : (
              <Play size={13} className={isAI ? "fill-violet-600" : "fill-violet-200"} />
            )}
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </button>
          <button
            onClick={revealed ? onHide : onReveal}
            className={`text-xs transition-colors underline underline-offset-2 ${
              isAI
                ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                : "text-violet-200 hover:text-white"
            }`}
          >
            {revealed ? "Hide transcript" : "Show transcript"}
          </button>
        </div>

        {revealed && (
          <TappableText
            text={turn.raw_text}
            masteryMap={masteryMap}
            savedWords={savedWords}
            onWordClick={onWordClick}
            onWordHover={onWordHover}
            onHoverLeave={onHoverLeave}
            resolveRange={resolveRange}
            activeWord={activeWord}
            variant={isAI ? "light" : "dark"}
          />
        )}
      </div>
    </div>
  );
}
