export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      anthropometric_readings: {
        Row: {
          created_at: string
          id: string
          reading_number: number
          session_id: string
          site_code: string
          updated_at: string
          user_id: string
          value_cm: number
        }
        Insert: {
          created_at?: string
          id?: string
          reading_number: number
          session_id: string
          site_code: string
          updated_at?: string
          user_id: string
          value_cm: number
        }
        Update: {
          created_at?: string
          id?: string
          reading_number?: number
          session_id?: string
          site_code?: string
          updated_at?: string
          user_id?: string
          value_cm?: number
        }
        Relationships: [
          {
            foreignKeyName: "anthropometric_readings_session_owner_fkey"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "anthropometric_sessions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      anthropometric_representatives: {
        Row: {
          algorithm_version: string
          all_readings_range_cm: number
          created_at: string
          eligible_for_interpretation: boolean | null
          initial_pair_difference_cm: number
          method: string
          pairwise_differences: Json | null
          quality: string
          quality_acknowledged_at: string | null
          quality_acknowledgement_version: string | null
          quality_flags: Json
          reading_count: number
          representative_cm: number
          selected_pair_spread_cm: number | null
          selected_reading_indices: number[] | null
          session_id: string
          site_code: string
          source_reading_ids: string[] | null
          unselected_reading_id: string | null
          user_id: string
          warning_codes: Json | null
        }
        Insert: {
          algorithm_version: string
          all_readings_range_cm: number
          created_at?: string
          eligible_for_interpretation?: boolean | null
          initial_pair_difference_cm: number
          method: string
          pairwise_differences?: Json | null
          quality: string
          quality_acknowledged_at?: string | null
          quality_acknowledgement_version?: string | null
          quality_flags?: Json
          reading_count: number
          representative_cm: number
          selected_pair_spread_cm?: number | null
          selected_reading_indices?: number[] | null
          session_id: string
          site_code: string
          source_reading_ids?: string[] | null
          unselected_reading_id?: string | null
          user_id: string
          warning_codes?: Json | null
        }
        Update: {
          algorithm_version?: string
          all_readings_range_cm?: number
          created_at?: string
          eligible_for_interpretation?: boolean | null
          initial_pair_difference_cm?: number
          method?: string
          pairwise_differences?: Json | null
          quality?: string
          quality_acknowledged_at?: string | null
          quality_acknowledgement_version?: string | null
          quality_flags?: Json
          reading_count?: number
          representative_cm?: number
          selected_pair_spread_cm?: number | null
          selected_reading_indices?: number[] | null
          session_id?: string
          site_code?: string
          source_reading_ids?: string[] | null
          unselected_reading_id?: string | null
          user_id?: string
          warning_codes?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "anthropometric_representatives_session_owner_fkey"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "anthropometric_sessions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      anthropometric_sessions: {
        Row: {
          created_at: string
          data_contract_version: string
          finalized_at: string | null
          id: string
          idempotency_key: string | null
          logged_date: string | null
          measured_at: string | null
          notes: string | null
          payload_hash: string | null
          protocol_version: string
          representative_algorithm_version: string | null
          status: string
          thresholds_version: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data_contract_version?: string
          finalized_at?: string | null
          id?: string
          idempotency_key?: string | null
          logged_date?: string | null
          measured_at?: string | null
          notes?: string | null
          payload_hash?: string | null
          protocol_version?: string
          representative_algorithm_version?: string | null
          status?: string
          thresholds_version?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data_contract_version?: string
          finalized_at?: string | null
          id?: string
          idempotency_key?: string | null
          logged_date?: string | null
          measured_at?: string | null
          notes?: string | null
          payload_hash?: string | null
          protocol_version?: string
          representative_algorithm_version?: string | null
          status?: string
          thresholds_version?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anthropometric_sessions_user_id_fkey"
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
      calorie_target_snapshots: {
        Row: {
          activity_level: string
          activity_multiplier: number
          activity_multiplier_version: string
          age_years: number
          aggressive_rate_acknowledged: boolean
          algorithm_name: string
          algorithm_version: string
          calculated_bmr_kcal: number
          calculated_tdee_kcal: number
          calculation_timestamp: string
          config_versions: Json
          created_at: string
          daily_adjustment_kcal: number
          effective_maintenance_kcal: number
          equation_sex: string
          final_target_kcal: number
          goal_mode: string
          goal_phase_id: string | null
          height_cm: number
          id: string
          input_provenance: Json
          maintenance_source: string
          manual_maintenance_kcal: number | null
          official_weight_kg: number
          profile_birth_date: string
          raw_target_kcal: number
          requested_rate_kg_per_week: number
          user_id: string
          warning_codes: Json
          weight_log_id: string | null
          weight_log_source: string | null
          weight_measured_at: string | null
        }
        Insert: {
          activity_level: string
          activity_multiplier: number
          activity_multiplier_version: string
          age_years: number
          aggressive_rate_acknowledged?: boolean
          algorithm_name: string
          algorithm_version: string
          calculated_bmr_kcal: number
          calculated_tdee_kcal: number
          calculation_timestamp?: string
          config_versions?: Json
          created_at?: string
          daily_adjustment_kcal?: number
          effective_maintenance_kcal: number
          equation_sex: string
          final_target_kcal: number
          goal_mode: string
          goal_phase_id?: string | null
          height_cm: number
          id?: string
          input_provenance?: Json
          maintenance_source: string
          manual_maintenance_kcal?: number | null
          official_weight_kg: number
          profile_birth_date: string
          raw_target_kcal: number
          requested_rate_kg_per_week?: number
          user_id: string
          warning_codes?: Json
          weight_log_id?: string | null
          weight_log_source?: string | null
          weight_measured_at?: string | null
        }
        Update: {
          activity_level?: string
          activity_multiplier?: number
          activity_multiplier_version?: string
          age_years?: number
          aggressive_rate_acknowledged?: boolean
          algorithm_name?: string
          algorithm_version?: string
          calculated_bmr_kcal?: number
          calculated_tdee_kcal?: number
          calculation_timestamp?: string
          config_versions?: Json
          created_at?: string
          daily_adjustment_kcal?: number
          effective_maintenance_kcal?: number
          equation_sex?: string
          final_target_kcal?: number
          goal_mode?: string
          goal_phase_id?: string | null
          height_cm?: number
          id?: string
          input_provenance?: Json
          maintenance_source?: string
          manual_maintenance_kcal?: number | null
          official_weight_kg?: number
          profile_birth_date?: string
          raw_target_kcal?: number
          requested_rate_kg_per_week?: number
          user_id?: string
          warning_codes?: Json
          weight_log_id?: string | null
          weight_log_source?: string | null
          weight_measured_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calorie_target_snapshots_goal_phase_id_fkey"
            columns: ["goal_phase_id"]
            isOneToOne: false
            referencedRelation: "goal_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calorie_target_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calorie_target_snapshots_weight_log_id_fkey"
            columns: ["weight_log_id"]
            isOneToOne: false
            referencedRelation: "weight_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_log_status: {
        Row: {
          created_at: string
          id: string
          logged_date: string
          marked_complete_at: string | null
          reopened_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          logged_date: string
          marked_complete_at?: string | null
          reopened_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          logged_date?: string
          marked_complete_at?: string | null
          reopened_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_log_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      goal_feedback_assessments: {
        Row: {
          adjustment_blocked_reason_codes: Json
          advisory_adjustment_direction: string | null
          advisory_calorie_adjustment_kcal: number | null
          algorithm_versions: Json
          assessed_at: string
          assessed_date: string
          created_at: string
          current_official_weight_kg: number | null
          current_p6_confidence: string
          current_p6_status: string
          current_p6_weekly_rate_kg: number | null
          current_p7_confidence: string | null
          current_p7_coverage_fraction: number | null
          current_p7_status: string | null
          current_rate_lower_kg: number | null
          current_rate_upper_kg: number | null
          current_target_calories: number | null
          feedback_action: string
          goal_attainment_ratio: number | null
          goal_mode: string
          goal_phase_id: string
          goal_phase_started_at: string
          goal_target_rate_kg_per_week: number | null
          historical_p6_confidence: string | null
          historical_p6_status: string | null
          historical_p6_weekly_rate_kg: number | null
          historical_p7_confidence: string | null
          historical_p7_coverage_fraction: number | null
          historical_p7_status: string | null
          id: string
          limitations: Json
          maintenance_drift_direction: string | null
          previous_rate_lower_kg: number | null
          previous_rate_upper_kg: number | null
          progress_state: string
          proposed_target_kcal: number | null
          reason_codes: Json
          suggested_adjustment_kcal: number | null
          user_id: string
          warnings: Json
        }
        Insert: {
          adjustment_blocked_reason_codes?: Json
          advisory_adjustment_direction?: string | null
          advisory_calorie_adjustment_kcal?: number | null
          algorithm_versions?: Json
          assessed_at: string
          assessed_date?: string
          created_at?: string
          current_official_weight_kg?: number | null
          current_p6_confidence: string
          current_p6_status: string
          current_p6_weekly_rate_kg?: number | null
          current_p7_confidence?: string | null
          current_p7_coverage_fraction?: number | null
          current_p7_status?: string | null
          current_rate_lower_kg?: number | null
          current_rate_upper_kg?: number | null
          current_target_calories?: number | null
          feedback_action: string
          goal_attainment_ratio?: number | null
          goal_mode: string
          goal_phase_id: string
          goal_phase_started_at: string
          goal_target_rate_kg_per_week?: number | null
          historical_p6_confidence?: string | null
          historical_p6_status?: string | null
          historical_p6_weekly_rate_kg?: number | null
          historical_p7_confidence?: string | null
          historical_p7_coverage_fraction?: number | null
          historical_p7_status?: string | null
          id?: string
          limitations?: Json
          maintenance_drift_direction?: string | null
          previous_rate_lower_kg?: number | null
          previous_rate_upper_kg?: number | null
          progress_state: string
          proposed_target_kcal?: number | null
          reason_codes?: Json
          suggested_adjustment_kcal?: number | null
          user_id: string
          warnings?: Json
        }
        Update: {
          adjustment_blocked_reason_codes?: Json
          advisory_adjustment_direction?: string | null
          advisory_calorie_adjustment_kcal?: number | null
          algorithm_versions?: Json
          assessed_at?: string
          assessed_date?: string
          created_at?: string
          current_official_weight_kg?: number | null
          current_p6_confidence?: string
          current_p6_status?: string
          current_p6_weekly_rate_kg?: number | null
          current_p7_confidence?: string | null
          current_p7_coverage_fraction?: number | null
          current_p7_status?: string | null
          current_rate_lower_kg?: number | null
          current_rate_upper_kg?: number | null
          current_target_calories?: number | null
          feedback_action?: string
          goal_attainment_ratio?: number | null
          goal_mode?: string
          goal_phase_id?: string
          goal_phase_started_at?: string
          goal_target_rate_kg_per_week?: number | null
          historical_p6_confidence?: string | null
          historical_p6_status?: string | null
          historical_p6_weekly_rate_kg?: number | null
          historical_p7_confidence?: string | null
          historical_p7_coverage_fraction?: number | null
          historical_p7_status?: string | null
          id?: string
          limitations?: Json
          maintenance_drift_direction?: string | null
          previous_rate_lower_kg?: number | null
          previous_rate_upper_kg?: number | null
          progress_state?: string
          proposed_target_kcal?: number | null
          reason_codes?: Json
          suggested_adjustment_kcal?: number | null
          user_id?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "goal_feedback_assessments_goal_phase_id_fkey"
            columns: ["goal_phase_id"]
            isOneToOne: false
            referencedRelation: "goal_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_feedback_assessments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_phases: {
        Row: {
          created_at: string
          edit_count: number
          ended_at: string | null
          ended_reason: string | null
          id: string
          manual_maintenance_kcal: number | null
          mode: string
          snapshot_id: string | null
          started_at: string
          starting_weight_kg: number
          starting_weight_source: string
          status: string
          superseded_by: string | null
          target_calories: number | null
          target_carbs_g: number | null
          target_change_kg_per_week: number | null
          target_fat_g: number | null
          target_fibre_g: number | null
          target_protein_g: number | null
          target_weight_kg: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          edit_count?: number
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          manual_maintenance_kcal?: number | null
          mode: string
          snapshot_id?: string | null
          started_at?: string
          starting_weight_kg: number
          starting_weight_source: string
          status?: string
          superseded_by?: string | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_change_kg_per_week?: number | null
          target_fat_g?: number | null
          target_fibre_g?: number | null
          target_protein_g?: number | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          edit_count?: number
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          manual_maintenance_kcal?: number | null
          mode?: string
          snapshot_id?: string | null
          started_at?: string
          starting_weight_kg?: number
          starting_weight_source?: string
          status?: string
          superseded_by?: string | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_change_kg_per_week?: number | null
          target_fat_g?: number | null
          target_fibre_g?: number | null
          target_protein_g?: number | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_phases_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "calorie_target_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_phases_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "goal_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_phases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      maintenance_estimate_snapshots: {
        Row: {
          algorithm_versions: Json
          analysis_calendar_days: number
          analysis_window_end: string
          analysis_window_start: string
          average_intake_kcal: number
          calculated_at: string
          confidence: string
          created_at: string
          effective_phase_maintenance_kcal: number | null
          effective_phase_maintenance_source: string | null
          eligible_nutrition_coverage: number
          eligible_nutrition_day_count: number
          equation_estimated_tdee_kcal: number | null
          goal_mode: string
          goal_phase_id: string
          goal_phase_started_at: string
          id: string
          incomplete_day_count: number
          input_provenance: Json
          maintenance_lower_kcal: number | null
          maintenance_upper_kcal: number | null
          manual_maintenance_override_kcal: number | null
          not_logged_day_count: number
          observed_maintenance_kcal: number
          probably_complete_day_count: number
          rate_lower_kg: number | null
          rate_upper_kg: number | null
          selected_weight_window_days: number
          status: string
          timezone: string
          user_id: string
          warnings: Json
          weekly_rate_kg: number
          weight_trend_confidence: string
        }
        Insert: {
          algorithm_versions?: Json
          analysis_calendar_days: number
          analysis_window_end: string
          analysis_window_start: string
          average_intake_kcal: number
          calculated_at?: string
          confidence: string
          created_at?: string
          effective_phase_maintenance_kcal?: number | null
          effective_phase_maintenance_source?: string | null
          eligible_nutrition_coverage: number
          eligible_nutrition_day_count: number
          equation_estimated_tdee_kcal?: number | null
          goal_mode: string
          goal_phase_id: string
          goal_phase_started_at: string
          id?: string
          incomplete_day_count?: number
          input_provenance?: Json
          maintenance_lower_kcal?: number | null
          maintenance_upper_kcal?: number | null
          manual_maintenance_override_kcal?: number | null
          not_logged_day_count?: number
          observed_maintenance_kcal: number
          probably_complete_day_count?: number
          rate_lower_kg?: number | null
          rate_upper_kg?: number | null
          selected_weight_window_days: number
          status: string
          timezone: string
          user_id: string
          warnings?: Json
          weekly_rate_kg: number
          weight_trend_confidence: string
        }
        Update: {
          algorithm_versions?: Json
          analysis_calendar_days?: number
          analysis_window_end?: string
          analysis_window_start?: string
          average_intake_kcal?: number
          calculated_at?: string
          confidence?: string
          created_at?: string
          effective_phase_maintenance_kcal?: number | null
          effective_phase_maintenance_source?: string | null
          eligible_nutrition_coverage?: number
          eligible_nutrition_day_count?: number
          equation_estimated_tdee_kcal?: number | null
          goal_mode?: string
          goal_phase_id?: string
          goal_phase_started_at?: string
          id?: string
          incomplete_day_count?: number
          input_provenance?: Json
          maintenance_lower_kcal?: number | null
          maintenance_upper_kcal?: number | null
          manual_maintenance_override_kcal?: number | null
          not_logged_day_count?: number
          observed_maintenance_kcal?: number
          probably_complete_day_count?: number
          rate_lower_kg?: number | null
          rate_upper_kg?: number | null
          selected_weight_window_days?: number
          status?: string
          timezone?: string
          user_id?: string
          warnings?: Json
          weekly_rate_kg?: number
          weight_trend_confidence?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_estimate_snapshots_goal_phase_id_fkey"
            columns: ["goal_phase_id"]
            isOneToOne: false
            referencedRelation: "goal_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_estimate_snapshots_user_id_fkey"
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
          food_id: string | null
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
          food_id?: string | null
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
          food_id?: string | null
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
          idempotency_key: string | null
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
          idempotency_key?: string | null
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
          idempotency_key?: string | null
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
          target_fibre_g: number | null
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
          target_fibre_g?: number | null
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
          target_fibre_g?: number | null
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
          source: string | null
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
          source?: string | null
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
          source?: string | null
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
      fn_delete_anthropometric_session: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: string
      }
      fn_edit_meal_item: {
        Args: {
          p_item_id: string
          p_meal_id: string
          p_new_weight_g: number
          p_user_id: string
        }
        Returns: Json
      }
      fn_fuzzy_food_search: {
        Args: { min_similarity?: number; search_query: string }
        Returns: {
          food_id: string
          name: string
          normalized_name: string
          similarity: number
        }[]
      }
      fn_get_daily_meal_totals: {
        Args: { p_end: string; p_start: string; p_user_id: string }
        Returns: {
          item_count: number
          logged_date: string
          meal_count: number
          total_kcal: number
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
          p_source?: string
          p_user_id: string
          p_weight_kg: number
        }
        Returns: string
      }
      fn_recalculate_frequency_rankings: {
        Args: { since_ts: string }
        Returns: undefined
      }
      fn_save_anthropometric_session: {
        Args: {
          p_data_contract_version: string
          p_idempotency_key: string
          p_logged_date: string
          p_measured_at: string
          p_notes: string
          p_payload_hash: string
          p_protocol_version: string
          p_readings: Json
          p_representative_algorithm_version: string
          p_representatives: Json
          p_session_id: string
          p_status: string
          p_thresholds_version: string
          p_timezone: string
          p_user_id: string
        }
        Returns: Json
      }
      fn_save_meal_template: {
        Args: {
          p_description: string
          p_idem_key: string
          p_items: Json
          p_name: string
          p_user_id: string
        }
        Returns: string
      }
      fn_set_daily_log_status: {
        Args: { p_date: string; p_status: string; p_user_id: string }
        Returns: Json
      }
      fn_start_goal_phase:
        | {
            Args: {
              p_mode: string
              p_started_at: string
              p_starting_weight_kg: number
              p_starting_weight_source: string
              p_target_calories?: number
              p_target_carbs_g?: number
              p_target_change_kg_per_week?: number
              p_target_fat_g?: number
              p_target_fibre_g?: number
              p_target_protein_g?: number
              p_target_weight_kg?: number
              p_transition?: string
              p_user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_mode: string
              p_started_at: string
              p_starting_weight_kg: number
              p_starting_weight_source: string
              p_target_calories?: number
              p_target_carbs_g?: number
              p_target_change_kg_per_week?: number
              p_target_fat_g?: number
              p_target_protein_g?: number
              p_target_weight_kg?: number
              p_transition?: string
              p_user_id: string
            }
            Returns: string
          }
      fn_start_goal_phase_v2: {
        Args: {
          p_activity_level?: string
          p_activity_multiplier?: number
          p_activity_multiplier_version?: string
          p_age_years?: number
          p_aggressive_rate_acknowledged?: boolean
          p_algorithm_name?: string
          p_algorithm_version?: string
          p_calculated_bmr_kcal?: number
          p_calculated_tdee_kcal?: number
          p_calculation_timestamp?: string
          p_config_versions?: Json
          p_daily_adjustment_kcal?: number
          p_effective_maintenance_kcal?: number
          p_equation_sex?: string
          p_final_target_kcal?: number
          p_height_cm?: number
          p_input_provenance?: Json
          p_maintenance_source?: string
          p_manual_maintenance_kcal?: number
          p_mode: string
          p_official_weight_kg?: number
          p_profile_birth_date?: string
          p_raw_target_kcal?: number
          p_requested_rate_kg_per_week?: number
          p_started_at: string
          p_starting_weight_kg: number
          p_starting_weight_source: string
          p_target_calories?: number
          p_target_carbs_g?: number
          p_target_change_kg_per_week?: number
          p_target_fat_g?: number
          p_target_fibre_g?: number
          p_target_protein_g?: number
          p_target_weight_kg?: number
          p_transition?: string
          p_user_id: string
          p_warning_codes?: Json
          p_weight_log_id?: string
          p_weight_log_source?: string
          p_weight_measured_at?: string
        }
        Returns: Json
      }
      fn_upsert_portion_history: {
        Args: { p_food_id: string; p_user_id: string; p_usual_g: number }
        Returns: undefined
      }
      is_anthropometric_site_code: { Args: { value: string }; Returns: boolean }
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
