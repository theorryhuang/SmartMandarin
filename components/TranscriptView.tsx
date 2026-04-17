"use client";

import { useState } from "react";
import { Play, Pause } from "lucide-react";
import type { ConversationTurn } from "@/lib/types";

interface Props {
  turns: ConversationTurn[];
  revealedTurns: Set<number>;
  savedWords: Set<string>;
  onWordSelect: (word: string, turnIndex: number) => void;
  onRevealTurn: (turnIndex: number) => void;
  onHideTurn: (turnIndex: number) => void;
  onReplayTurn: (turnIndex: number) => void;
  playingTurnIndex: number | null;
  isSpeechPaused: boolean;
}

export function TranscriptView({
  turns,
  revealedTurns,
  savedWords,
  onWordSelect,
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
          turnIndex={ti}
          revealed={revealedTurns.has(ti)}
          savedWords={savedWords}
          onWordSelect={(word) => onWordSelect(word, ti)}
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
  savedWords,
  onWordSelect,
  onReveal,
  onHide,
  onReplay,
  isPlaying,
}: {
  turn: ConversationTurn;
  turnIndex: number;
  revealed: boolean;
  savedWords: Set<string>;
  onWordSelect: (word: string) => void;
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
          <TappableTranscript
            text={turn.raw_text}
            savedWords={savedWords}
            isUser={!isAI}
            onWordSelect={onWordSelect}
          />
        )}
      </div>
    </div>
  );
}

function TappableTranscript({
  text,
  savedWords,
  isUser,
  onWordSelect,
}: {
  text: string;
  savedWords: Set<string>;
  isUser: boolean;
  onWordSelect: (word: string) => void;
}) {
  type Seg = { type: "hanzi" | "other"; content: string; idx: number };
  const segments: Seg[] = [];
  let hanziIdx = 0;

  const cleaned = text.replace(/\s*\([^)]{1,30}\)/g, "");

  for (const char of cleaned) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
      segments.push({ type: "hanzi", content: char, idx: hanziIdx++ });
    } else {
      segments.push({ type: "other", content: char, idx: -1 });
    }
  }

  const hanziSegs = segments.filter((s) => s.type === "hanzi");
  const hanziStr = hanziSegs.map((s) => s.content).join("");

  // Which hanzi indices are covered by a saved multi-char compound
  const savedCoveredIndices = new Set<number>();
  for (const word of savedWords) {
    let pos = 0;
    while ((pos = hanziStr.indexOf(word, pos)) !== -1) {
      for (let j = pos; j < pos + word.length; j++) {
        savedCoveredIndices.add(hanziSegs[j]?.idx ?? -1);
      }
      pos++;
    }
  }

  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const selLo = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const selHi = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  function handlePointerDown(idx: number) {
    setSelStart(idx);
    setSelEnd(idx);
    setIsSelecting(true);
  }

  function handlePointerEnter(idx: number) {
    if (isSelecting) setSelEnd(idx);
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
        if (seg.type === "other") {
          return (
            <span key={i} className={isUser ? "text-violet-200" : "text-[var(--color-text-muted)]"}>
              {seg.content}
            </span>
          );
        }

        const isInSel = selLo !== null && selHi !== null && seg.idx >= selLo && seg.idx <= selHi;
        const isSaved = savedWords.has(seg.content) || savedCoveredIndices.has(seg.idx);

        if (isUser) {
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
                  ? "bg-white/30 text-white"
                  : isSaved
                  ? "bg-white/20 text-white line-through opacity-70"
                  : "hover:bg-white/20"
              }`}
            >
              {seg.content}
            </span>
          );
        }

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
