"use client";

import { useState } from "react";
import { StoryReader } from "@/components/StoryReader";
import type { MasteryMap } from "@/lib/types";
import { useLanguage } from "@/app/_components/LanguageContext";

interface Props {
  masteryMap: MasteryMap;
  hskLevel: number;
}

export function ReaderClient({ masteryMap, hskLevel }: Props) {
  const { t } = useLanguage();
  // Slang mode disabled for now (feature parked, not deleted — see slang.json etc.)
  const [slangMode] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2">
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t.interactiveReader}</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{t.tapWordToSee}</p>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-[var(--color-highlight-new)] border border-blue-500/40" />
            {t.learning}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-[var(--color-highlight-mistake)] border border-red-500/40" />
            {t.queued}
          </span>
        </div>

        {/* Slang mode toggle disabled for now — parked for a later version.
        <button
          onClick={() => setSlangMode((s) => !s)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            slangMode
              ? "bg-violet-900/40 border-violet-700 text-violet-300"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {slangMode ? t.slangActiveReader : t.slang}
        </button>
        */}
      </div>

      <StoryReader
        masteryMap={masteryMap}
        hskLevel={hskLevel}
        slangMode={slangMode}
      />
    </div>
  );
}
