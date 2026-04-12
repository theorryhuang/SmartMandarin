"use client";

import { useState } from "react";
import { StoryReader } from "@/components/StoryReader";
import type { VocabularyMastery } from "@/lib/types";

interface Props {
  masteryMap: Record<string, VocabularyMastery>;
  hskLevel: number;
}

export function ReaderClient({ masteryMap, hskLevel }: Props) {
  const [slangMode, setSlangMode] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-[var(--color-highlight-new)] border border-blue-500/40" />
            learning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-[var(--color-highlight-mistake)] border border-red-500/40" />
            queued
          </span>
        </div>

        <button
          onClick={() => setSlangMode((s) => !s)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            slangMode
              ? "bg-violet-900/40 border-violet-700 text-violet-300"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? "🔥 Slang ON" : "Slang"}
        </button>
      </div>

      <StoryReader
        masteryMap={masteryMap}
        hskLevel={hskLevel}
        slangMode={slangMode}
      />
    </div>
  );
}
