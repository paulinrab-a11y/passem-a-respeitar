import { type NextRequest, NextResponse } from 'next/server';
import { ehAdmin } from '@/lib/admin';
import { csvDePedidos, type LinhaParaExportar, nomeDoArquivo } from '@/lib/conta/exportacao';
import { leBuscaAdmin, statusDoFiltro } from '@/lib/conta/painel';
import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

/**
 * "Exportar CSV" do painel do dono (Issue #345).
 *
 * Le pedido alheio, como o painel: a mesma conferencia de papel, no servidor,
 * antes do client administrativo nascer. Quem nao administra recebe 404 — o
 * mesmo "isto nao existe" da tela, sem dizer que ha algo aqui para quem tem o
 * papel certo.
 *
 * O que sai e o que a planilha mostra, coluna por coluna: nada de `user_id`,
 * id de pagamento ou e-mail. E-mail fica no detalhe do pedido, um por vez —
 * uma lista de e-mails de clientes num arquivo solto e o tipo de coisa que
 * acaba anexada no lugar errado.
 */

/** Dez por dez minutos: o dono exporta uma vez por dia, um script exportaria em laco. */
const LIMITE = { maximo: 10, janelaMs: 10 * 60 * 1000 };

/**
 * Teto de linhas. A loja vende uma peca sob encomenda; dez mil pedidos e
 * muito mais do que ela vai ter, e o teto impede que um filtro "Todos" num
 * banco cheio de lixo vire uma resposta de dezenas de megabytes.
 */
const MAX_LINHAS = 10_000;

const COLUNAS =
  'numero, criado_em, status, total_centavos, frete_centavos, frete_servico, frete_prazo_dias, entrega_nome, entrega_cep, entrega_logradouro, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf, order_items(nome, tamanho, quantidade)';

const NAO_EXISTE = () => NextResponse.json({ erro: 'não encontrado' }, { status: 404 });

export async function GET(request: NextRequest) {
  const usuario = await usuarioDaSessao();
  if (!usuario) return NAO_EXISTE();

  if (!ehAdmin({ email: usuario.email, emailVerificado: Boolean(usuario.email_confirmed_at) })) {
    return NAO_EXISTE();
  }

  const cota = await limita(`exporta:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return NextResponse.json(
      { erro: 'Muitas exportações seguidas. Tente de novo em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(cota.esperarS) } }
    );
  }

  // `?status=` passa pelo mesmo zod do painel: fora da lista vira o padrao,
  // e o `in()` recebe a lista fechada, nunca o texto da URL.
  const { filtro } = leBuscaAdmin(Object.fromEntries(request.nextUrl.searchParams));
  const alvo = statusDoFiltro(filtro);

  let consulta = clienteAdmin().from('orders').select(COLUNAS);
  if (alvo) consulta = consulta.in('status', alvo);

  const { data, error } = await consulta
    .order('criado_em', { ascending: false })
    .order('numero', { ascending: false })
    .limit(MAX_LINHAS);

  if (error || !data) {
    console.warn('[admin] exportacao indisponivel:', error?.code);
    return NextResponse.json(
      { erro: 'Não consegui ler os pedidos agora. Tente de novo.' },
      { status: 503 }
    );
  }

  return new NextResponse(csvDePedidos(data as LinhaParaExportar[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomeDoArquivo()}"`,
      // Endereco de cliente: nenhum cache no caminho guarda isto.
      'Cache-Control': 'no-store, private',
    },
  });
}
