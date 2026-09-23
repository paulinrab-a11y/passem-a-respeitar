import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { iniciais, perfilDaSessao } from '@/lib/conta/perfil';
import { ENTRAR } from '@/lib/rotas';
import Foto from './Foto';
import NomeForm from './NomeForm';
import Sair from './Sair';
import Verificacao from './Verificacao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Conta — Passem a Respeitar',
  robots: { index: false, follow: false },
};

const dataLonga = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

/**
 * Sem <Suspense> aqui, e isso foi medido, nao escolhido por gosto.
 *
 * A primeira versao desta pagina embrulhava o conteudo num boundary com o
 * esqueleto como fallback. No Next 15.5.25 com React 19.3 o resultado foi uma
 * pagina presa no esqueleto para sempre: o HTML sai correto, com o conteudo
 * real dentro de `<div hidden>` e o `$RC(...)` nonceado no fim — mas a troca
 * nunca acontece. Chamar `$RC` na mao tambem nao faz nada.
 *
 * Conferido que nao era a CSP (mesmo comportamento com ela desligada), nem
 * erro de servidor (log limpo), nem chunk faltando (cinco carregados, zero
 * falhas). O achado esta escrito na #46.
 *
 * Sem o boundary a pagina espera a consulta antes do primeiro byte. E uma
 * linha indexada mais uma assinatura de URL: alguns milissegundos.
 *
 * O esqueleto continua no repositorio, com as medidas casadas com as do
 * conteudo, esperando a #46.
 */
export default async function Conta() {
  const perfil = await perfilDaSessao();

  // Segunda verificacao, depois do middleware. Nao e paranoia: middleware nao
  // roda em toda forma de alcancar um Server Component, e uma pagina que
  // confia so nele fica dependendo de um matcher continuar certo para sempre.
  // (Issue #29.)
  if (!perfil) redirect(ENTRAR);

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>
        <h1>Conta</h1>

        <div className="conta-topo">
          <Foto url={perfil.fotoUrl} iniciais={iniciais(perfil.nome, perfil.email)} />

          <div className="conta-identidade">
            <p className="conta-nome">{perfil.nome ?? 'Sem nome'}</p>
            <p className="conta-email">
              {perfil.email}
              <span className={`conta-selo${perfil.emailVerificado ? ' ok' : ''}`}>
                {perfil.emailVerificado ? 'verificado' : 'não verificado'}
              </span>
            </p>
            <p className="conta-desde">
              Na lista desde {dataLonga.format(new Date(perfil.criadoEm))}
            </p>
          </div>
        </div>

        {perfil.emailVerificado ? null : <Verificacao />}

        <NomeForm nome={perfil.nome ?? ''} />

        {/* O menu da barra so existe na home. Sem estes dois links, quem esta
            em /conta nao tem como chegar nas outras telas da conta a nao ser
            digitando o endereco. */}
        <p className="conta-atalho">
          <a href="/conta/pedidos">Meus pedidos</a>
          <a href="/conta/seguranca">Trocar senha</a>
        </p>

        <Sair />
      </section>
    </main>
  );
}
