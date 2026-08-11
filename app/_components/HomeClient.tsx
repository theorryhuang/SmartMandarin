"use client";

import Link from "next/link";
import { Brain, MessageCircle, BookOpen, TrendingUp, ChevronRight, User, Mic, List, Flame, Plus, X, Search, Check } from "lucide-react";
import { useLanguage } from "./LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useState, useRef } from "react";
import { logMistake } from "@/app/actions/vocabulary";

interface Props {
  dueCount: number;
  slangDueCount: number;
  totalWords: number;
  masteredCount: number;
  masteryPct: number;
  devMode: boolean;
  DevResetButton?: React.ReactNode;
}

type LookupState = "idle" | "loading" | "found" | "not_found" | "added";
interface LookupResult { pinyin: string; meaning: string; hsk_level: number | null; source?: string; alreadySaved?: boolean }

export function HomeClient({ dueCount, slangDueCount, totalWords, masteredCount, masteryPct, devMode, DevResetButton }: Props) {
  const { t } = useLanguage();
  const [showAddWord, setShowAddWord] = useState(false);
  const [hanziInput, setHanziInput] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleLookup() {
    const hanzi = hanziInput.trim();
    if (!hanzi) return;
    setLookupState("loading");
    setLookupResult(null);
    try {
      const res = await fetch("/api/define-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanzi }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.pinyin && data.meaning) {
        setLookupResult({ pinyin: data.pinyin, meaning: data.meaning, hsk_level: data.hsk_level ?? null, source: data.source, alreadySaved: data.already_saved ?? false });
        setLookupState("found");
      } else {
        setLookupState("not_found");
      }
    } catch {
      setLookupState("not_found");
    }
  }

  async function handleAdd() {
    if (!lookupResult) return;
    await logMistake(hanziInput.trim(), {
      pinyin: lookupResult.pinyin,
      meaning: lookupResult.meaning,
      hsk_level: lookupResult.hsk_level ?? undefined,
    });
    setLookupResult((prev) => prev ? { ...prev, alreadySaved: true } : prev);
  }

  function handleOpen() {
    setShowAddWord(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleClose() {
    setShowAddWord(false);
    setHanziInput("");
    setLookupState("idle");
    setLookupResult(null);
  }

  const modes = [
    {
      href: "/review",
      label: t.review,
      description: dueCount > 0 ? t.cardsDue(dueCount) : t.allCaughtUp,
      icon: Brain,
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
      badge: dueCount > 0 ? dueCount : null,
    },
    {
      href: "/review/slang",
      label: t.slangReview,
      description: slangDueCount > 0 ? t.cardsDue(slangDueCount) : t.allCaughtUp,
      icon: Flame,
      iconBg: "bg-orange-100",
      iconColor: "text-orange-500",
      badge: slangDueCount > 0 ? slangDueCount : null,
    },
    {
      href: "/speaking",
      label: t.speakingPractice,
      description: t.speakingDesc,
      icon: Mic,
      iconBg: "bg-rose-100",
      iconColor: "text-rose-600",
      badge: null,
    },
    {
      href: "/conversation",
      label: t.chatPractice,
      description: t.chatDesc,
      icon: MessageCircle,
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      badge: null,
    },
    {
      href: "/reader",
      label: t.reader,
      description: t.readerDesc,
      icon: BookOpen,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      badge: null,
    },
    {
      href: "/vocab",
      label: t.myVocabulary,
      description: t.vocabDesc,
      icon: List,
      iconBg: "bg-teal-100",
      iconColor: "text-teal-600",
      badge: null,
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-10">

        {/* ── Top bar ── */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-sky-500 bg-clip-text text-transparent">
              {t.appName}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              {totalWords > 0 ? t.keepItUp : t.startJourney}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              href="/profile"
              className="relative w-10 h-10 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center hover:border-violet-300 transition-colors shadow-sm"
            >
              <User size={18} className="text-[var(--color-text-secondary)]" />
              {(dueCount + slangDueCount) > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {dueCount + slangDueCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* ── Progress card ── */}
        <div className="bg-[var(--color-surface)] rounded-2xl p-5 shadow-sm border border-[var(--color-border)] mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <TrendingUp size={20} className="text-blue-500" />
            </div>
            <div>
              <h2 className="font-semibold text-[var(--color-text-primary)]">{t.yourProgress}</h2>
              <p className="text-xs text-[var(--color-text-muted)]">{t.trackJourney}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { value: totalWords, label: t.wordsTracked },
              { value: masteredCount, label: t.mastered },
              { value: `${masteryPct}%`, label: t.mastery },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-[var(--color-background)] rounded-xl p-3 text-center"
              >
                <div className="text-xl font-bold text-[var(--color-text-primary)]">
                  {stat.value}
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-tight">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)] mb-1.5">
            <span>{t.overallProgress}</span>
            <span className="text-violet-600 font-medium">{masteryPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-background)] overflow-hidden">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-violet-500 to-sky-400 transition-all duration-500"
              style={{ width: `${masteryPct}%` }}
            />
          </div>
        </div>

        {/* ── Add Word ── */}
        <div className="mb-6">
          {!showAddWord ? (
            <button
              onClick={handleOpen}
              className="w-full flex items-center gap-3 bg-[var(--color-surface)] rounded-2xl px-4 py-3.5 border border-dashed border-[var(--color-border)] hover:border-violet-300 hover:shadow-sm transition-all text-left"
            >
              <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                <Plus size={22} className="text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-[var(--color-text-primary)]">{t.addWord}</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{t.addWordDesc}</div>
              </div>
            </button>
          ) : (
            <div className="bg-[var(--color-surface)] rounded-2xl p-4 border border-violet-200 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-sm text-[var(--color-text-primary)]">{t.addWord}</span>
                <button onClick={handleClose} className="p-1 rounded-lg hover:bg-[var(--color-background)] transition-colors">
                  <X size={16} className="text-[var(--color-text-muted)]" />
                </button>
              </div>

              <div className="flex gap-2 mb-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={hanziInput}
                  onChange={(e) => { setHanziInput(e.target.value); setLookupState("idle"); setLookupResult(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                  placeholder={t.addWordPlaceholder}
                  className="flex-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-violet-400 transition-colors"
                />
                <button
                  onClick={handleLookup}
                  disabled={!hanziInput.trim() || lookupState === "loading"}
                  className="px-3 py-2.5 bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white rounded-xl transition-colors flex items-center gap-1.5 text-sm font-medium"
                >
                  {lookupState === "loading" ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Search size={15} />
                  )}
                  {lookupState === "loading" ? t.lookingUpWord : t.lookupWord}
                </button>
              </div>

              {lookupState === "found" && lookupResult && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 bg-[var(--color-background)] rounded-xl px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-semibold text-[var(--color-text-primary)]">{hanziInput.trim()}</div>
                      <div className="text-xs text-violet-600 font-medium">{lookupResult.pinyin}</div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-snug">{lookupResult.meaning}</div>
                    </div>
                    {lookupResult.alreadySaved ? (
                      <div className="flex items-center gap-1 px-3 py-2 bg-violet-100 text-violet-700 rounded-xl text-xs font-medium flex-shrink-0">
                        <Check size={13} />
                        {t.wordAlreadySaved}
                      </div>
                    ) : (
                      <button
                        onClick={handleAdd}
                        className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-medium transition-colors flex-shrink-0"
                      >
                        {t.addToReview}
                      </button>
                    )}
                  </div>
                  {lookupResult.source === "ai" && !lookupResult.alreadySaved && (
                    <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-snug">
                      {t.aiDefinitionWarning}
                    </div>
                  )}
                </div>
              )}

              {lookupState === "added" && (
                <div className="flex items-center gap-2 bg-emerald-50 rounded-xl px-3 py-2.5 text-emerald-700 text-sm">
                  <Check size={16} />
                  {t.wordAdded}
                </div>
              )}

              {lookupState === "not_found" && (
                <div className="text-xs text-[var(--color-text-muted)] px-1">{t.wordNotFound}</div>
              )}
            </div>
          )}
        </div>

        {/* ── Learning modes ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-3 px-1">
            <span className="text-base">✨</span>
            <h2 className="font-semibold text-sm text-[var(--color-text-primary)]">{t.learningModes}</h2>
          </div>

          <div className="flex flex-col gap-2">
            {modes.map((mode) => {
              const Icon = mode.icon;
              return (
                <Link
                  key={mode.href}
                  href={mode.href}
                  className="flex items-center gap-3 bg-[var(--color-surface)] rounded-2xl px-4 py-3.5 border border-[var(--color-border)] hover:border-violet-200 hover:shadow-sm transition-all"
                >
                  <div className={`relative w-11 h-11 rounded-xl ${mode.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <Icon size={22} className={mode.iconColor} />
                    {mode.badge !== null && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                        {mode.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-[var(--color-text-primary)]">{mode.label}</div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{mode.description}</div>
                  </div>
                  <ChevronRight size={16} className="text-[var(--color-text-muted)] flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>

        {devMode && DevResetButton && (
          <div className="mt-6">{DevResetButton}</div>
        )}
      </div>
    </main>
  );
}
