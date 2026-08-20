// ─── Vocabulary Mastery ───────────────────────────────────────────────────────

export interface VocabularyMastery {
  id: string;
  user_id: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  /**
   * HSK level (1–6). Null when the word is not in the HSK curriculum.
   */
  hsk_level: number | null;
  /**
   * FSRS stability — number of days until retrievability drops to 90%.
   * A new card begins with a value derived from the first rating.
   */
  stability: number;
  /**
   * FSRS difficulty — [1, 10]. Higher = harder to retain.
   */
  difficulty: number;
  last_reviewed: string | null; // ISO 8601 timestamp
  next_review: string | null;   // ISO 8601 timestamp
  /**
   * Total number of reviews performed on this word.
   */
  review_count: number;
  /**
   * Slang/colloquial register flag. When Slang Mode is ON the AI prefers
   * these words over their formal HSK equivalents.
   */
  is_slang: boolean;
  /**
   * Set to true after the user taps a word in the transcript they didn't
   * understand. Causes the word to be injected into the very next AI turn.
   */
  flagged_for_immediate_use: boolean;
  /**
   * True once this word has passed the daily-learning quiz (see
   * app/actions/dailyLearning.ts) — excludes it from future daily batches.
   * Reset to false automatically on a forgotten ("Again") FSRS review, or
   * manually from the word's detail page, so a word you've since forgotten
   * can resurface in the daily program instead of staying excluded forever.
   */
  daily_learned: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A hanzi can have multiple saved senses (e.g. 行 xíng "to walk" vs háng
 * "row/profession"), each its own independent review card — so lookups by
 * hanzi alone return every saved sense, not just one.
 */
export type MasteryMap = Record<string, VocabularyMastery[]>;

// ─── FSRS ─────────────────────────────────────────────────────────────────────

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy */
export type FSRSRating = 1 | 2 | 3 | 4;

export interface FSRSResult {
  stability: number;
  difficulty: number;
  next_review: Date;
  /** Current retrievability (0–1) at the time of review */
  retrievability: number;
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

export interface ReviewCard extends VocabularyMastery {
  /** Computed retrievability at review time */
  retrievability: number;
  /** True when flagged via log_mistake() */
  is_urgent: boolean;
}

// ─── HSK Level Distribution ───────────────────────────────────────────────────

export interface HSKLevelStats {
  /** Null groups every non-HSK word (hsk_level is null) into one bucket */
  level: number | null;
  total: number;
  /** Count of cards with stability ≥ HIGH_STABILITY_THRESHOLD */
  high_stability_count: number;
  /** Percentage of cards considered "stable" (0–1). Null when total is 0. */
  mastery_ratio: number | null;
}

// ─── Story / Interactive Reader ───────────────────────────────────────────────

export interface StoryWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
  /** True when the word is in the user's high-stability vocabulary */
  is_known: boolean;
  /** Present when the word is already tracked in vocabulary_mastery */
  mastery?: VocabularyMastery;
}

export interface GeneratedStory {
  title: string;
  words: StoryWord[];
  raw_text: string;
}

// ─── Daily Learning ─────────────────────────────────────────────────────────
// Separate from the FSRS review queue — see supabase/migrations/015_daily_learning.sql.

export interface DailyLearningWord {
  /** Row id of the daily_learning_words entry (not the word's own id) */
  dailyWordId: string;
  word: VocabularyMastery;
  status: "pending" | "passed" | "failed";
  /** True when this word was re-added after failing a previous quiz */
  carriedOver: boolean;
}

export interface DailyLearningBatch {
  batchId: string;
  batchDate: string; // YYYY-MM-DD
  targetCount: number;
  words: DailyLearningWord[];
}

/**
 * A Gemini-generated example sentence, cached per daily_learning_words row.
 * One per distinct use case of the word — a simple word might have just
 * one, a polysemous one (尽管 as "despite" vs. "go ahead and…") several —
 * rather than a fixed count regardless of how many senses actually exist.
 */
export interface WordExample {
  /** Short label for which sense/usage this sentence demonstrates */
  useCase: string;
  /** e.g. "verb", "adjective", "conjunction" — the word's role *in this sense* */
  partOfSpeech: string;
  sentence: string;
  pinyin: string;
  translation: string;
}

export interface DailyState {
  /** A past unresolved batch that must be quizzed before a new one can be built */
  quizBatch: DailyLearningBatch | null;
  /** Today's already-built batch, if one exists */
  todayBatch: DailyLearningBatch | null;
}


export interface DailyStreak {
  /** Consecutive days (through today, or through yesterday if today's batch isn't built yet) */
  current: number;
  longest: number;
  /** Every distinct calendar day a batch was built, YYYY-MM-DD, ascending */
  activeDates: string[];
}

// ─── Friends ──────────────────────────────────────────────────────────────────
// See supabase/migrations/020_friends.sql — one table doubles as request and
// friendship; an 'accepted' row *is* the friendship.

export interface Friend {
  friendId: string;
  /** Row id in friend_requests — needed to unfriend (delete the row) */
  requestId: string;
  displayName: string;
  avatarUrl: string | null;
  /** When the request was accepted */
  since: string | null;
}

export interface FriendRequest {
  requestId: string;
  /** The other person — requester on an incoming request, addressee on an outgoing one */
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface FriendProgress {
  wordsTracked: number;
  currentHSK: number | null;
  /** Mastery ratio (0-100) within currentHSK specifically, same shape as the home page's own stat */
  currentLevelMasteryPct: number;
  streak: DailyStreak;
}

// ─── Conversation / Transcript ────────────────────────────────────────────────

export interface TranscriptToken {
  hanzi: string;
  pinyin?: string;
  meaning?: string;
  /** Matches a known VocabularyMastery id if the word is tracked */
  mastery_id?: string;
  /** Set immediately when the user taps the word */
  flagged: boolean;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  tokens: TranscriptToken[];
  raw_text: string;
  timestamp: string;
  /** Object URL for the user's recorded audio blob (user turns only) */
  audioUrl?: string;
}
