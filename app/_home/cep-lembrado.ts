import { useSyncExternalStore } from 'react';
import { RECADOS_DO_FRETE } from '@/lib/loja/recados-do-frete';
import type { FreteNaFicha as Resposta } from './acoes';

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

// ---------------------------------------------------------------------------
// A cotacao do CEP (#308)
// ---------------------------------------------------------------------------

/**
 * O frete tambem mora aqui, pelo mesmo motivo do CEP: as duas fichas da home
 * mostram a mesma cotacao. Antes cada uma cotava sozinha, e um CEP digitado
 * virava duas consultas e duas baixas na cota do IP. Agora a primeira ficha
 * que pede dispara a consulta; a outra encontra a mesma promessa no ar, ou a
 * resposta ja pronta, e so le.
 *
 * A chave e produto, tamanho e CEP: e o que muda a pergunta.
 *
 * Resposta boa fica enquanto a pagina estiver aberta (o servidor guarda meia
 * hora, e o preco nao muda nesse meio tempo). Recusa fica so enquanto aquele
 * CEP for o da tela: digitar outro e voltar pergunta de novo, como antes.
 */
const respostas = new Map<string, Resposta>();
const noAr = new Map<string, Promise<Resposta>>();
const ouvintesDoFrete = new Set<() => void>();

/** Teto do que a pagina guarda. Ninguem digita cinquenta CEPs, mas um script poderia. */
const MAXIMO_GUARDADO = 50;

function avisaFrete() {
  for (const f of ouvintesDoFrete) f();
}

export function chaveDoFrete(slug: string, tamanho: string | null, cepDaTela: string) {
  return `${slug}|${tamanho ?? ''}|${cepDaTela}`;
}

/**
 * Pede a cotacao desta chave, uma vez so. Ja respondida ou ja no ar, nao
 * faz nada: quem assina `useFreteDaChave` recebe quando chegar.
 */
export function pedeFrete(chave: string, consulta: () => Promise<Resposta>) {
  largaRecusas(chave);
  if (respostas.has(chave) || noAr.has(chave)) return;
  if (respostas.size >= MAXIMO_GUARDADO) respostas.clear();

  const promessa = consulta().catch(
    (): Resposta => ({ ok: false, texto: RECADOS_DO_FRETE['frete-fora-do-ar'] })
  );
  noAr.set(chave, promessa);
  promessa.then((resposta) => {
    noAr.delete(chave);
    respostas.set(chave, resposta);
    avisaFrete();
  });
}

/**
 * Recusas de outros CEPs saem: voltar a eles, ou apagar um digito e digitar
 * de novo, pergunta outra vez. E o jeito de tentar de novo depois de um
 * "fora do ar" ou de um limite.
 */
export function largaRecusas(manter?: string) {
  for (const [k, r] of respostas) if (k !== manter && !r.ok) respostas.delete(k);
}

function assinaFrete(f: () => void) {
  ouvintesDoFrete.add(f);
  return () => {
    ouvintesDoFrete.delete(f);
  };
}

/** A resposta desta chave, ou `null` enquanto nao chegou. */
export function useFreteDaChave(chave: string): Resposta | null {
  return useSyncExternalStore(
    assinaFrete,
    () => respostas.get(chave) ?? null,
    () => null
  );
}

/** Para o teste comecar do zero. */
export function esqueceCep() {
  respostas.clear();
  noAr.clear();
  cep = '';
  lido = false;
  try {
    window.localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
  for (const f of ouvintes) f();
}
