import { NextResponse } from 'next/server';
import { iniciais, perfilDaSessao } from '@/lib/conta/perfil';

export const dynamic = 'force-dynamic';

/**
 * O minimo que a barra do site precisa saber sobre quem esta olhando.
 *
 * Existe como rota, e nao como leitura no Server Component da home, por causa
 * do custo: a home responde em dezenas de milissegundos e e a pagina que quase
 * todo mundo ve. Ler a sessao la poria uma ida ao Supabase antes do primeiro
 * byte de TODO visitante, logado ou nao. Aqui a barra pergunta depois da
 * pintura, e o intro VHS leva segundos — a resposta chega muito antes de
 * alguem conseguir ver a barra.
 *
 * Para quem nao tem cookie de sessao nao ha ida de rede nenhuma: sem sessao, o
 * cliente do Supabase responde na hora.
 *
 * Tres campos, e nenhum deles sensivel. Mesma disciplina do perfil (#20): a
 * resposta e uma lista fechada, nao um recorte do que sobrou.
 */
export async function GET() {
  const perfil = await perfilDaSessao();

  const corpo = perfil
    ? { logado: true, nome: perfil.nome, iniciais: iniciais(perfil.nome, perfil.email) }
    : { logado: false };

  return NextResponse.json(corpo, {
    // A resposta depende de cookie. Cacheada em qualquer lugar do caminho, ela
    // mostraria o nome de uma pessoa para outra.
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
