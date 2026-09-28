import Mensagem from './Mensagem';

/**
 * Erro de formulario com lugar reservado (Issue #51).
 *
 * Antes o paragrafo de erro so existia quando havia erro: aparecia entre o
 * ultimo campo e o botao, e empurrava o botao para baixo no instante em que a
 * pessoa ia clicar de novo. Aqui o lugar existe sempre, vazio; o erro entra
 * nele e nada em volta se move.
 *
 * O lugar guarda duas linhas no computador e tres no telefone, que e o que as
 * mensagens mais longas ocupam. Mensagem maior que isso ainda empurra — e o
 * teste das mensagens existe para ninguem escrever uma.
 *
 * Quem desenha o paragrafo, com entrada e saida, e a `Mensagem` (#155). O
 * lugar fica reservado tambem durante a saida: a caixa e esta, e ela nao sai.
 */
export default function Erro({
  id,
  texto,
  tentativa,
  enviando = false,
  classe = 'auth-erro',
}: {
  id: string;
  texto: string | null | undefined;
  tentativa: number | string;
  /** O formulario esta enviando: o erro do envio anterior sai. */
  enviando?: boolean;
  classe?: string;
}) {
  return (
    <div className="erro-vaga">
      <Mensagem
        id={id}
        texto={texto}
        chave={tentativa}
        classe={classe}
        papel="alert"
        enviando={enviando}
      />
    </div>
  );
}
