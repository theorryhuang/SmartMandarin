"use client";

import { useCallback } from "react";
import type { ConversationTurn, TranscriptToken } from "@/lib/types";

interface Props {
  turns: ConversationTurn[];
  /** Called when user taps a word they didn't understand */
  onWordTap: (token: TranscriptToken, turnIndex: number, tokenIndex: number) => void;
}

export function TranscriptView({ turns, onWordTap }: Props) {
  if (turns.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-[var(--color-text-muted)]">
        Start speaking to see the transcript
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full overflow-y-auto max-h-[60vh] pb-4">
      {turns.map((turn, ti) => (
        <TurnRow key={ti} turn={turn} turnIndex={ti} onWordTap={onWordTap} />
      ))}
    </div>
  );
}

function TurnRow({
  turn,
  turnIndex,
  onWordTap,
}: {
  turn: ConversationTurn;
  turnIndex: number;
  onWordTap: Props["onWordTap"];
}) {
  const isAI = turn.role === "assistant";

  return (
    <div className={`flex gap-3 ${isAI ? "flex-row" : "flex-row-reverse"}`}>
      <div
        className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs mt-1 ${
          isAI
            ? "bg-violet-900/60 text-violet-300"
            : "bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]"
        }`}
      >
        {isAI ? "AI" : "你"}
      </div>

      <div
        className={`flex flex-wrap gap-x-1 gap-y-2 max-w-[85%] rounded-2xl px-4 py-3 text-base leading-loose ${
          isAI
            ? "bg-[var(--color-surface)] border border-[var(--color-border)]"
            : "bg-[var(--color-surface-raised)]"
        }`}
      >
        {turn.tokens.map((token, idx) => (
          <WordToken
            key={idx}
            token={token}
            onTap={() => onWordTap(token, turnIndex, idx)}
          />
        ))}
      </div>
    </div>
  );
}

function WordToken({ token, onTap }: { token: TranscriptToken; onTap: () => void }) {
  const cls = token.flagged
    ? "word-token word-token--mistake"
    : "word-token";

  return (
    <span
      className={`${cls} px-0.5 inline-flex flex-col items-center gap-0.5`}
      onClick={onTap}
      title={token.pinyin ? `${token.pinyin}${token.meaning ? " — " + token.meaning : ""}` : undefined}
    >
      <span className="text-base">{token.hanzi}</span>
      {token.pinyin && (
        <span className="text-[10px] text-[var(--color-text-muted)] leading-none">
          {token.pinyin}
        </span>
      )}
    </span>
  );
}
