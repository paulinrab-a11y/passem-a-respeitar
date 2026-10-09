import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ehAdmin } from '@/lib/admin';
import { iniciais, perfilDaSessao } from '@/lib/conta/perfil';
import { formataDataPorExtenso } from '@/lib/datas';
import { TERMOS } from '@/lib/loja/termos';
import { ENTRAR } from '@/lib/rotas';
import { EsqueletoPerfil } from './Esqueletos';
import Foto from './Foto';
import NomeForm from './NomeForm';
import Sair from './Sair';
import Verificacao from './Verificacao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Conta — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * A moldura sai no primeiro byte; o perfil chega por streaming (#46).
 *
 * A primeira tentativa de boundary aqui ficou "presa no esqueleto" e foi
 * retirada. O diagnostico fechou na #46: o React 19.2+ agenda a revelacao do
 * boundary para um quadro desenhado, e o navegador embutido em que eu
 * testava estava com o painel oculto — sem quadro, sem troca. Em aba visivel
 * a troca acontece na hora.
 *
 * O que fica FORA do boundary e estatico de proposito: voltar e titulo nao
 * se movem quando o conteudo chega, e o esqueleto e o ultimo bloco da
 * pagina. E isso que mantem o layout shift em zero.
 */
export default function Conta() {
  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>
        <h1>Conta</h1>

        <Suspense fallback={<EsqueletoPerfil />}>
          <Perfil />
        </Suspense>
      </section>
    </main>
  );
}

async function Perfil() {
  const perfil = await perfilDaSessao();

  // Segunda verificacao, depois do middleware. Nao e paranoia: middleware nao
  // roda em toda forma de alcancar um Server Component, e uma pagina que
  // confia so nele fica dependendo de um matcher continuar certo para sempre.
  // (Issue #29.)
  if (!perfil) redirect(ENTRAR);

  return (
    <>
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
          <p className="conta-desde">Na lista desde {formataDataPorExtenso(perfil.criadoEm)}</p>
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
        {/* Os termos (#276), direto no "como pedir": quem chega aqui querendo
              desistir de uma compra quer o caminho, nao o texto inteiro. */}
        <a href={`${TERMOS}#como-pedir`}>Cancelar, desistir ou trocar</a>
        {/* So para quem e administrador (#43). O papel vem do servidor;
              esconder o link e cortesia, nao seguranca — a tela confere de novo. */}
        {ehAdmin({ email: perfil.email, emailVerificado: perfil.emailVerificado }) ? (
          <a href="/conta/admin/pedidos">Administrar pedidos</a>
        ) : null}
      </p>

      <Sair />
    </>
  );
}
