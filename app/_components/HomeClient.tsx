"use client";

import Link from "next/link";
import { Brain, MessageCircle, BookOpen, TrendingUp, ChevronRight, User, Mic, List, Flame, GripVertical } from "lucide-react";
import { useLanguage } from "./LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
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

interface Props {
  dueCount: number;
  slangDueCount: number;
  totalWords: number;
  masteredCount: number;
  masteryPct: number;
  devMode: boolean;
  DevResetButton?: React.ReactNode;
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
  { id: "slang",        href: "/review/slang", labelKey: "slangReview",    descKey: "slang",        icon: Flame,         iconBg: "bg-orange-100", iconColor: "text-orange-500" },
  { id: "speaking",     href: "/speaking",     labelKey: "speakingPractice",descKey: "speaking",    icon: Mic,           iconBg: "bg-rose-100",   iconColor: "text-rose-600"   },
  { id: "conversation", href: "/conversation", labelKey: "chatPractice",   descKey: "chat",         icon: MessageCircle, iconBg: "bg-sky-100",    iconColor: "text-sky-600"    },
  { id: "reader",       href: "/reader",       labelKey: "reader",         descKey: "reader",       icon: BookOpen,      iconBg: "bg-emerald-100",iconColor: "text-emerald-600"},
  { id: "vocab",        href: "/vocab",        labelKey: "myVocabulary",   descKey: "vocab",        icon: List,          iconBg: "bg-teal-100",   iconColor: "text-teal-600"   },
];

const ORDER_KEY = "sm_mode_order";

function loadOrder(): string[] {
  if (typeof window === "undefined") return MODE_DEFAULTS.map((m) => m.id);
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return MODE_DEFAULTS.map((m) => m.id);
    const parsed: string[] = JSON.parse(raw);
    // Validate: must contain all known IDs
    const known = new Set(MODE_DEFAULTS.map((m) => m.id));
    if (parsed.length === known.size && parsed.every((id) => known.has(id))) return parsed;
  } catch { /* ignore */ }
  return MODE_DEFAULTS.map((m) => m.id);
}

function SortableMode({
  mode,
  label,
  description,
  badge,
}: {
  mode: ModeItem;
  label: string;
  description: string;
  badge: number | null;
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
          <div className="font-medium text-sm text-[var(--color-text-primary)]">{label}</div>
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

export function HomeClient({ dueCount, slangDueCount, totalWords, masteredCount, masteryPct, devMode, DevResetButton }: Props) {
  const { t } = useLanguage();
  const [order, setOrder] = useState<string[]>(() => MODE_DEFAULTS.map((m) => m.id));

  useEffect(() => {
    setOrder(loadOrder());
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
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
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
    if (mode.id === "slang")    return slangDueCount > 0 ? t.cardsDue(slangDueCount) : t.allCaughtUp;
    if (mode.id === "speaking") return t.speakingDesc;
    if (mode.id === "conversation") return t.chatDesc;
    if (mode.id === "reader")   return t.readerDesc;
    if (mode.id === "vocab")    return t.vocabDesc;
    return "";
  }

  function getBadge(mode: ModeItem): number | null {
    if (mode.id === "review")  return dueCount > 0 ? dueCount : null;
    if (mode.id === "slang")   return slangDueCount > 0 ? slangDueCount : null;
    return null;
  }

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
              <div key={stat.label} className="bg-[var(--color-background)] rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-[var(--color-text-primary)]">{stat.value}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 leading-tight">{stat.label}</div>
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
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {devMode && DevResetButton && (
          <div className="mt-6">{DevResetButton}</div>
        )}
      </div>
    </main>
  );
}
