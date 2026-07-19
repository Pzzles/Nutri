export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_parse_requests: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          meal_id: string | null
          parsed_result: Json | null
          raw_response: string | null
          raw_text: string
          token_usage: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          meal_id?: string | null
          parsed_result?: Json | null
          raw_response?: string | null
          raw_text: string
          token_usage?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          meal_id?: string | null
          parsed_result?: Json | null
          raw_response?: string | null
          raw_text?: string
          token_usage?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_parse_requests_meal_id_fkey"
            columns: ["meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_parse_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          id: string
          payload_json: Json
          provider: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          id?: string
          payload_json: Json
          provider: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          id?: string
          payload_json?: Json
          provider?: string
        }
        Relationships: []
      }
      food_synonyms: {
        Row: {
          canonical_term: string
          created_at: string
          created_by: string | null
          id: string
          raw_term: string
        }
        Insert: {
          canonical_term: string
          created_at?: string
          created_by?: string | null
          id?: string
          raw_term: string
        }
        Update: {
          canonical_term?: string
          created_at?: string
          created_by?: string | null
          id?: string
          raw_term?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_synonyms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      foods: {
        Row: {
          archived_at: string | null
          barcode: string | null
          brand: string | null
          calories_100g: number
          carbs_100g: number
          created_at: string
          fat_100g: number
          fibre_100g: number | null
          id: string
          name: string
          normalized_name: string
          owner_user_id: string | null
          protein_100g: number
          serving_size_g: number | null
          source: string
          source_identifier: string | null
          status: string
          updated_at: string
          verified: boolean
        }
        Insert: {
          archived_at?: string | null
          barcode?: string | null
          brand?: string | null
          calories_100g: number
          carbs_100g: number
          created_at?: string
          fat_100g: number
          fibre_100g?: number | null
          id?: string
          name: string
          normalized_name: string
          owner_user_id?: string | null
          protein_100g: number
          serving_size_g?: number | null
          source: string
          source_identifier?: string | null
          status?: string
          updated_at?: string
          verified?: boolean
        }
        Update: {
          archived_at?: string | null
          barcode?: string | null
          brand?: string | null
          calories_100g?: number
          carbs_100g?: number
          created_at?: string
          fat_100g?: number
          fibre_100g?: number | null
          id?: string
          name?: string
          normalized_name?: string
          owner_user_id?: string | null
          protein_100g?: number
          serving_size_g?: number | null
          source?: string
          source_identifier?: string | null
          status?: string
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "foods_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      global_cache_promotion_votes: {
        Row: {
          confirmed_at: string
          confirming_user_id: string
          id: string
          matched_food_id: string
          normalized_query: string
        }
        Insert: {
          confirmed_at?: string
          confirming_user_id: string
          id?: string
          matched_food_id: string
          normalized_query: string
        }
        Update: {
          confirmed_at?: string
          confirming_user_id?: string
          id?: string
          matched_food_id?: string
          normalized_query?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_cache_promotion_votes_confirming_user_id_fkey"
            columns: ["confirming_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_cache_promotion_votes_matched_food_id_fkey"
            columns: ["matched_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      global_food_cache: {
        Row: {
          confidence: string
          id: string
          last_used_at: string
          lookup_source: string
          matched_food_id: string
          normalized_query: string
          use_count: number
        }
        Insert: {
          confidence: string
          id?: string
          last_used_at?: string
          lookup_source: string
          matched_food_id: string
          normalized_query: string
          use_count?: number
        }
        Update: {
          confidence?: string
          id?: string
          last_used_at?: string
          lookup_source?: string
          matched_food_id?: string
          normalized_query?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "global_food_cache_matched_food_id_fkey"
            columns: ["matched_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          function_name: string
          id: string
          idempotency_key: string
          response_json: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: string
          idempotency_key: string
          response_json: Json
          user_id: string
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: string
          idempotency_key?: string
          response_json?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_edit_log: {
        Row: {
          edited_at: string
          edited_by: string
          field_name: string
          id: string
          meal_id: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          edited_at?: string
          edited_by: string
          field_name: string
          id?: string
          meal_id: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          edited_at?: string
          edited_by?: string
          field_name?: string
          id?: string
          meal_id?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "meal_edit_log_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_edit_log_meal_id_fkey"
            columns: ["meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_items: {
        Row: {
          calories: number
          carbs_g: number
          confidence: string
          created_at: string
          fat_g: number
          fibre_g: number | null
          food_id: string
          id: string
          match_confidence: string
          meal_id: string
          nutrition_source: string
          portion_confidence: string
          protein_g: number
          quantity: number | null
          raw_phrases: Json
          unit: string | null
          weight_g: number | null
        }
        Insert: {
          calories: number
          carbs_g: number
          confidence: string
          created_at?: string
          fat_g: number
          fibre_g?: number | null
          food_id: string
          id?: string
          match_confidence: string
          meal_id: string
          nutrition_source: string
          portion_confidence: string
          protein_g: number
          quantity?: number | null
          raw_phrases?: Json
          unit?: string | null
          weight_g?: number | null
        }
        Update: {
          calories?: number
          carbs_g?: number
          confidence?: string
          created_at?: string
          fat_g?: number
          fibre_g?: number | null
          food_id?: string
          id?: string
          match_confidence?: string
          meal_id?: string
          nutrition_source?: string
          portion_confidence?: string
          protein_g?: number
          quantity?: number | null
          raw_phrases?: Json
          unit?: string | null
          weight_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meal_items_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_items_meal_id_fkey"
            columns: ["meal_id"]
            isOneToOne: false
            referencedRelation: "meals"
            referencedColumns: ["id"]
          },
        ]
      }
      meals: {
        Row: {
          created_at: string
          eaten_at: string
          id: string
          logged_date: string
          meal_confidence: string
          meal_type: string
          parsed_json: Json | null
          raw_input: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          eaten_at: string
          id?: string
          logged_date: string
          meal_confidence: string
          meal_type: string
          parsed_json?: Json | null
          raw_input?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          eaten_at?: string
          id?: string
          logged_date?: string
          meal_confidence?: string
          meal_type?: string
          parsed_json?: Json | null
          raw_input?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activity_level: string | null
          birth_date: string | null
          created_at: string
          current_weight_kg: number | null
          display_name: string | null
          goal_weight_kg: number | null
          height_cm: number | null
          id: string
          preferred_units: Json
          sex: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          activity_level?: string | null
          birth_date?: string | null
          created_at?: string
          current_weight_kg?: number | null
          display_name?: string | null
          goal_weight_kg?: number | null
          height_cm?: number | null
          id: string
          preferred_units?: Json
          sex?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          activity_level?: string | null
          birth_date?: string | null
          created_at?: string
          current_weight_kg?: number | null
          display_name?: string | null
          goal_weight_kg?: number | null
          height_cm?: number | null
          id?: string
          preferred_units?: Json
          sex?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_meal_items: {
        Row: {
          default_quantity: number | null
          default_unit: string | null
          food_id: string
          id: string
          saved_meal_id: string
        }
        Insert: {
          default_quantity?: number | null
          default_unit?: string | null
          food_id: string
          id?: string
          saved_meal_id: string
        }
        Update: {
          default_quantity?: number | null
          default_unit?: string | null
          food_id?: string
          id?: string
          saved_meal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_meal_items_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_meal_items_saved_meal_id_fkey"
            columns: ["saved_meal_id"]
            isOneToOne: false
            referencedRelation: "saved_meals"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_meals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_favorite: boolean
          last_used_at: string | null
          name: string
          status: string
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_favorite?: boolean
          last_used_at?: string | null
          name: string
          status?: string
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_favorite?: boolean
          last_used_at?: string | null
          name?: string
          status?: string
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_meals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      user_food_cache: {
        Row: {
          confidence: string
          id: string
          last_used_at: string
          lookup_source: string
          matched_food_id: string
          normalized_query: string
          use_count: number
          user_id: string
        }
        Insert: {
          confidence: string
          id?: string
          last_used_at?: string
          lookup_source: string
          matched_food_id: string
          normalized_query: string
          use_count?: number
          user_id: string
        }
        Update: {
          confidence?: string
          id?: string
          last_used_at?: string
          lookup_source?: string
          matched_food_id?: string
          normalized_query?: string
          use_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_food_cache_matched_food_id_fkey"
            columns: ["matched_food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_food_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_food_portions: {
        Row: {
          food_id: string
          last_used_at: string
          use_count: number
          user_id: string
          usual_g: number
        }
        Insert: {
          food_id: string
          last_used_at?: string
          use_count?: number
          user_id: string
          usual_g: number
        }
        Update: {
          food_id?: string
          last_used_at?: string
          use_count?: number
          user_id?: string
          usual_g?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_food_portions_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_food_portions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_goals: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          target_calories: number | null
          target_carbs_g: number | null
          target_fat_g: number | null
          target_protein_g: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          id?: string
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_foods: {
        Row: {
          created_at: string
          default_serving_size: number | null
          default_serving_unit: string | null
          food_id: string
          id: string
          is_favorite: boolean
          last_used_at: string | null
          nickname: string | null
          updated_at: string
          usage_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          default_serving_size?: number | null
          default_serving_unit?: string | null
          food_id: string
          id?: string
          is_favorite?: boolean
          last_used_at?: string | null
          nickname?: string | null
          updated_at?: string
          usage_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          default_serving_size?: number | null
          default_serving_unit?: string | null
          food_id?: string
          id?: string
          is_favorite?: boolean
          last_used_at?: string | null
          nickname?: string | null
          updated_at?: string
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_saved_foods_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "foods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_saved_foods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weight_logs: {
        Row: {
          created_at: string
          id: string
          is_official: boolean
          logged_date: string
          measured_at: string
          notes: string | null
          user_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_official?: boolean
          logged_date: string
          measured_at: string
          notes?: string | null
          user_id: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          id?: string
          is_official?: boolean
          logged_date?: string
          measured_at?: string
          notes?: string | null
          user_id?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "weight_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      fn_fuzzy_food_search: {
        Args: { min_similarity?: number; search_query: string }
        Returns: {
          food_id: string
          name: string
          normalized_name: string
          similarity: number
        }[]
      }
      fn_log_meal: {
        Args: {
          p_eaten_at: string
          p_items: Json
          p_logged_date: string
          p_meal_confidence: string
          p_meal_type: string
          p_parsed_json: Json
          p_raw_input: string
          p_user_id: string
        }
        Returns: string
      }
      fn_log_weight: {
        Args: {
          p_logged_date: string
          p_measured_at: string
          p_notes: string
          p_user_id: string
          p_weight_kg: number
        }
        Returns: string
      }
      fn_recalculate_frequency_rankings: {
        Args: { since_ts: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soundex: { Args: { "": string }; Returns: string }
      text_soundex: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
