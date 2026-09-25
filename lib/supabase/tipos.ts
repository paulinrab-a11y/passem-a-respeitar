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
//
// Vale igual para produtos e produto_variacoes: `preco_centavos` aparece como
// escrevivel e `estoque` como legivel, e nenhum dos dois e verdade pelo
// cliente. O GRANT e por coluna e nao ha policy de escrita. Ver a migration
// 20260924100000.

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
          anonimizado_em: string | null;
          atualizado_em: string;
          criado_em: string;
          entrega_bairro: string | null;
          entrega_cep: string | null;
          entrega_cidade: string | null;
          entrega_complemento: string | null;
          entrega_logradouro: string | null;
          entrega_nome: string | null;
          entrega_numero: string | null;
          entrega_uf: string | null;
          id: string;
          moeda: string;
          numero: number;
          pagamento_id: string | null;
          pagamento_provedor: string | null;
          status: Database['public']['Enums']['status_pedido'];
          total_centavos: number;
          user_id: string | null;
        };
        Insert: {
          anonimizado_em?: string | null;
          atualizado_em?: string;
          criado_em?: string;
          entrega_bairro?: string | null;
          entrega_cep?: string | null;
          entrega_cidade?: string | null;
          entrega_complemento?: string | null;
          entrega_logradouro?: string | null;
          entrega_nome?: string | null;
          entrega_numero?: string | null;
          entrega_uf?: string | null;
          id?: string;
          moeda?: string;
          numero?: never;
          pagamento_id?: string | null;
          pagamento_provedor?: string | null;
          status?: Database['public']['Enums']['status_pedido'];
          total_centavos?: number;
          user_id?: string | null;
        };
        Update: {
          anonimizado_em?: string | null;
          atualizado_em?: string;
          criado_em?: string;
          entrega_bairro?: string | null;
          entrega_cep?: string | null;
          entrega_cidade?: string | null;
          entrega_complemento?: string | null;
          entrega_logradouro?: string | null;
          entrega_nome?: string | null;
          entrega_numero?: string | null;
          entrega_uf?: string | null;
          id?: string;
          moeda?: string;
          numero?: never;
          pagamento_id?: string | null;
          pagamento_provedor?: string | null;
          status?: Database['public']['Enums']['status_pedido'];
          total_centavos?: number;
          user_id?: string | null;
        };
        Relationships: [];
      };
      pagamento_eventos: {
        Row: {
          evento_id: string;
          id: string;
          ocorrido_em: string | null;
          pagamento_id: string | null;
          provedor: string;
          provedor_status: string | null;
          recebido_em: string;
          tipo: string | null;
        };
        Insert: {
          evento_id: string;
          id?: string;
          ocorrido_em?: string | null;
          pagamento_id?: string | null;
          provedor?: string;
          provedor_status?: string | null;
          recebido_em?: string;
          tipo?: string | null;
        };
        Update: {
          evento_id?: string;
          id?: string;
          ocorrido_em?: string | null;
          pagamento_id?: string | null;
          provedor?: string;
          provedor_status?: string | null;
          recebido_em?: string;
          tipo?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pagamento_eventos_pagamento_id_fkey';
            columns: ['pagamento_id'];
            isOneToOne: false;
            referencedRelation: 'pagamentos';
            referencedColumns: ['id'];
          },
        ];
      };
      pagamentos: {
        Row: {
          atualizado_em: string;
          criado_em: string;
          estado: Database['public']['Enums']['estado_pagamento'];
          id: string;
          idempotency_key: string;
          metodo: string | null;
          moeda: string;
          order_id: string;
          provedor: string;
          provedor_pagamento_id: string | null;
          provedor_status: string | null;
          provedor_status_detail: string | null;
          tentativa: number;
          valor_centavos: number;
        };
        Insert: {
          atualizado_em?: string;
          criado_em?: string;
          estado?: Database['public']['Enums']['estado_pagamento'];
          id?: string;
          idempotency_key?: string;
          metodo?: string | null;
          moeda?: string;
          order_id: string;
          provedor?: string;
          provedor_pagamento_id?: string | null;
          provedor_status?: string | null;
          provedor_status_detail?: string | null;
          tentativa: number;
          valor_centavos: number;
        };
        Update: {
          atualizado_em?: string;
          criado_em?: string;
          estado?: Database['public']['Enums']['estado_pagamento'];
          id?: string;
          idempotency_key?: string;
          metodo?: string | null;
          moeda?: string;
          order_id?: string;
          provedor?: string;
          provedor_pagamento_id?: string | null;
          provedor_status?: string | null;
          provedor_status_detail?: string | null;
          tentativa?: number;
          valor_centavos?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'pagamentos_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      produto_variacoes: {
        Row: {
          ativo: boolean;
          atualizado_em: string;
          criado_em: string;
          estoque: number | null;
          id: string;
          ordem: number;
          preco_centavos: number;
          produto_id: string;
          tamanho: string | null;
        };
        Insert: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          estoque?: number | null;
          id?: string;
          ordem?: number;
          preco_centavos: number;
          produto_id: string;
          tamanho?: string | null;
        };
        Update: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          estoque?: number | null;
          id?: string;
          ordem?: number;
          preco_centavos?: number;
          produto_id?: string;
          tamanho?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'produto_variacoes_produto_id_fkey';
            columns: ['produto_id'];
            isOneToOne: false;
            referencedRelation: 'produtos';
            referencedColumns: ['id'];
          },
        ];
      };
      produtos: {
        Row: {
          ativo: boolean;
          atualizado_em: string;
          criado_em: string;
          descricao: string | null;
          id: string;
          nome: string;
          slug: string;
        };
        Insert: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          descricao?: string | null;
          id?: string;
          nome: string;
          slug: string;
        };
        Update: {
          ativo?: boolean;
          atualizado_em?: string;
          criado_em?: string;
          descricao?: string | null;
          id?: string;
          nome?: string;
          slug?: string;
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
      autenticado_recentemente: { Args: { p_minutos?: number }; Returns: boolean };
      cria_pedido: {
        Args: {
          p_user_id: string;
          p_total_centavos: number;
          p_endereco: Json;
          p_itens: Json;
        };
        Returns: { pedido_id: string; pedido_numero: number }[];
      };
      encerra_sessao: { Args: { p_identificador: string }; Returns: boolean };
      minha_sessao_atual: { Args: Record<PropertyKey, never>; Returns: string };
      muda_status_pedido: {
        Args: {
          p_order_id: string;
          p_para: Database['public']['Enums']['status_pedido'];
          p_autor: string;
          p_motivo?: string | null;
        };
        Returns: {
          de: Database['public']['Enums']['status_pedido'];
          para: Database['public']['Enums']['status_pedido'];
        }[];
      };
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
      estado_pagamento: 'criado' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado' | 'estornado';
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
      estado_pagamento: ['criado', 'pendente', 'aprovado', 'recusado', 'cancelado', 'estornado'],
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
