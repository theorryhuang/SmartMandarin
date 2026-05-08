/**
 * Hand-authored database types.
 * Replace this file with the output of:
 *   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      vocabulary_mastery: {
        Row: {
          id: string;
          user_id: string;
          hanzi: string;
          pinyin: string;
          meaning: string;
          hsk_level: number | null;
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
        Insert: {
          id?: string;
          user_id: string;
          hanzi: string;
          pinyin: string;
          meaning: string;
          hsk_level?: number | null;
          stability?: number;
          difficulty?: number;
          last_reviewed?: string | null;
          next_review?: string | null;
          review_count?: number;
          is_slang?: boolean;
          flagged_for_immediate_use?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          hanzi?: string;
          pinyin?: string;
          meaning?: string;
          hsk_level?: number | null;
          stability?: number;
          difficulty?: number;
          last_reviewed?: string | null;
          next_review?: string | null;
          review_count?: number;
          is_slang?: boolean;
          flagged_for_immediate_use?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vocabulary_mastery_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      slang_bank: {
        Row: {
          id: string;
          hanzi: string;
          pinyin: string | null;
          meaning: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          hanzi: string;
          pinyin?: string | null;
          meaning: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          hanzi?: string;
          pinyin?: string | null;
          meaning?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      speaking_turns: {
        Row: {
          id: string;
          user_id: string;
          client_id: string;
          role: "user" | "assistant";
          raw_text: string;
          tokens: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_id: string;
          role: "user" | "assistant";
          raw_text: string;
          tokens: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_id?: string;
          role?: "user" | "assistant";
          raw_text?: string;
          tokens?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "speaking_turns_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          user_id: string;
          client_id: string;
          role: "user" | "assistant";
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_id: string;
          role: "user" | "assistant";
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_id?: string;
          role?: "user" | "assistant";
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
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
          source: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          word_id: string;
          rating: number;
          stability_before: number;
          stability_after: number;
          difficulty_before: number;
          difficulty_after: number;
          retrievability: number;
          reviewed_at?: string;
          source: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          word_id?: string;
          rating?: number;
          stability_before?: number;
          stability_after?: number;
          difficulty_before?: number;
          difficulty_after?: number;
          retrievability?: number;
          reviewed_at?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_log_word_id_fkey";
            columns: ["word_id"];
            isOneToOne: false;
            referencedRelation: "vocabulary_mastery";
            referencedColumns: ["id"];
          }
        ];
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
      increment_review_count: {
        Args: { word_id: string };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
