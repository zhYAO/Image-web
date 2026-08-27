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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      generation_batches: {
        Row: {
          config: Json
          correlation_id: string
          created_at: string
          id: string
          idempotency_key: string
          model: string
          parent_batch_id: string | null
          prompt: string
          provider: string
          request_hash: string
          session_id: string
          skill_id: string | null
          skill_version: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config: Json
          correlation_id?: string
          created_at?: string
          id?: string
          idempotency_key: string
          model: string
          parent_batch_id?: string | null
          prompt: string
          provider: string
          request_hash: string
          session_id: string
          skill_id?: string | null
          skill_version?: string | null
          source: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          correlation_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          model?: string
          parent_batch_id?: string | null
          prompt?: string
          provider?: string
          request_hash?: string
          session_id?: string
          skill_id?: string | null
          skill_version?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_batches_parent_batch_id_fkey"
            columns: ["parent_batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_batches_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      generations: {
        Row: {
          asset_expires_at: string | null
          asset_status: string | null
          attempt_count: number
          batch_id: string
          correlation_id: string
          created_at: string
          error_code: string | null
          id: string
          model: string
          params: Json
          prompt: string
          provider: string
          provider_request_id: string | null
          provider_submission_state: string
          status: string
          storage_bucket: string | null
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          asset_expires_at?: string | null
          asset_status?: string | null
          attempt_count?: number
          batch_id: string
          correlation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          model: string
          params: Json
          prompt: string
          provider: string
          provider_request_id?: string | null
          provider_submission_state?: string
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          asset_expires_at?: string | null
          asset_status?: string | null
          attempt_count?: number
          batch_id?: string
          correlation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          model?: string
          params?: Json
          prompt?: string
          provider?: string
          provider_request_id?: string | null
          provider_submission_state?: string
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generations_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_uploads: {
        Row: {
          created_at: string
          height: number
          id: string
          mime_type: string
          original_filename: string
          session_id: string
          size_bytes: number
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          upload_expires_at: string
          user_id: string
          width: number
        }
        Insert: {
          created_at?: string
          height: number
          id?: string
          mime_type: string
          original_filename: string
          session_id: string
          size_bytes: number
          status?: string
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          upload_expires_at?: string
          user_id: string
          width: number
        }
        Update: {
          created_at?: string
          height?: number
          id?: string
          mime_type?: string
          original_filename?: string
          session_id?: string
          size_bytes?: number
          status?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          upload_expires_at?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "reference_uploads_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          next_sequence: number
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          next_sequence?: number
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          next_sequence?: number
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timeline_items: {
        Row: {
          batch_id: string | null
          created_at: string
          error_code: string | null
          id: string
          kind: string
          role: string | null
          sequence: number
          session_id: string
          status: string | null
          text: string | null
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          kind: string
          role?: string | null
          sequence: number
          session_id: string
          status?: string | null
          text?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          kind?: string
          role?: string | null
          sequence?: number
          session_id?: string
          status?: string | null
          text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_items_batch_session_fk"
            columns: ["batch_id", "session_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id", "session_id"]
          },
          {
            foreignKeyName: "timeline_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_image_message: {
        Args: { p_message_id: number }
        Returns: boolean
      }
      assert_chat_provider_available: {
        Args: { p_provider: string }
        Returns: boolean
      }
      claim_cleanup_job: { Args: never; Returns: Json }
      claim_image_generation: { Args: never; Returns: Json }
      commit_preview_usage: {
        Args: { p_business_key: string; p_user_id: string }
        Returns: boolean
      }
      complete_chat_turn: {
        Args: { p_content: string; p_session_id: string; p_user_id: string }
        Returns: string
      }
      complete_cleanup_job: { Args: { p_job_id: string }; Returns: boolean }
      complete_image_generation: {
        Args: {
          p_generation_id: string
          p_message_id: number
          p_provider_request_id: string
          p_storage_path: string
        }
        Returns: undefined
      }
      fail_cleanup_job: {
        Args: { p_error_code: string; p_job_id: string }
        Returns: Json
      }
      fail_image_generation: {
        Args: {
          p_error_code: string
          p_generation_id: string
          p_message_id: number
          p_release_quota: boolean
          p_submission_state: string
        }
        Returns: undefined
      }
      get_provider_health: { Args: never; Returns: Json }
      get_user_quota: { Args: { p_user_id: string }; Returns: Json }
      mark_provider_submission_started: {
        Args: { p_generation_id: string }
        Returns: boolean
      }
      prune_preview_usage: { Args: never; Returns: number }
      record_chat_provider_result: {
        Args: { p_is_error: boolean; p_provider: string }
        Returns: undefined
      }
      record_image_safety_decision: {
        Args: {
          p_category: string
          p_decision: string
          p_generation_id: string
        }
        Returns: undefined
      }
      recreate_image_generation: {
        Args: {
          p_batch_id: string
          p_correlation_id: string
          p_generation_id: string
          p_idempotency_key: string
          p_mode: string
          p_request_hash: string
          p_user_id: string
        }
        Returns: Json
      }
      release_preview_usage: {
        Args: {
          p_business_key: string
          p_correlation_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      request_session_deletion: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: string
      }
      reserve_preview_usage: {
        Args: {
          p_business_key: string
          p_bytes: number
          p_correlation_id: string
          p_creates_session: boolean
          p_operation: string
          p_user_id: string
        }
        Returns: boolean
      }
      retry_image_generation: {
        Args: { p_error_code: string; p_generation_id: string }
        Returns: boolean
      }
      schedule_cleanup_worker: { Args: never; Returns: number }
      schedule_generation_worker: { Args: never; Returns: number }
      set_provider_runtime_enabled: {
        Args: { p_enabled: boolean; p_evidence: string; p_provider: string }
        Returns: boolean
      }
      set_runtime_flag: {
        Args: { p_enabled: boolean; p_flag: string }
        Returns: boolean
      }
      start_chat_turn: {
        Args: { p_message: string; p_session_id: string; p_user_id: string }
        Returns: Json
      }
      submit_image_generation: {
        Args: {
          p_config: Json
          p_correlation_id: string
          p_idempotency_key: string
          p_model: string
          p_parent_batch_id: string
          p_prompt: string
          p_provider: string
          p_request_hash: string
          p_session_id: string
          p_skill_id: string
          p_skill_version: string
          p_source: string
          p_user_id: string
        }
        Returns: Json
      }
      unschedule_cleanup_worker: { Args: never; Returns: boolean }
      unschedule_generation_worker: { Args: never; Returns: boolean }
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
