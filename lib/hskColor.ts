const HSK_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-emerald-100", text: "text-emerald-700" },
  2: { bg: "bg-sky-100",     text: "text-sky-700" },
  3: { bg: "bg-violet-100",  text: "text-violet-700" },
  4: { bg: "bg-amber-100",   text: "text-amber-700" },
  5: { bg: "bg-orange-100",  text: "text-orange-700" },
  6: { bg: "bg-rose-100",    text: "text-rose-700" },
};

export function hskColor(level: number | null) {
  if (level === null) return { bg: "bg-slate-100", text: "text-slate-500" };
  return HSK_COLORS[Math.floor(level)] ?? { bg: "bg-slate-100", text: "text-slate-600" };
}
