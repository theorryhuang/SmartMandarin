/**
 * Hand-authored database types until you run `supabase gen types typescript`.
 * Replace this file with the generated output once your Supabase project is linked.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      vocabulary_mastery: {
        Row: {
          id: string;
          user_id: string;
          hanzi: string;
          pinyin: string;
          meaning: string;
          hsk_level: number;
          stability: number;
          difficulty: number;
          last_reviewed: string | null;
          next_review: string | null;
          review_count: number;
          is_slang: boolean;
          flagged_for_immediate_use: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["vocabulary_mastery"]["Row"],
          "id" | "created_at" | "updated_at"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["vocabulary_mastery"]["Row"],
              "id" | "created_at" | "updated_at"
            >
          >;
        Update: Partial<
          Database["public"]["Tables"]["vocabulary_mastery"]["Row"]
        >;
      };
      review_log: {
        Row: {
          id: string;
          user_id: string;
          word_id: string;
          rating: number;
          stability_before: number;
          stability_after: number;
          difficulty_before: number;
          difficulty_after: number;
          retrievability: number;
          reviewed_at: string;
          source: "conversation" | "reader" | "review_session";
        };
        Insert: Omit<
          Database["public"]["Tables"]["review_log"]["Row"],
          "id" | "reviewed_at"
        > &
          Partial<Pick<Database["public"]["Tables"]["review_log"]["Row"], "id" | "reviewed_at">>;
        Update: Partial<Database["public"]["Tables"]["review_log"]["Row"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_due_words: {
        Args: { p_user_id: string; p_limit: number };
        Returns: Database["public"]["Tables"]["vocabulary_mastery"]["Row"][];
      };
      get_hsk_level_stats: {
        Args: { p_user_id: string };
        Returns: {
          level: number;
          total: number;
          high_stability_count: number;
          mastery_ratio: number;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
}
