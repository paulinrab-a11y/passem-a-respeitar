'use client';

import { useTrocaComSaida } from './troca-com-saida';

/**
 * Erro ou recado de formulario, com entrada E saida (Issue #155).
 *
 * A entrada ja existia: o paragrafo nasce animado. A saida nao: quando a
 * mensagem mudava, ou deixava de valer, o paragrafo era removido no mesmo
 * quadro. Aqui a mensagem antiga sai com um fade curto antes de a nova entrar.
 *
 * `enviando` e para formulario com lugar reservado (#51): a pessoa corrigiu e
 * enviou de novo, e o erro antigo fala de um envio que nao e mais o atual.
 * Ele sai na hora do envio, e o lugar continua reservado. Sem lugar
 * reservado, nao passe `enviando`: a mensagem sumiria e o botao subiria no
 * meio do envio.
 *
 * O papel fica no paragrafo, que nasce junto com a mensagem: elemento de
 * alerta inserido na pagina e anunciado na hora por leitor de tela. A `key`
 * muda a cada resposta, entao a mesma mensagem duas vezes seguidas e anunciada,
 * e animada, duas vezes.
 */

type Conteudo = {
  texto: string;
  chave: number | string;
  classe: string;
  papel: 'alert' | 'status';
};

const mesmaMensagem = (a: Conteudo | null, b: Conteudo | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.chave === b.chave &&
    a.texto === b.texto &&
    a.classe === b.classe &&
    a.papel === b.papel);

export default function Mensagem({
  id,
  texto,
  chave,
  classe,
  papel,
  enviando = false,
}: {
  id?: string;
  texto: string | null | undefined;
  /** Muda a cada resposta da acao. E o que separa "a mesma de novo" de "a mesma ainda". */
  chave: number | string;
  classe: string;
  papel: 'alert' | 'status';
  enviando?: boolean;
}) {
  const alvo: Conteudo | null = texto && !enviando ? { texto, chave, classe, papel } : null;

  const { mostrado, saindo, aoFimDaAnimacao } = useTrocaComSaida(alvo, {
    igual: mesmaMensagem,
    // Mais que os 120 ms da saida, com folga para um quadro perdido.
    limiteMs: 200,
  });

  if (!mostrado) return null;

  return (
    <p
      key={mostrado.chave}
      id={id}
      className={`${mostrado.classe}${saindo ? ' saindo' : ''}`}
      role={mostrado.papel}
      onAnimationEnd={aoFimDaAnimacao}
    >
      {mostrado.texto}
    </p>
  );
}
