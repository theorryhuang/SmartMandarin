"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Search, Trash2 } from "lucide-react";
import type { VocabularyMastery } from "@/lib/types";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import { createClient } from "@/lib/supabase/client";
import { deleteWord } from "@/app/actions/vocabulary";

const HSK_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-emerald-100", text: "text-emerald-700" },
  2: { bg: "bg-sky-100",     text: "text-sky-700" },
  3: { bg: "bg-violet-100",  text: "text-violet-700" },
  4: { bg: "bg-amber-100",   text: "text-amber-700" },
  5: { bg: "bg-orange-100",  text: "text-orange-700" },
  6: { bg: "bg-rose-100",    text: "text-rose-700" },
};

function hskColor(level: number | null) {
  if (level === null) return { bg: "bg-slate-100", text: "text-slate-500" };
  return HSK_COLORS[Math.floor(level)] ?? { bg: "bg-slate-100", text: "text-slate-600" };
}

export function VocabClient() {
  const [words, setWords] = useState<VocabularyMastery[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [hskFilter, setHskFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<"hsk" | "alpha" | "mastery">("hsk");
  const backfillQueueRef = useRef<string[]>([]);
  const backfillRunningRef = useRef(false);

  const handleDelete = useCallback(async (wordId: string) => {
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    await deleteWord(wordId).catch(() => {});
  }, []);

  // ── Initial fetch + realtime subscription ──────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    let userId = "";

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      userId = user.id;

      const { data } = await supabase
        .from("vocabulary_mastery")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      setWords((data ?? []) as VocabularyMastery[]);
      setLoading(false);
    }

    load();

    // Realtime: sync INSERT / UPDATE / DELETE instantly
    const channel = supabase
      .channel("vocab-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vocabulary_mastery" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setWords((prev) => prev.filter((w) => w.id !== (payload.old as { id: string }).id));
          } else if (payload.eventType === "INSERT") {
            setWords((prev) => {
              const exists = prev.some((w) => w.id === (payload.new as VocabularyMastery).id);
              return exists ? prev : [payload.new as VocabularyMastery, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setWords((prev) =>
              prev.map((w) => w.id === (payload.new as VocabularyMastery).id ? payload.new as VocabularyMastery : w)
            );
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Backfill missing definitions ───────────────────────────────────────────
  useEffect(() => {
    const missing = words.filter((w) => !w.pinyin || !w.meaning).map((w) => w.id);
    if (missing.length === 0) return;

    // Add newly discovered missing words to queue (dedupe)
    const queue = backfillQueueRef.current;
    for (const id of missing) {
      if (!queue.includes(id)) queue.push(id);
    }

    if (backfillRunningRef.current) return;

    async function runBackfill() {
      backfillRunningRef.current = true;
      const supabase = createClient();

      while (backfillQueueRef.current.length > 0) {
        const id = backfillQueueRef.current.shift()!;
        const word = words.find((w) => w.id === id);
        if (!word || (word.pinyin && word.meaning)) continue;

        try {
          const res = await fetch("/api/define-word", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hanzi: word.hanzi }),
          });
          const def = await res.json();
          if (!def.pinyin && !def.meaning) continue;

          const patch: { pinyin?: string; meaning?: string; hsk_level?: number | null } = {};
          if (def.pinyin && !word.pinyin) patch.pinyin = def.pinyin;
          if (def.meaning && !word.meaning) patch.meaning = def.meaning;
          if (word.hsk_level === null && def.hsk_level != null) patch.hsk_level = def.hsk_level;

          if (Object.keys(patch).length === 0) continue;

          await supabase.from("vocabulary_mastery").update(patch).eq("id", id);
          // Realtime will push the update back; also update local state immediately
          setWords((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
        } catch {
          // ignore, will retry next page visit
        }

        // Small delay to avoid hammering the API
        await new Promise((r) => setTimeout(r, 300));
      }

      backfillRunningRef.current = false;
    }

    runBackfill();
  }, [words]);

  // ── Filtering + sorting ────────────────────────────────────────────────────
  const levels = useMemo(
    () =>
      [...new Set(words.map((w) => (w.hsk_level !== null ? Math.floor(w.hsk_level) : null)))]
        .sort((a, b) => (a ?? -1) - (b ?? -1)),
    [words]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return words
      .filter((w) => {
        if (hskFilter !== null) {
          const wLevel = w.hsk_level !== null ? Math.floor(w.hsk_level) : null;
          if (wLevel !== hskFilter) return false;
        }
        if (!q) return true;
        return (
          w.hanzi.includes(q) ||
          (w.pinyin ?? "").toLowerCase().includes(q) ||
          (w.meaning ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sort === "hsk") {
          const aL = a.hsk_level ?? 999;
          const bL = b.hsk_level ?? 999;
          return aL - bL;
        }
        if (sort === "alpha") return a.hanzi.localeCompare(b.hanzi);
        return b.stability - a.stability;
      });
  }, [words, query, hskFilter, sort]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[var(--color-text-muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="px-4 pb-10">
      {/* Word count */}
      <div className="mt-2 mb-1 text-xs text-[var(--color-text-muted)]">{words.length} words saved</div>

      {/* Search */}
      <div className="mt-2 relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search hanzi, pinyin, meaning…"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-400 transition-colors"
        />
      </div>

      {/* HSK filter tabs */}
      <div className="flex gap-2 mt-3 overflow-x-auto pb-1 no-scrollbar">
        <FilterTab active={hskFilter === null} onClick={() => setHskFilter(null)}>All</FilterTab>
        {levels.map((lvl) => {
          const c = hskColor(lvl);
          return (
            <FilterTab
              key={lvl ?? "null"}
              active={hskFilter === lvl}
              onClick={() => setHskFilter(hskFilter === lvl ? null : lvl)}
              activeClass={`${c.bg} ${c.text} border-transparent`}
            >
              {lvl !== null ? `HSK ${lvl}` : "No level"}
            </FilterTab>
          );
        })}
      </div>

      {/* Sort + count row */}
      <div className="flex items-center justify-between mt-3 mb-2">
        <span className="text-xs text-[var(--color-text-muted)]">
          {filtered.length} word{filtered.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-1">
          {(["hsk", "alpha", "mastery"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                sort === s
                  ? "bg-violet-100 text-violet-700"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              {s === "hsk" ? "Level" : s === "alpha" ? "A–Z" : "Mastery"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
          {words.length === 0
            ? "No words saved yet. Start chatting or reading to build your vocabulary."
            : "No matches."}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--color-border)]">
          {filtered.map((word) => (
            <WordRow key={word.id} word={word} onDelete={() => handleDelete(word.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  children,
  active,
  onClick,
  activeClass = "bg-violet-100 text-violet-700 border-transparent",
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  activeClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? activeClass
          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}

function WordRow({ word, onDelete }: { word: VocabularyMastery; onDelete: () => void }) {
  const level = word.hsk_level !== null ? Math.floor(word.hsk_level) : null;
  const c = hskColor(level);
  const isMastered = word.stability >= HIGH_STABILITY_THRESHOLD;
  const stabilityPct = Math.min(100, (word.stability / HIGH_STABILITY_THRESHOLD) * 100);

  return (
    <div className="flex items-center gap-3 py-3 group">
      {/* HSK badge */}
      <span className={`flex-shrink-0 w-12 text-center text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
        {level !== null ? `HSK ${level}` : "—"}
      </span>

      {/* Hanzi + pinyin */}
      <div className="flex-shrink-0 w-20 text-right">
        <div className="text-lg font-medium text-[var(--color-text-primary)] leading-tight">{word.hanzi}</div>
        {word.pinyin && (
          <div className="text-[11px] text-[var(--color-text-muted)] leading-none mt-0.5">{word.pinyin}</div>
        )}
        {!word.pinyin && (
          <div className="text-[11px] text-[var(--color-text-muted)] leading-none mt-0.5 italic animate-pulse">loading…</div>
        )}
      </div>

      {/* Meaning + mastery bar */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--color-text-secondary)] truncate">
          {word.meaning || <span className="italic text-[var(--color-text-muted)] animate-pulse">loading…</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <div className="flex-1 h-1 rounded-full bg-[var(--color-border)] overflow-hidden">
            <div
              className={`h-1 rounded-full transition-all ${isMastered ? "bg-emerald-400" : "bg-violet-400"}`}
              style={{ width: `${stabilityPct}%` }}
            />
          </div>
          {isMastered && (
            <span className="text-[10px] text-emerald-600 font-medium flex-shrink-0">mastered</span>
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-[var(--color-text-muted)] active:text-red-500 transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
