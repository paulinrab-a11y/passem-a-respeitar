import type { Metadata } from 'next';
import { destinoSeguro } from '@/lib/rotas';
import Formulario from './Formulario';

// Le cookie no middleware e escreve cookie na acao: nada aqui pode ser
// cacheado. Alem disso a CSP com nonce so e carimbada em render dinamico.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entrar — Passem a Respeitar',
  // Pagina de conta nao tem o que fazer em buscador, e indexada ela vira
  // isca de phishing ranqueada com o nome do EP.
  robots: { index: false, follow: false },
};

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erro?: string }>;
}) {
  const { next, erro } = await searchParams;

  // Validado aqui tambem, e nao so na acao. O valor volta para dentro de um
  // campo do formulario; se chegasse cru, o proximo passo seria o navegador
  // mandando a pessoa para fora do site depois de um login bem-sucedido.
  const destino = destinoSeguro(next);
  // Quem vem do checkout (#387) quer comprar, nao criar senha: a porta que
  // abre primeiro e o codigo no e-mail. A senha continua a um clique.
  const doCheckout =
    destino === '/checkout' || destino.startsWith('/checkout?') || destino.startsWith('/checkout/');

  return (
    <main className="auth">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>

        <h1>Entrar</h1>
        <p className="auth-sub">
          {doCheckout
            ? 'Receba um código no e-mail e siga para a compra.'
            : 'Sua conta, seus pedidos.'}
        </p>

        {/* O callback dos links de e-mail (#30, #32) volta para ca quando o
            link e velho, usado ou inventado. Uma frase, sem dizer qual. */}
        {erro === 'link' ? (
          <p className="auth-erro" role="alert">
            Esse link não vale mais. Entre com sua senha ou peça um novo.
          </p>
        ) : null}

        <Formulario next={destino} modoInicial={doCheckout ? 'codigo' : 'senha'} />
      </section>
    </main>
  );
}
