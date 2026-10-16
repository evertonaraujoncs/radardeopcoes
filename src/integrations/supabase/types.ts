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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      alertas: {
        Row: {
          criado_em: string
          id: number
          lido: boolean
          mensagem: string
          sinal_id: number | null
          tipo: string
        }
        Insert: {
          criado_em?: string
          id?: never
          lido?: boolean
          mensagem: string
          sinal_id?: number | null
          tipo: string
        }
        Update: {
          criado_em?: string
          id?: never
          lido?: boolean
          mensagem?: string
          sinal_id?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_sinal_id_fkey"
            columns: ["sinal_id"]
            isOneToOne: false
            referencedRelation: "sinais"
            referencedColumns: ["id"]
          },
        ]
      }
      ativos: {
        Row: {
          atualizado_em: string
          fonte_preco: string | null
          historico_precos: Json | null
          nome: string | null
          preco: number | null
          setor: string | null
          ticker: string
        }
        Insert: {
          atualizado_em?: string
          fonte_preco?: string | null
          historico_precos?: Json | null
          nome?: string | null
          preco?: number | null
          setor?: string | null
          ticker: string
        }
        Update: {
          atualizado_em?: string
          fonte_preco?: string | null
          historico_precos?: Json | null
          nome?: string | null
          preco?: number | null
          setor?: string | null
          ticker?: string
        }
        Relationships: []
      }
      dividendos: {
        Row: {
          data_com: string
          data_pagamento: string | null
          id: number
          ticker: string
          tipo: string
          valor: number | null
        }
        Insert: {
          data_com: string
          data_pagamento?: string | null
          id?: never
          ticker: string
          tipo?: string
          valor?: number | null
        }
        Update: {
          data_com?: string
          data_pagamento?: string | null
          id?: never
          ticker?: string
          tipo?: string
          valor?: number | null
        }
        Relationships: []
      }
      eventos: {
        Row: {
          data: string
          descricao: string | null
          id: number
          ticker: string
          tipo: string
        }
        Insert: {
          data: string
          descricao?: string | null
          id?: never
          ticker: string
          tipo: string
        }
        Update: {
          data?: string
          descricao?: string | null
          id?: never
          ticker?: string
          tipo?: string
        }
        Relationships: []
      }
      fundamentos: {
        Row: {
          data: string
          divida_liquida_ebitda: number | null
          dy: number | null
          pl: number | null
          pvp: number | null
          roe: number | null
          ticker: string
          valuation_score: number | null
        }
        Insert: {
          data: string
          divida_liquida_ebitda?: number | null
          dy?: number | null
          pl?: number | null
          pvp?: number | null
          roe?: number | null
          ticker: string
          valuation_score?: number | null
        }
        Update: {
          data?: string
          divida_liquida_ebitda?: number | null
          dy?: number | null
          pl?: number | null
          pvp?: number | null
          roe?: number | null
          ticker?: string
          valuation_score?: number | null
        }
        Relationships: []
      }
      noticias: {
        Row: {
          fonte: string | null
          id: number
          publicado_em: string | null
          resumo: string | null
          sentimento: number | null
          ticker: string
          titulo: string
          url: string | null
        }
        Insert: {
          fonte?: string | null
          id?: never
          publicado_em?: string | null
          resumo?: string | null
          sentimento?: number | null
          ticker: string
          titulo: string
          url?: string | null
        }
        Update: {
          fonte?: string | null
          id?: never
          publicado_em?: string | null
          resumo?: string | null
          sentimento?: number | null
          ticker?: string
          titulo?: string
          url?: string | null
        }
        Relationships: []
      }
      opcoes_grade: {
        Row: {
          ask: number | null
          ativo: string | null
          ativo_base: string | null
          bid: number | null
          data_coleta: string
          delta: number | null
          id: number
          iv: number | null
          negocios: number | null
          strike: number | null
          ticker: string
          tipo: string | null
          ultimo: number | null
          vencimento: string | null
          volume: number | null
        }
        Insert: {
          ask?: number | null
          ativo?: string | null
          ativo_base?: string | null
          bid?: number | null
          data_coleta?: string
          delta?: number | null
          id?: never
          iv?: number | null
          negocios?: number | null
          strike?: number | null
          ticker: string
          tipo?: string | null
          ultimo?: number | null
          vencimento?: string | null
          volume?: number | null
        }
        Update: {
          ask?: number | null
          ativo?: string | null
          ativo_base?: string | null
          bid?: number | null
          data_coleta?: string
          delta?: number | null
          id?: never
          iv?: number | null
          negocios?: number | null
          strike?: number | null
          ticker?: string
          tipo?: string | null
          ultimo?: number | null
          vencimento?: string | null
          volume?: number | null
        }
        Relationships: []
      }
      parametros: {
        Row: {
          capital: number | null
          estrategias_ativas: Json
          liquidez_min_negocios: number
          prob_lucro_min: number
          risco_max_pct: number
          spread_max_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          capital?: number | null
          estrategias_ativas?: Json
          liquidez_min_negocios?: number
          prob_lucro_min?: number
          risco_max_pct?: number
          spread_max_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          capital?: number | null
          estrategias_ativas?: Json
          liquidez_min_negocios?: number
          prob_lucro_min?: number
          risco_max_pct?: number
          spread_max_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scraper_status: {
        Row: {
          ativo: string | null
          executado_em: string
          id: number
          linhas: number | null
          notas: string | null
          status: string
        }
        Insert: {
          ativo?: string | null
          executado_em?: string
          id?: never
          linhas?: number | null
          notas?: string | null
          status: string
        }
        Update: {
          ativo?: string | null
          executado_em?: string
          id?: never
          linhas?: number | null
          notas?: string | null
          status?: string
        }
        Relationships: []
      }
      sinais: {
        Row: {
          atualizado_em: string
          breakevens: Json | null
          chave: string
          credito_debito: number | null
          criado_em: string
          curva_payoff: Json | null
          dias_vencimento: number | null
          estrategia: string
          fatores: Json | null
          gregas: Json | null
          id: number
          iv_rank: number | null
          lucro_max: number | null
          motivos: Json | null
          perda_max: number | null
          pernas: Json
          preco_ativo: number | null
          prob_lucro: number | null
          retorno_sobre_risco: number | null
          riscos: Json | null
          score: number | null
          status: string
          ticker: string
          valor_esperado: number | null
          vencimento: string
        }
        Insert: {
          atualizado_em?: string
          breakevens?: Json | null
          chave: string
          credito_debito?: number | null
          criado_em?: string
          curva_payoff?: Json | null
          dias_vencimento?: number | null
          estrategia: string
          fatores?: Json | null
          gregas?: Json | null
          id?: never
          iv_rank?: number | null
          lucro_max?: number | null
          motivos?: Json | null
          perda_max?: number | null
          pernas: Json
          preco_ativo?: number | null
          prob_lucro?: number | null
          retorno_sobre_risco?: number | null
          riscos?: Json | null
          score?: number | null
          status?: string
          ticker: string
          valor_esperado?: number | null
          vencimento: string
        }
        Update: {
          atualizado_em?: string
          breakevens?: Json | null
          chave?: string
          credito_debito?: number | null
          criado_em?: string
          curva_payoff?: Json | null
          dias_vencimento?: number | null
          estrategia?: string
          fatores?: Json | null
          gregas?: Json | null
          id?: never
          iv_rank?: number | null
          lucro_max?: number | null
          motivos?: Json | null
          perda_max?: number | null
          pernas?: Json
          preco_ativo?: number | null
          prob_lucro?: number | null
          retorno_sobre_risco?: number | null
          riscos?: Json | null
          score?: number | null
          status?: string
          ticker?: string
          valor_esperado?: number | null
          vencimento?: string
        }
        Relationships: []
      }
      sinais_historico: {
        Row: {
          id: number
          momento: string
          observacao: string | null
          preco_ativo: number | null
          prob_lucro: number | null
          score: number | null
          sinal_id: number
        }
        Insert: {
          id?: never
          momento?: string
          observacao?: string | null
          preco_ativo?: number | null
          prob_lucro?: number | null
          score?: number | null
          sinal_id: number
        }
        Update: {
          id?: never
          momento?: string
          observacao?: string | null
          preco_ativo?: number | null
          prob_lucro?: number | null
          score?: number | null
          sinal_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "sinais_historico_sinal_id_fkey"
            columns: ["sinal_id"]
            isOneToOne: false
            referencedRelation: "sinais"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
