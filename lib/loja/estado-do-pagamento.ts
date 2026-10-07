/**
 * Traducao do status do provedor para o nosso (Issue #110).
 *
 * Funcao pura, e num arquivo so de proposito: e o unico lugar do projeto que
 * sabe o vocabulario do Mercado Pago. A tabela `pagamentos` guarda o status
 * CRU do lado do nosso estado justamente para este mapa poder ser corrigido
 * depois sem perder a informacao original.
 *
 * O vocabulario e o da Orders API, que NAO e o da Payments API:
 *
 *   Orders     processed / accredited     action_required / waiting_transfer
 *   Payments   approved                   pending
 *
 * A Payments API esta marcada como legado na documentacao atual. Copiar o enum
 * de qualquer uma das duas para dentro do nosso banco seria envelhecer junto.
 */

export type EstadoInterno =
  | 'criado'
  | 'pendente'
  | 'aprovado'
  | 'recusado'
  | 'cancelado'
  | 'estornado';

export type ResumoDoProvedor = {
  estado: EstadoInterno;
  /** Como veio, sem traducao. E isto que vai para a coluna `provedor_status`. */
  status: string | null;
  statusDetail: string | null;
};

/**
 * Map, nunca objeto literal: a chave vem do provedor, e em objeto literal
 * `constructor` acha a funcao herdada do prototipo. Ja me pegou na #41.
 */
const MAPA = new Map<string, EstadoInterno>([
  // Aprovado
  ['processed', 'aprovado'],
  ['approved', 'aprovado'],

  // Esperando: Pix aguardando transferencia, cartao em analise
  ['action_required', 'pendente'],
  ['pending', 'pendente'],
  ['processing', 'pendente'],
  ['in_process', 'pendente'],
  ['authorized', 'pendente'],

  // Recusado. NAO cancela o pedido: cabe outra tentativa, e e para isso que
  // `pagamentos.tentativa` existe.
  ['failed', 'recusado'],
  ['rejected', 'recusado'],

  ['cancelled', 'cancelado'],
  ['canceled', 'cancelado'],
  ['expired', 'cancelado'],

  ['refunded', 'estornado'],
  ['charged_back', 'estornado'],
]);

/**
 * Status desconhecido vira `pendente`, e essa escolha tem lado.
 *
 * Os dois erros possiveis nao custam igual: dizer "aprovado" sem ter sido
 * manda mercadoria sem pagamento; dizer "pendente" sem ser faz a pessoa
 * esperar. O segundo se conserta com uma consulta ao provedor; o primeiro,
 * nao.
 *
 * Por isso nada aqui inventa aprovacao nem cancelamento.
 */
export function montaEstado(
  status?: string | null,
  statusDetail?: string | null
): ResumoDoProvedor {
  const cru = status?.trim().toLowerCase() ?? null;

  return {
    estado: (cru && MAPA.get(cru)) || 'pendente',
    status: status ?? null,
    statusDetail: statusDetail ?? null,
  };
}

/**
 * O estado novo pode substituir o que ja esta guardado?
 *
 * Existe porque notificacao chega fora de ordem: uma antiga dizendo `pendente`
 * nao pode apagar um `aprovado` que ja chegou. A regra e simples — estado
 * final nao volta atras.
 */
const FINAIS = new Set<EstadoInterno>(['aprovado', 'cancelado', 'estornado']);

export function podeAvancar(atual: EstadoInterno, novo: EstadoInterno): boolean {
  if (atual === novo) return false;

  // Estorno e o unico caminho depois de aprovado, e e legitimo.
  if (atual === 'aprovado') return novo === 'estornado';

  // Cancelado e estornado nao voltam para lugar nenhum.
  if (FINAIS.has(atual)) return false;

  return true;
}

/**
 * Estados que ainda podem mudar por iniciativa do provedor. E o que o webhook
 * espera, o que a conciliacao varre e o que a cobranca procura antes de abrir
 * tentativa nova.
 */
export const EM_ABERTO: readonly EstadoInterno[] = ['criado', 'pendente'];

export function emAberto(estado: string): boolean {
  return (EM_ABERTO as readonly string[]).includes(estado);
}
