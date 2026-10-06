import { useSyncExternalStore } from 'react';

/**
 * O CEP que a pessoa digitou na ficha da camiseta (#205).
 *
 * Vive em dois lugares ao mesmo tempo: na secao merch e na loja, que sao a
 * mesma ficha em duas telas. Digitar num tem que aparecer no outro, por isso
 * o valor mora aqui, fora dos componentes, e eles assinam.
 *
 * E fica no navegador, em `localStorage`, para o checkout ja comecar com ele
 * — a pessoa viu o frete, clicou em Comprar, e nao digita o CEP de novo. Fica
 * so neste navegador: nenhum servidor recebe isto por aqui.
 */

const CHAVE = 'par_cep';

const ouvintes = new Set<() => void>();
let cep = '';
let lido = false;

function le() {
  if (!lido) {
    lido = true;
    try {
      cep = (window.localStorage.getItem(CHAVE) ?? '').replace(/\D/g, '').slice(0, 8);
    } catch {
      cep = '';
    }
  }
  return cep;
}

export function lembraCep(novo: string) {
  const limpo = novo.replace(/\D/g, '').slice(0, 8);
  if (limpo === le()) return;
  cep = limpo;
  try {
    if (limpo) window.localStorage.setItem(CHAVE, limpo);
    else window.localStorage.removeItem(CHAVE);
  } catch {
    // Sem armazenamento (modo privado, cota): fica so na memoria da pagina.
  }
  for (const f of ouvintes) f();
}

function assina(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/** Durante o render do servidor nao ha CEP: a tela nasce igual para todo mundo. */
const noServidor = () => '';

/** O CEP lembrado, so digitos. Re-renderiza quem usa quando ele muda. */
export function useCepLembrado() {
  return useSyncExternalStore(assina, le, noServidor);
}

/** Para o teste comecar do zero. */
export function esqueceCep() {
  cep = '';
  lido = false;
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
  for (const f of ouvintes) f();
}
