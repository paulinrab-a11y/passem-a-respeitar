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
 * `role="alert"` fica no paragrafo, que nasce junto com o erro: elemento de
 * alerta inserido na pagina e anunciado na hora por leitor de tela. A `key`
 * muda a cada envio, entao o mesmo erro duas vezes seguidas e anunciado, e
 * animado, duas vezes.
 */
export default function Erro({
  id,
  texto,
  tentativa,
  classe = 'auth-erro',
}: {
  id: string;
  texto: string | null | undefined;
  tentativa: number | string;
  classe?: string;
}) {
  return (
    <div className="erro-vaga">
      {texto ? (
        <p key={tentativa} id={id} className={classe} role="alert">
          {texto}
        </p>
      ) : null}
    </div>
  );
}
