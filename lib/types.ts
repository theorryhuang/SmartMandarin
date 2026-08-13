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
  level: number;
  total: number;
  /** Count of cards with stability ≥ HIGH_STABILITY_THRESHOLD */
  high_stability_count: number;
  /** Percentage of cards considered "stable" (0–1) */
  mastery_ratio: number;
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
