'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useDesmonteAnimado } from '@/app/_ui/desmonte-animado';
import { sair } from '@/app/conta/acoes';

/**
 * Entrada da area de conta na barra do site (#34).
 *
 * Duas decisoes que nao sao obvias olhando o resultado:
 *
 * 1. O painel vai para o <body> por portal, e nao fica dentro de #bar. A barra
 *    tem `mix-blend-mode: difference`, que blenda o elemento INTEIRO com o que
 *    passa atras — filho nenhum escapa disso. Um painel ali sairia com as cores
 *    invertidas por cima do video de fundo, mudando de cor conforme a pessoa
 *    rola a pagina.
 *
 * 2. Quem esta logado e perguntado depois da pintura, por fetch, em vez de vir
 *    pronto do servidor. Ver o comentario em /api/conta/resumo.
 */

type Resumo = { logado: true; nome: string | null; iniciais: string } | { logado: false };

/**
 * As tres telas existem desde a #41. Ate ela, "Pedidos" era um item desligado
 * com um selo "em breve"; agora nao ha mais item desligado, e o galho que
 * desenhava um ficou fora daqui em vez de ficar de enfeite. Quando voltar a
 * existir tela nao pronta, o git tem o desenho.
 */
const ITENS = [
  { href: '/conta', texto: 'Conta' },
  { href: '/conta/pedidos', texto: 'Pedidos' },
  { href: '/conta/seguranca', texto: 'Segurança' },
] as const;

export default function BarraConta() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const {
    montado: aberto,
    saindo: fechando,
    abrir,
    fechar: fecharPainel,
    aoFimDaAnimacao,
  } = useDesmonteAnimado(300);
  const gatilho = useRef<HTMLButtonElement>(null);
  const [saindo, comecarSaida] = useTransition();
  const painelId = useId();

  useEffect(() => {
    let vivo = true;

    fetch('/api/conta/resumo')
      .then((r) => (r.ok ? r.json() : { logado: false }))
      .then((r: Resumo) => {
        if (vivo) setResumo(r);
      })
      .catch(() => {
        // Barra sem entrada de conta e melhor que barra quebrada.
        if (vivo) setResumo({ logado: false });
      });

    return () => {
      vivo = false;
    };
  }, []);

  // useCallback para poder entrar na lista de dependencias do efeito abaixo
  // sem recriar os listeners a cada render.
  const fecha = useCallback(
    (devolverFoco = true) => {
      fecharPainel();
      if (devolverFoco) gatilho.current?.focus();
    },
    [fecharPainel]
  );

  useEffect(() => {
    if (!aberto) return;

    function noTeclado(e: KeyboardEvent) {
      if (e.key === 'Escape') fecha();
    }
    function foraDoPainel(e: MouseEvent) {
      const alvo = e.target as Node;
      if (!gatilho.current?.contains(alvo) && !document.getElementById(painelId)?.contains(alvo)) {
        fecha(false);
      }
    }

    document.addEventListener('keydown', noTeclado);
    document.addEventListener('pointerdown', foraDoPainel);
    return () => {
      document.removeEventListener('keydown', noTeclado);
      document.removeEventListener('pointerdown', foraDoPainel);
    };
  }, [aberto, painelId, fecha]);

  // Enquanto nao sabemos, nao mostramos nada: piscar "Entrar" e trocar por um
  // nome um instante depois e pior que esperar. A barra so aparece quando o
  // intro termina, entao ninguem ve esta espera.
  if (resumo === null) return null;

  if (!resumo.logado) {
    return (
      <>
        <a href="/entrar">entrar</a>
        {/* Some no telefone. A barra ja tem cinco itens; com sete, "criar
            conta" quebra em duas linhas e a barra cresce de 66 para 82px.
            Medido, nao chutado. Quem toca em "entrar" encontra "Criar conta"
            no rodape daquela tela, a um toque de distancia. */}
        <a href="/criar-conta" className="so-largo">
          criar conta
        </a>
      </>
    );
  }

  const primeiroNome = resumo.nome?.trim().split(/\s+/)[0] || resumo.iniciais;

  return (
    <>
      <button
        type="button"
        ref={gatilho}
        aria-expanded={aberto}
        aria-controls={aberto ? painelId : undefined}
        aria-haspopup="menu"
        onClick={() => (aberto ? fecha(false) : abrir())}
      >
        {/* Nome no desktop, iniciais no telefone. A troca e por CSS e nao por
            JavaScript: media query em JS daria uma renderizacao diferente no
            servidor e no cliente, e o React reclamaria de hidratacao. */}
        <span className="so-largo">{primeiroNome}</span>
        <span className="so-estreito">{resumo.iniciais}</span>
      </button>

      {aberto &&
        createPortal(
          <div
            id={painelId}
            className={`menu-conta${fechando ? ' fechando' : ''}`}
            // O desmonte espera a animacao de saida terminar. Sem isso o painel
            // sumiria de um quadro para o outro e pareceria falha.
            onAnimationEnd={aoFimDaAnimacao}
          >
            <div className="menu-conta-in" role="menu" aria-label="Sua conta">
              {ITENS.map((item) => (
                <a key={item.href} href={item.href} role="menuitem">
                  {item.texto}
                </a>
              ))}

              {/* A acao do servidor, chamada direto. Link para uma tela que
                  so tem um botao seria um passo a mais por nada — e sair e o
                  item que a pessoa clica com pressa. */}
              <form action={() => comecarSaida(() => void sair())}>
                <button type="submit" role="menuitem" className="sair" disabled={saindo}>
                  {saindo ? 'Saindo…' : 'Sair'}
                </button>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
