"use client";

import Link from "next/link";
import { Brain, MessageCircle, BookOpen, TrendingUp, ChevronRight, Mic, List, GripVertical, Sparkles } from "lucide-react";
import { useLanguage } from "./LanguageContext";
import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StreakCalendar } from "@/components/StreakCalendar";
import type { DailyStreak } from "@/lib/types";

interface Props {
  /** Combined due count across regular + slang words — review is one merged
   *  session picker now (Slang is just another tile in it), not a separate mode. */
  dueCount: number;
  dailyQuizDueCount: number;
  streak: DailyStreak;
  /** Whether the account has any tracked words at all — just gates the welcome copy */
  hasAnyWords: boolean;
  /** Lowest HSK level not yet promoted past (≥90% high-stability), floored by
   *  the placement assessment — null with no tracked words and no assessment. */
  currentHSK: number | null;
  /** Mastery ratio (0-100) within currentHSK specifically, not diluted by the full backlog */
  currentLevelMasteryPct: number;
  devMode: boolean;
  DevResetButton?: React.ReactNode;
  /** Read server-side from the sm_mode_order cookie — already the real,
   *  reordered layout on first paint, no flash-then-correct needed. Null
   *  when there's no (valid) cookie yet, i.e. never reordered before. */
  initialOrder: string[] | null;
}

interface ModeItem {
  id: string;
  href: string;
  labelKey: keyof ReturnType<typeof useLanguage>["t"];
  descKey: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

const MODE_DEFAULTS: ModeItem[] = [
  { id: "review",       href: "/review",       labelKey: "review",         descKey: "review",       icon: Brain,         iconBg: "bg-violet-100", iconColor: "text-violet-600" },
  { id: "daily",        href: "/daily",        labelKey: "dailyLearning",  descKey: "daily",        icon: Sparkles,      iconBg: "bg-amber-100",  iconColor: "text-amber-600"  },
  { id: "speaking",     href: "/speaking",     labelKey: "speakingPractice",descKey: "speaking",    icon: Mic,           iconBg: "bg-rose-100",   iconColor: "text-rose-600"   },
  { id: "conversation", href: "/conversation", labelKey: "chatPractice",   descKey: "chat",         icon: MessageCircle, iconBg: "bg-sky-100",    iconColor: "text-sky-600"    },
  { id: "reader",       href: "/reader",       labelKey: "reader",         descKey: "reader",       icon: BookOpen,      iconBg: "bg-emerald-100",iconColor: "text-emerald-600"},
  { id: "vocab",        href: "/vocab",        labelKey: "myVocabulary",   descKey: "vocab",        icon: List,          iconBg: "bg-teal-100",   iconColor: "text-teal-600"   },
];

const ORDER_KEY = "sm_mode_order";
export const MODE_IDS = MODE_DEFAULTS.map((m) => m.id);

function isValidOrder(parsed: unknown): parsed is string[] {
  if (!Array.isArray(parsed)) return false;
  const known = new Set(MODE_IDS);
  return parsed.length === known.size && parsed.every((id) => known.has(id));
}

function loadOrderFromLocalStorage(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isValidOrder(parsed)) return parsed;
  } catch { /* ignore */ }
  return null;
}

function saveOrder(order: string[]) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  // Cookie too, not just localStorage — this is what lets the server render
  // the *already-reordered* layout on the next load instead of always
  // starting at the default order and snapping to the real one a beat later
  // once an effect fires (the "goes back to the order I set" flash).
  document.cookie = `${ORDER_KEY}=${encodeURIComponent(JSON.stringify(order))}; path=/; max-age=31536000; SameSite=Lax`;
}

function SortableMode({
  mode,
  label,
  description,
  badge,
  streakChip,
}: {
  mode: ModeItem;
  label: string;
  description: string;
  badge: number | null;
  streakChip?: number | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: mode.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const Icon = mode.icon;

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <Link
        href={mode.href}
        className="flex-1 flex items-center gap-3 bg-[var(--color-surface)] rounded-2xl px-4 py-3.5 border border-[var(--color-border)] hover:border-violet-200 hover:shadow-sm transition-all"
      >
        <div className={`relative w-11 h-11 rounded-xl ${mode.iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon size={22} className={mode.iconColor} />
          {badge !== null && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {badge}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm text-[var(--color-text-primary)]">{label}</span>
            {!!streakChip && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-600">
                🔥{streakChip}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</div>
        </div>
        <ChevronRight size={16} className="text-[var(--color-text-muted)] flex-shrink-0" />
      </Link>
      {/* Drag handle — separate from the link so tapping the card still navigates */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 p-2 touch-none text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-grab active:cursor-grabbing"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical size={18} />
      </button>
    </div>
  );
}

export function HomeClient({ dueCount, dailyQuizDueCount, streak, hasAnyWords, currentHSK, currentLevelMasteryPct, devMode, DevResetButton, initialOrder }: Props) {
  const { t } = useLanguage();
  const [order, setOrder] = useState<string[]>(() => initialOrder ?? MODE_IDS);

  // One-time migration for anyone who reordered before this moved from
  // localStorage-only to a cookie the server can read — without this,
  // everyone's custom order would silently reset to default the first time
  // they load post-upgrade, since the server has never heard of their
  // localStorage value. No-ops on every load after the first, once the
  // cookie exists and matches.
  useEffect(() => {
    if (initialOrder) return;
    const local = loadOrderFromLocalStorage();
    if (local) {
      setOrder(local);
      saveOrder(local);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id)));
      saveOrder(next);
      return next;
    });
  }

  const orderedModes = order
    .map((id) => MODE_DEFAULTS.find((m) => m.id === id)!)
    .filter(Boolean);

  function getLabel(mode: ModeItem) {
    return t[mode.labelKey] as string;
  }

  function getDesc(mode: ModeItem) {
    if (mode.id === "review")   return dueCount > 0 ? t.cardsDue(dueCount) : t.allCaughtUp;
    if (mode.id === "daily")    return dailyQuizDueCount > 0 ? t.dailyQuizDue(dailyQuizDueCount) : t.dailyDesc;
    if (mode.id === "speaking") return t.speakingDesc;
    if (mode.id === "conversation") return t.chatDesc;
    if (mode.id === "reader")   return t.readerDesc;
    if (mode.id === "vocab")    return t.vocabDesc;
    return "";
  }

  function getBadge(mode: ModeItem): number | null {
    if (mode.id === "review")  return dueCount > 0 ? dueCount : null;
    if (mode.id === "daily")   return dailyQuizDueCount > 0 ? dailyQuizDueCount : null;
    return null;
  }

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-lg lg:max-w-3xl mx-auto px-4 pt-6 pb-10">

        {/* ── Top bar — the global AppHeader covers streak/language/profile now ── */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-sky-500 bg-clip-text text-transparent">
            {t.appName}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
            {hasAnyWords ? t.keepItUp : t.startJourney}
          </p>
        </div>

        {/* Below lg this is just stacked block flow (grid/sticky utilities
            are lg:-prefixed, no-ops on mobile) — the narrow phone layout is
            unchanged. At lg+, progress+calendar become a sticky left rail
            instead of a full-width column stacked above the mode list,
            which is what was leaving so much unused width on desktop. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
          <div className="lg:sticky lg:top-8">
            {/* Same header treatment as "✨ Learning Modes" on the right —
                real content, not a spacer, so both columns' first cards
                line up because they're structurally the same shape, not
                because of a hidden filler element. */}
            <div className="flex items-center gap-1.5 mb-3 px-1">
              <span className="text-base">📈</span>
              <h2 className="font-semibold text-sm text-[var(--color-text-primary)]">{t.yourProgress}</h2>
            </div>

            {/* ── Progress: current level, nothing else — the section title
                above already says "Your Progress", so the card itself
                doesn't restate it. ── */}
            <div className="bg-[var(--color-surface)] rounded-2xl p-3 shadow-sm border border-[var(--color-border)] mb-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <TrendingUp size={16} className="text-blue-500" />
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold text-[var(--color-text-primary)]">
                  {currentHSK != null ? `HSK ${(currentHSK + currentLevelMasteryPct / 100).toFixed(1)}` : "–"}
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)]">{t.currentHSK}</div>
              </div>
            </div>

            <div className="mb-4 lg:mb-0">
              <StreakCalendar streak={streak} />
            </div>
          </div>

          {/* ── Learning modes ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-3 px-1">
              <span className="text-base">✨</span>
              <h2 className="font-semibold text-sm text-[var(--color-text-primary)]">{t.learningModes}</h2>
            </div>

            {/* Explicit id: DndContext otherwise derives its aria-describedby
                id from a module-level counter, which can land on a different
                number during SSR vs. the client's first hydration pass and
                throw a hydration-mismatch warning. */}
            <DndContext id="home-learning-modes" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {orderedModes.map((mode) => (
                    <SortableMode
                      key={mode.id}
                      mode={mode}
                      label={getLabel(mode)}
                      description={getDesc(mode)}
                      badge={getBadge(mode)}
                      streakChip={mode.id === "daily" ? streak.current : null}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {devMode && DevResetButton && (
              <div className="mt-6">{DevResetButton}</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
