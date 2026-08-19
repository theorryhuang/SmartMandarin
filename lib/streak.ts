import type { DailyStreak } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Gaps-and-islands streak derivation, shared between "my" streak
 * (app/actions/dailyLearning.ts's getDailyStreak) and a friend's streak
 * (app/actions/friends.ts) — same math, just fed a different set of active
 * dates. See getDailyStreak's doc comment for what counts as a "streak day".
 */
export function computeStreak(activeDatesInput: string[], clientDate?: string): DailyStreak {
  const activeDates = [...new Set(activeDatesInput)].sort();
  if (activeDates.length === 0) return { current: 0, longest: 0, activeDates: [] };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < activeDates.length; i++) {
    run = addDays(activeDates[i - 1], 1) === activeDates[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const dateSet = new Set(activeDates);
  const today = clientDate && DATE_RE.test(clientDate) ? clientDate : new Date().toISOString().slice(0, 10);
  let cursor = dateSet.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (dateSet.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest, activeDates };
}
