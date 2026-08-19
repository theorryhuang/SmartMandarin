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
          daily_learned: boolean;
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
          daily_learned?: boolean;
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
          daily_learned?: boolean;
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
      cedict: {
        Row: {
          id: number;
          simplified: string;
          traditional: string;
          pinyin: string;
          english: string;
        };
        Insert: {
          id?: number;
          simplified: string;
          traditional: string;
          pinyin: string;
          english: string;
        };
        Update: {
          id?: number;
          simplified?: string;
          traditional?: string;
          pinyin?: string;
          english?: string;
        };
        Relationships: [];
      };
      hsk_vocabulary: {
        Row: { hanzi: string; level: number };
        Insert: { hanzi: string; level: number };
        Update: { hanzi?: string; level?: number };
        Relationships: [];
      };
      extension_tokens: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          label: string;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          label?: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          token_hash?: string;
          label?: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
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
          conversation_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_id: string;
          role: "user" | "assistant";
          raw_text: string;
          tokens: Json;
          created_at?: string;
          conversation_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_id?: string;
          role?: "user" | "assistant";
          raw_text?: string;
          tokens?: Json;
          created_at?: string;
          conversation_id?: string | null;
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
          conversation_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_id: string;
          role: "user" | "assistant";
          content: string;
          created_at?: string;
          conversation_id?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_id?: string;
          role?: "user" | "assistant";
          content?: string;
          created_at?: string;
          conversation_id?: string | null;
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
      user_settings: {
        Row: {
          user_id: string;
          gemini_api_key_encrypted: string | null;
          gemini_api_key_last4: string | null;
          elevenlabs_api_key_encrypted: string | null;
          elevenlabs_api_key_last4: string | null;
          assessment_hsk_level: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          gemini_api_key_encrypted?: string | null;
          gemini_api_key_last4?: string | null;
          elevenlabs_api_key_encrypted?: string | null;
          elevenlabs_api_key_last4?: string | null;
          assessment_hsk_level?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          gemini_api_key_encrypted?: string | null;
          gemini_api_key_last4?: string | null;
          elevenlabs_api_key_encrypted?: string | null;
          elevenlabs_api_key_last4?: string | null;
          assessment_hsk_level?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
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
      daily_learning_batches: {
        Row: {
          id: string;
          user_id: string;
          batch_date: string;
          target_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          batch_date: string;
          target_count: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          batch_date?: string;
          target_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_learning_batches_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      daily_learning_words: {
        Row: {
          id: string;
          batch_id: string;
          user_id: string;
          word_id: string;
          status: "pending" | "passed" | "failed";
          carried_over: boolean;
          quizzed_at: string | null;
          example_sentences: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          user_id: string;
          word_id: string;
          status?: "pending" | "passed" | "failed";
          carried_over?: boolean;
          quizzed_at?: string | null;
          example_sentences?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string;
          user_id?: string;
          word_id?: string;
          status?: "pending" | "passed" | "failed";
          carried_over?: boolean;
          quizzed_at?: string | null;
          example_sentences?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_learning_words_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "daily_learning_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_learning_words_word_id_fkey";
            columns: ["word_id"];
            isOneToOne: false;
            referencedRelation: "vocabulary_mastery";
            referencedColumns: ["id"];
          }
        ];
      };
      friend_requests: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: "pending" | "accepted" | "declined";
          created_at: string;
          responded_at: string | null;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: "pending" | "accepted" | "declined";
          created_at?: string;
          responded_at?: string | null;
        };
        Update: {
          id?: string;
          requester_id?: string;
          addressee_id?: string;
          status?: "pending" | "accepted" | "declined";
          created_at?: string;
          responded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "friend_requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friend_requests_addressee_id_fkey";
            columns: ["addressee_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      find_user_by_email: {
        Args: { p_email: string };
        Returns: { id: string; display_name: string | null; avatar_url: string | null }[];
      };
      get_friends: {
        Args: Record<string, never>;
        Returns: {
          friend_id: string;
          request_id: string;
          display_name: string | null;
          avatar_url: string | null;
          since: string | null;
        }[];
      };
      get_incoming_friend_requests: {
        Args: Record<string, never>;
        Returns: {
          request_id: string;
          user_id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        }[];
      };
      get_outgoing_friend_requests: {
        Args: Record<string, never>;
        Returns: {
          request_id: string;
          user_id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
        }[];
      };
      get_friend_stats: {
        Args: { p_friend_id: string };
        Returns: Json;
      };
      get_due_words: {
        // No p_user_id — derived from auth.uid() inside the function itself
        // (see supabase/migrations/019_fix_security_definer_idor.sql).
        Args: { p_limit?: number };
        Returns: Database["public"]["Tables"]["vocabulary_mastery"]["Row"][];
      };
      get_hsk_level_stats: {
        Args: Record<string, never>;
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
      delete_stale_conversations: {
        Args: { p_max_age?: string };
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
