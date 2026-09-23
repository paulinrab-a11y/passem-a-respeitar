// GERADO A PARTIR DO SCHEMA. Nao editar na mao.
//
// Regenerar depois de toda migration nova, em dois passos:
//   npx supabase gen types typescript --project-id kmkhokjkpbysmyohaqag > lib/supabase/tipos.ts
//   npm run lint:fix
//
// O segundo passo existe porque o gerador escreve no estilo dele (aspas duplas,
// sem ponto e virgula) e o Biome do repositorio usa outro. Reformatar uma vez e
// melhor que manter o arquivo fora do lint: fora do lint, ninguem repara quando
// ele para de compilar junto com o resto.
//
// Aviso sobre `Insert` e `Update`: eles listam status, total_centavos e
// user_id como escreviveis. E so o TypeScript descrevendo colunas — ele nao
// sabe de GRANT nem de RLS. Pelo cliente do navegador essas escritas sao
// recusadas pelo banco. Ver supabase/migrations/20260923120000.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      order_items: {
        Row: {
          criado_em: string;
          id: string;
          nome: string;
          order_id: string;
          preco_unitario_centavos: number;
          produto_slug: string;
          quantidade: number;
          tamanho: string | null;
        };
        Insert: {
          criado_em?: string;
          id?: string;
          nome: string;
          order_id: string;
          preco_unitario_centavos: number;
          produto_slug: string;
          quantidade: number;
          tamanho?: string | null;
        };
        Update: {
          criado_em?: string;
          id?: string;
          nome?: string;
          order_id?: string;
          preco_unitario_centavos?: number;
          produto_slug?: string;
          quantidade?: number;
          tamanho?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_status_history: {
        Row: {
          autor: string | null;
          criado_em: string;
          de: Database['public']['Enums']['status_pedido'] | null;
          id: string;
          motivo: string | null;
          order_id: string;
          para: Database['public']['Enums']['status_pedido'];
        };
        Insert: {
          autor?: string | null;
          criado_em?: string;
          de?: Database['public']['Enums']['status_pedido'] | null;
          id?: string;
          motivo?: string | null;
          order_id: string;
          para: Database['public']['Enums']['status_pedido'];
        };
        Update: {
          autor?: string | null;
          criado_em?: string;
          de?: Database['public']['Enums']['status_pedido'] | null;
          id?: string;
          motivo?: string | null;
          order_id?: string;
          para?: Database['public']['Enums']['status_pedido'];
        };
        Relationships: [
          {
            foreignKeyName: 'order_status_history_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          atualizado_em: string;
          criado_em: string;
          id: string;
          moeda: string;
          numero: number;
          pagamento_id: string | null;
          pagamento_provedor: string | null;
          status: Database['public']['Enums']['status_pedido'];
          total_centavos: number;
          user_id: string;
        };
        Insert: {
          atualizado_em?: string;
          criado_em?: string;
          id?: string;
          moeda?: string;
          numero?: never;
          pagamento_id?: string | null;
          pagamento_provedor?: string | null;
          status?: Database['public']['Enums']['status_pedido'];
          total_centavos?: number;
          user_id: string;
        };
        Update: {
          atualizado_em?: string;
          criado_em?: string;
          id?: string;
          moeda?: string;
          numero?: never;
          pagamento_id?: string | null;
          pagamento_provedor?: string | null;
          status?: Database['public']['Enums']['status_pedido'];
          total_centavos?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          atualizado_em: string;
          criado_em: string;
          foto_caminho: string | null;
          id: string;
          nome: string | null;
          telefone: string | null;
        };
        Insert: {
          atualizado_em?: string;
          criado_em?: string;
          foto_caminho?: string | null;
          id: string;
          nome?: string | null;
          telefone?: string | null;
        };
        Update: {
          atualizado_em?: string;
          criado_em?: string;
          foto_caminho?: string | null;
          id?: string;
          nome?: string | null;
          telefone?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      encerra_sessao: { Args: { p_identificador: string }; Returns: boolean };
      minhas_sessoes: {
        Args: Record<PropertyKey, never>;
        Returns: {
          identificador: string;
          criada_em: string;
          ultimo_acesso: string;
          agente: string | null;
          rede: string | null;
          e_a_atual: boolean;
        }[];
      };
      pedido_e_meu: { Args: { p_order_id: string }; Returns: boolean };
    };
    Enums: {
      status_pedido:
        | 'aguardando_pagamento'
        | 'pago'
        | 'em_producao'
        | 'enviado'
        | 'entregue'
        | 'cancelado'
        | 'reembolsado';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      status_pedido: [
        'aguardando_pagamento',
        'pago',
        'em_producao',
        'enviado',
        'entregue',
        'cancelado',
        'reembolsado',
      ],
    },
  },
} as const;
