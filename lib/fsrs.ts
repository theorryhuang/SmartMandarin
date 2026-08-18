/**
 * FSRS-4.5  —  Free Spaced Repetition Scheduler
 *
 * Paper: "A Stochastic Shortest Path Algorithm for Optimizing Spaced
 *         Repetition Scheduling" (Ye, 2022) — updated to v4.5.
 *
 * Key concepts
 * ─────────────
 * Stability (S)   Days until retrievability drops to the target (90%).
 *                 After a "Good" recall with S=7 you get ~18–19 days.
 * Difficulty (D)  [1, 10].  Higher = harder card.  Updated after every review.
 * Retrievability  Probability of recall right now.  Drives the forgetting curve.
 *
 * Ratings
 * ───────
 * 1 = Again  (forgot completely)
 * 2 = Hard   (recalled with significant effort)
 * 3 = Good   (recalled with some effort — the default)
 * 4 = Easy   (recalled instantly)
 */

import type { FSRSRating, FSRSResult } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Power-law forgetting curve exponent */
const DECAY = -0.5;

/**
 * Derived from DECAY so that forgettingCurve(S, S) === TARGET_RETENTION.
 * FACTOR = r^(1/DECAY) - 1  where r = 0.9
 * Numerically: 0.9^(-2) - 1 = 1/0.81 - 1 = 19/81 ≈ 0.2346
 */
const FACTOR = 19 / 81;

/** Target retention probability used for interval scheduling */
const TARGET_RETENTION = 0.9;

/** A card is "high stability" once it can survive this many days at 90% recall */
export const HIGH_STABILITY_THRESHOLD = 21; // days

/**
 * Injected HSK n+1 words begin appearing once HSK n mastery exceeds this ratio.
 * e.g. 0.9 → start seeing HSK 4 words once 90% of HSK 3 is high-stability.
 */
export const HSK_PROMOTION_THRESHOLD = 0.9;

/** Fraction of reviews that are next-level words once promotion starts */
export const HSK_INJECTION_RATE = 0.05;

// ─── Default FSRS-4.5 weights ─────────────────────────────────────────────────

/**
 * w[0..3]   Initial stability for ratings Again / Hard / Good / Easy
 * w[4]      D₀ base
 * w[5]      D₀ rating scaling exponent
 * w[6]      D mean-reversion weight
 * w[7]      D step size per rating unit
 * w[8]      Recall stability — ln-coefficient
 * w[9]      Recall stability — difficulty exponent
 * w[10]     Recall stability — retrievability exponent
 * w[11]     Forget stability — coefficient
 * w[12]     Forget stability — difficulty exponent
 * w[13]     Forget stability — stability exponent
 * w[14]     Forget stability — retrievability exponent
 * w[15]     Hard penalty multiplier (< 1)
 * w[16]     Easy bonus multiplier  (> 1)
 */
const DEFAULT_W: readonly number[] = [
  0.4072, 1.1829, 3.1262, 15.4722, // w[0..3]  S₀
  7.2102, 0.5316,                   // w[4..5]  D₀
  1.0651, 0.0589,                   // w[6..7]  D update
  1.5330, 0.1544, 1.0071,           // w[8..10] recall S'
  1.9326, 0.1081, 0.2330, 2.8797,  // w[11..14] forget S'
  0.2458, 2.9898,                   // w[15..16] hard/easy modifiers
] as const;

// ─── Core maths ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Power-law forgetting curve.
 * Returns the probability of recall after `t` days given stability `s`.
 */
export function forgettingCurve(t: number, s: number): number {
  return (1 + FACTOR * t / s) ** DECAY;
}

/**
 * Optimal interval (days) that keeps retrievability ≥ TARGET_RETENTION.
 * Derived by solving forgettingCurve(t, s) = TARGET_RETENTION for t.
 * At 90% target this always equals ⌈s⌉, which is the elegant FSRS property.
 */
function targetInterval(s: number, maxInterval = 36500): number {
  const raw = (TARGET_RETENTION ** (1 / DECAY) - 1) / FACTOR * s;
  return clamp(Math.round(raw), 1, maxInterval);
}

// ─── Initialisation (first review of a new card) ─────────────────────────────

/**
 * S₀ — initial stability seeded from the first rating.
 * A first "Again" gives ≈ 0.4 days (review again tomorrow),
 * "Easy" gives ≈ 15.5 days.
 */
function initStability(rating: FSRSRating, w: readonly number[]): number {
  return Math.max(w[rating - 1], 0.1);
}

/**
 * D₀ — initial difficulty derived from the first rating.
 * Again → ~8.7  (hard)
 * Easy  → ~3.3  (easy)
 */
function initDifficulty(rating: FSRSRating, w: readonly number[]): number {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10);
}

// ─── Stability after a review ─────────────────────────────────────────────────

/**
 * New stability after a *successful* recall (rating 2–4).
 *
 * Formula:
 *   S'ᵣ = S · (e^{w₈} · (11 - D) · S^{-w₉} · (e^{w₁₀·(1-R)} - 1) + 1)
 *         · hardPenalty · easyBonus
 *
 * - (11 - D)          cards with lower difficulty grow stability faster
 * - S^{-w₉}           diminishing returns: high-S cards improve less per review
 * - (e^{w₁₀·(1-R)}-1) reviewing well before the due date yields smaller gains
 */
function recallStability(
  d: number,
  s: number,
  r: number,
  rating: FSRSRating,
  w: readonly number[]
): number {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus   = rating === 4 ? w[16] : 1;
  return (
    s *
    (Math.exp(w[8]) * (11 - d) * s ** -w[9] * (Math.exp(w[10] * (1 - r)) - 1) + 1) *
    hardPenalty *
    easyBonus
  );
}

/**
 * New stability after *forgetting* (rating 1 — Again).
 *
 * Formula:
 *   S'ᶠ = w₁₁ · D^{-w₁₂} · (S^{w₁₃} + 1) · e^{w₁₄·(1-R)}
 *
 * Much smaller than recallStability — the card resets to a short interval
 * but not all the way to zero (partial credit for prior learning).
 */
function forgetStability(
  d: number,
  s: number,
  r: number,
  w: readonly number[]
): number {
  return w[11] * d ** -w[12] * (s ** w[13] + 1) * Math.exp(w[14] * (1 - r));
}

// ─── Difficulty update ────────────────────────────────────────────────────────

/**
 * Update difficulty after a review.
 *
 * - Again/Hard push D up; Easy pulls D down; Good is neutral.
 * - Mean reversion towards D₀(Good) prevents runaway values.
 */
function nextDifficulty(
  d: number,
  rating: FSRSRating,
  w: readonly number[]
): number {
  const meanReversionTarget = initDifficulty(3, w); // D₀(Good) ≈ 5.0
  const adjusted = d - w[7] * (rating - 3);
  // Linear mean reversion: pull 10% of the way towards the neutral D₀(Good)
  const reverted = adjusted + 0.1 * (meanReversionTarget - adjusted);
  return clamp(reverted, 1, 10);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SchedulerParams {
  w?: readonly number[];
  maxInterval?: number;
}

/**
 * Calculate the next review schedule after the user rates a card.
 *
 * @param stability   Current stability in days (0 for a brand-new card)
 * @param difficulty  Current difficulty [1, 10] (0 for a brand-new card)
 * @param lastReview  Date of last review (null for brand-new card)
 * @param rating      User's self-rating: 1=Again, 2=Hard, 3=Good, 4=Easy
 * @param params      Optional override for FSRS weights / max interval
 * @returns           Updated stability, difficulty, next review date, and R
 *
 * @example
 * // Brand new word, user recalls it as "Good"
 * const result = calculateNextReview(0, 0, null, 3);
 * // result.stability ≈ 3.1  (days)
 * // result.next_review ≈ today + 3 days
 *
 * @example
 * // Known word with S=7, D=6, reviewed on time, rated "Good"
 * const result = calculateNextReview(7, 6, new Date(), 3);
 * // result.stability ≈ 16–19 days
 */
export function calculateNextReview(
  stability: number,
  difficulty: number,
  lastReview: Date | null,
  rating: FSRSRating,
  params: SchedulerParams = {}
): FSRSResult {
  const w = params.w ?? DEFAULT_W;
  const maxInterval = params.maxInterval ?? 36500;

  const now = new Date();
  const isNewCard = stability === 0 || lastReview === null;

  let newStability: number;
  let newDifficulty: number;
  let retrievability: number;

  if (isNewCard) {
    // ── First review ──────────────────────────────────────────────────────────
    newStability  = initStability(rating, w);
    newDifficulty = initDifficulty(rating, w);
    retrievability = 1; // card was just introduced
  } else {
    // ── Subsequent review ─────────────────────────────────────────────────────
    const elapsedDays = Math.max(
      0,
      (now.getTime() - lastReview.getTime()) / 86_400_000
    );
    retrievability = forgettingCurve(elapsedDays, stability);

    if (rating === 1) {
      newStability = forgetStability(difficulty, stability, retrievability, w);
    } else {
      newStability = recallStability(difficulty, stability, retrievability, rating, w);
    }

    // Ensure stability always increases on successful recall
    if (rating > 1) {
      newStability = Math.max(newStability, stability + 0.1);
    }

    newDifficulty = nextDifficulty(difficulty, rating, w);
  }

  newStability = Math.min(newStability, maxInterval);

  const intervalDays = targetInterval(newStability, maxInterval);
  const nextReview = new Date(now.getTime() + intervalDays * 86_400_000);

  return {
    stability:     Math.round(newStability * 100) / 100,
    difficulty:    Math.round(newDifficulty * 100) / 100,
    next_review:   nextReview,
    retrievability: Math.round(retrievability * 10000) / 10000,
  };
}

// ─── HSK Injection Logic ──────────────────────────────────────────────────────

/**
 * Given per-level mastery stats, return whether it's time to start injecting
 * words from the next HSK level and at what rate.
 *
 * @param currentLevel   The level the user is primarily studying (e.g. 3)
 * @param masteryRatio   Fraction of currentLevel words that are high-stability
 * @returns              Injection rate 0–1 (0 = no injection, 0.05 = 5%)
 */
export function hskInjectionRate(
  currentLevel: number,
  masteryRatio: number
): number {
  if (currentLevel >= 6) return 0; // No level 7 to inject from HSK
  if (masteryRatio < HSK_PROMOTION_THRESHOLD) return 0;

  // Scale injection rate linearly from 5% at threshold to 20% at 100% mastery
  const excess = (masteryRatio - HSK_PROMOTION_THRESHOLD) / (1 - HSK_PROMOTION_THRESHOLD);
  return clamp(HSK_INJECTION_RATE + excess * 0.15, HSK_INJECTION_RATE, 0.2);
}

/**
 * Weighted-level model: distribute a word's "effective" HSK level across
 * a Gaussian centred on its nominal level.  Used for the weight-distribution
 * visualisation rather than hard level gating.
 */
export function weightedHSKLevel(nominalLevel: number, stability: number): number {
  // Words with high stability are considered "mastered" at their level.
  // Words with low stability are still learning and sit slightly below.
  const masteryFraction = clamp(stability / HIGH_STABILITY_THRESHOLD, 0, 1);
  return nominalLevel - (1 - masteryFraction) * 0.5;
}

/**
 * A level needs at least this many tracked words before it's allowed to
 * count as "promoted past" in deriveCurrentHSK(). Without this guard, a
 * level with e.g. 2 tracked words that both happen to sit above
 * HIGH_STABILITY_THRESHOLD reads as "100% mastered" and lets the scan
 * leapfrog straight past it — which is how a personal test account with a
 * handful of stray HSK 6 words and almost nothing tracked at HSK 1-5 could
 * get reported as "working on HSK 6" despite having no real HSK 1-5
 * engagement to have promoted past in the first place.
 */
export const MIN_LEVEL_SAMPLE = 5;

export interface CurrentHSKLevel {
  level: number;
  /** 0–0.99 progress within that level (mastery ratio); 0 when nothing in-app backs it yet */
  fraction: number;
}

/**
 * The one "current HSK" derivation — shared by the home page display and
 * the AI conversation context (getConversationContext), which used to each
 * compute their own different answer (home page: a promotion-threshold
 * scan; conversation: "highest level with ≥1 tracked word", not even
 * mastery-aware). One source of truth instead of two disagreeing ones.
 *
 * "Current level" = the lowest level not yet promoted past
 * (mastery_ratio < HSK_PROMOTION_THRESHOLD), among levels with at least
 * MIN_LEVEL_SAMPLE tracked words — falling back to the highest
 * sufficiently-sampled level once everything's promoted. The placement
 * assessment's baseline (if any) is then applied as a floor: it's a real
 * signal the app's own mastery tracking has no way to see (the assessment's
 * "already knew it" words are deliberately never saved — see
 * saveAssessmentBaseline()), so it can only push the result up, never down.
 */
export function deriveCurrentHSK(
  stats: { level: number | null; total: number; mastery_ratio: number | null }[],
  assessmentBaseline: number | null
): CurrentHSKLevel | null {
  const leveled = stats
    .filter((s): s is { level: number; total: number; mastery_ratio: number | null } =>
      s.level != null && s.total >= MIN_LEVEL_SAMPLE
    )
    .sort((a, b) => a.level - b.level);

  const working = leveled.find((s) => (s.mastery_ratio ?? 0) < HSK_PROMOTION_THRESHOLD);
  const active = working ?? leveled[leveled.length - 1];
  const dataLevel = active ? active.level : null;
  const dataFraction = active ? clamp(active.mastery_ratio ?? 0, 0, 0.99) : 0;

  if (assessmentBaseline != null && assessmentBaseline > (dataLevel ?? 0)) {
    return { level: assessmentBaseline, fraction: 0 };
  }
  if (dataLevel == null) {
    return null;
  }
  return { level: dataLevel, fraction: dataFraction };
}
