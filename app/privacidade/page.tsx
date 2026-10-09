import type { Metadata } from 'next';
import { CONTATO } from '@/lib/contato';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacidade — Passem a Respeitar',
};

/**
 * Politica de privacidade (Issue #109).
 *
 * Nasceu por uma razao concreta: a tela de pagamento passou a deixar o
 * Mercado Pago coletar dados do dispositivo para antifraude, e isso e
 * tratamento de dado pessoal — nao entra em silencio. O resto do texto
 * descreve o que o site ja fazia.
 *
 * O calculo do frete (#199) tambem: o CEP sai do site para o Melhor Envio.
 * E para o ViaCEP, que preenche o endereco (#204).
 *
 * A protecao contra bot (#28) entrou pelo mesmo motivo: o widget manda dado do
 * navegador para a Cloudflare, e isso se diz aqui.
 *
 * A #254 fechou o que ficou para tras: o Concierge (#191) manda a conversa ao
 * Google; o CPF da tela de pagamento passa pelo servidor a caminho do Mercado
 * Pago; e os cookies, o CEP no navegador, a Vercel, o Supabase, o Sentry, o
 * Mailjet (os e-mails da conta saem pelo SMTP dele no Supabase Auth) e o
 * Upstash (a contagem do rate limit, com IP e e-mail na chave) ja existiam
 * sem estar aqui. Assim como o IP e o user-agent que `cabecalhosDeOrigem`
 * (lib/supabase/servidor.ts) repassa para o Supabase gravar em auth.sessions,
 * e que a tela de aparelhos conectados (#38) mostra. Cada frase saiu do codigo, nao de modelo de
 * politica: nome de cookie, duracao e o que vai para fora sao os de verdade,
 * e o teste amarra os nomes as constantes.
 *
 * Escrita para ser lida, nao para parecer contrato: frases curtas, cada
 * secao responde a uma pergunta. Sem data de "ultima atualizacao" inventada
 * — a data e a do commit.
 */
export default function Privacidade() {
  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>

        <h1>Privacidade</h1>

        <p className="detalhe-nota">
          Este site é da Whynot Visuals, para o EP <em>Passem a Respeitar</em> (Santxx x Ch3fe).
          Aqui está o que guardamos sobre você, por quê, e o que você pode fazer a respeito.
        </p>

        <section className="detalhe-bloco">
          <h2>O que guardamos</h2>
          <p className="detalhe-nota">
            <strong>Conta:</strong> e-mail, nome e, se você enviar, uma foto. Servem para você
            entrar, recuperar a senha e acompanhar seus pedidos.
          </p>
          <p className="detalhe-nota">
            <strong>Aparelhos conectados:</strong> para cada sessão aberta — cada aparelho em que
            você entrou —, o Supabase guarda o endereço IP e o tipo de navegador e de sistema. É o
            que aparece em <a href="/conta/seguranca">Conta › Segurança</a>, para você reconhecer um
            acesso estranho e encerrar; a tela mostra só o começo do IP. O registro fica até a
            sessão ser encerrada: quando você clica em Sair, encerra o aparelho nessa tela, troca a
            senha (as outras sessões caem) ou apaga a conta.{' '}
            <strong>Fechar o navegador sem sair apaga o cookie, mas não esse registro.</strong>
          </p>
          <p className="detalhe-nota">
            <strong>Pedidos:</strong> o que você comprou, quanto pagou, e o endereço de entrega. Sem
            o endereço a camiseta não chega.
          </p>
          <p className="detalhe-nota">
            <strong>Pagamento:</strong> o pagamento é processado pelo Mercado Pago. O número do seu
            cartão e o código de segurança <strong>nunca passam pelos nossos servidores</strong>:
            eles são digitados em campos que pertencem ao Mercado Pago. Nós guardamos só se foi Pix
            ou cartão, o resultado — aprovado, pendente, recusado — e um identificador da transação.
          </p>
          <p className="detalhe-nota">
            <strong>CPF:</strong> o Mercado Pago pede o CPF (ou o CNPJ) de quem paga. Esse número
            passa pelo nosso servidor <strong>só para chegar ao Mercado Pago</strong>, junto com o
            e-mail da sua conta, e não fica guardado aqui.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Prevenção a fraude na tela de pagamento</h2>
          <p className="detalhe-nota">
            Enquanto você está na tela de pagamento, o Mercado Pago e o Mercado Livre coletam dados
            do seu dispositivo para calcular o risco de fraude: características do navegador, do
            sistema e da conexão, e a página de onde você veio. Isso acontece{' '}
            <strong>só nessa tela</strong> — na home e no resto do site, não.
          </p>
          <p className="detalhe-nota">
            Fazemos isso porque, sem esses dados, mais pagamentos legítimos são recusados. Esses
            dados vão para o Mercado Pago, não para nós, e valem a{' '}
            <a
              href="https://www.mercadopago.com.br/privacidade"
              target="_blank"
              rel="noopener noreferrer"
            >
              política de privacidade deles
            </a>
            .
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Proteção contra robôs</h2>
          <p className="detalhe-nota">
            Os formulários de entrar, criar conta e recuperar senha, o campo de convite e o
            concierge usam o Turnstile, da Cloudflare, para separar gente de script. Para isso a
            Cloudflare recebe dados do seu navegador e da sua conexão, como o endereço IP. Isso
            acontece <strong>só nesses formulários</strong> — na home, só quando você chega no campo
            de convite ou abre o concierge —, e não serve para publicidade.
          </p>
          <p className="detalhe-nota">
            Esses dados vão para a Cloudflare, não para nós, e valem a{' '}
            <a
              href="https://www.cloudflare.com/pt-br/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              política de privacidade deles
            </a>
            . Nós guardamos só a resposta: passou ou não passou.
          </p>
          <p className="detalhe-nota">
            Além disso, o site conta quantos envios chegam do mesmo endereço IP — e, nos formulários
            de conta, do mesmo e-mail — para frear quem tenta em massa. A contagem fica no Upstash,
            um banco de dados na nuvem, anotada com esse IP e esse e-mail, e some sozinha: as mais
            longas, cerca de duas horas depois.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>O que fazemos com o CEP</h2>
          <p className="detalhe-nota">
            Para mostrar o preço do frete dos Correios, o site manda ao Melhor Envio o{' '}
            <strong>CEP de entrega</strong>, junto com o peso, as medidas e o valor do pacote. Só
            isso: nem seu nome, nem seu e-mail, nem o resto do endereço vão nessa consulta.
          </p>
          <p className="detalhe-nota">
            O mesmo CEP vai ao{' '}
            <a href="https://viacep.com.br" target="_blank" rel="noopener noreferrer">
              ViaCEP
            </a>
            , um serviço público e gratuito, para preencher rua, bairro e cidade por você. Vai só o
            CEP, e volta só o endereço da rua.
          </p>
          <p className="detalhe-nota">
            O Melhor Envio calcula o frete dos Correios para nós, e vale a{' '}
            <a href="https://lwsa.tech/politicas/" target="_blank" rel="noopener noreferrer">
              política de privacidade deles
            </a>
            . Quando o pedido é enviado, os Correios recebem o endereço completo, porque sem ele o
            pacote não chega.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Concierge</h2>
          <p className="detalhe-nota">
            O concierge da home responde com o Gemini, a inteligência artificial do Google. Cada
            pergunta que você escreve no chat vai do nosso servidor para o Google, junto com as
            últimas mensagens da conversa (até oito), para a resposta fazer sentido. Fora o que você
            mesmo escrever, nada seu vai junto: nem a sua conta, nem o seu endereço IP — quem fala
            com o Google é o servidor do site.
          </p>
          <p className="detalhe-nota">
            O site <strong>não guarda a conversa</strong>: ela existe só na página aberta e some
            quando você fecha ou recarrega a aba. Se uma resposta falhar, o registro do erro diz o
            motivo, nunca o que foi escrito.
          </p>
          <p className="detalhe-nota">
            No Google, valem os{' '}
            <a
              href="https://ai.google.dev/gemini-api/terms"
              target="_blank"
              rel="noopener noreferrer"
            >
              termos da API Gemini
            </a>{' '}
            e a{' '}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              política de privacidade deles
            </a>
            , que podem permitir ao Google usar o texto para melhorar os serviços dele. Por isso,{' '}
            <strong>não escreva no chat dado pessoal</strong>: nome completo, endereço, CPF, e-mail.
            Dúvida sobre um pedido seu vai por <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Cookies e o que fica no seu navegador</h2>
          <p className="detalhe-nota">
            Os cookies do próprio site são estes, e todos existem para o site funcionar. Nenhum é de
            publicidade, e nenhum pode ser lido por script da página.
          </p>
          <p className="detalhe-nota">
            <strong>Sessão</strong> (sb-…-auth-token): mantém você conectado. Com “Manter conectado”
            desmarcado, some quando você fecha o navegador.
          </p>
          <p className="detalhe-nota">
            <strong>Manter conectado</strong> (par_lembrar): guarda a sua escolha. Vale 30 dias
            quando marcado; desmarcado, some com o navegador.
          </p>
          <p className="detalhe-nota">
            <strong>Link do e-mail</strong> (sb-…-code-verifier): quando o site manda um link para o
            seu e-mail, este cookie ajuda a conferir que o link voltou ao navegador que o pediu.
            Vale uma hora.
          </p>
          <p className="detalhe-nota">
            <strong>Recuperar a senha</strong> (par_recuperacao): marca, por meia hora, que você
            entrou pelo link de recuperação. Só com ele dá para escolher uma senha nova sem digitar
            a atual.
          </p>
          <p className="detalhe-nota">
            <strong>Convite</strong> (par_convite): lembra, por 30 dias, que este navegador acertou
            o código de convite. Não tem nada seu: só a validade e uma assinatura.
          </p>
          <p className="detalhe-nota">
            Fora dos cookies, o <strong>CEP</strong> que você digita na ficha da camiseta fica
            guardado neste navegador (par_cep, no armazenamento local), para o checkout já começar
            com ele. Guardar não o manda a lugar nenhum: ele só sai daqui para calcular o frete e
            preencher o endereço, como está acima. Num computador compartilhado, apague o CEP do
            campo, e ele sai do navegador junto.
          </p>
          <p className="detalhe-nota">
            Para apagar tudo, limpe os dados deste site nas configurações do navegador. Você sai da
            conta e o convite volta a ser pedido. Na tela de pagamento, o que o Mercado Pago grava
            no seu navegador segue a política deles, citada acima.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Onde o site roda</h2>
          <p className="detalhe-nota">
            O site roda na Vercel, e a conta e os pedidos ficam guardados no Supabase, num servidor
            em São Paulo.
          </p>
          <p className="detalhe-nota">
            A Vercel também conta as visitas e mede a velocidade das páginas (Vercel Analytics e
            Speed Insights), <strong>sem cookie e sem identificar você</strong>: o que chega para
            nós são números somados.
          </p>
          <p className="detalhe-nota">
            Quando algo quebra, o relatório do erro vai para o Sentry, para a gente consertar: a
            mensagem do erro, a página e o tipo de navegador. Ficam de fora os cookies, o que você
            digita nos formulários e quem você é.
          </p>
          <p className="detalhe-nota">
            Os e-mails da conta — confirmação de cadastro, código de confirmação, senha nova, troca
            de e-mail e os avisos de segurança — saem pelo <strong>Mailjet</strong>. Para entregar,
            ele recebe o seu endereço de e-mail e o texto da mensagem.
          </p>
          <p className="detalhe-nota">
            O <strong>Upstash</strong> guarda a contagem de envios de Proteção contra robôs: o
            endereço IP e, nos formulários de conta, o e-mail, por cerca de duas horas no máximo.
          </p>
          <p className="detalhe-nota">
            Valem as políticas de privacidade da{' '}
            <a
              href="https://vercel.com/legal/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Vercel
            </a>
            , do{' '}
            <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">
              Supabase
            </a>
            , do{' '}
            <a href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer">
              Sentry
            </a>
            , do{' '}
            <a
              href="https://www.mailjet.com/legal/privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Mailjet
            </a>{' '}
            e do{' '}
            <a
              href="https://upstash.com/trust/privacy.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              Upstash
            </a>
            .
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>O que não fazemos</h2>
          <p className="detalhe-nota">
            Não vendemos nem cedemos seus dados. Não usamos rastreador de publicidade. Não guardamos
            senha em texto: só um hash, que não volta a ser a senha.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Por quanto tempo</h2>
          <p className="detalhe-nota">
            Enquanto sua conta existir. Se você apagar a conta, seus pedidos ficam registrados para
            fins fiscais, mas <strong>desvinculados de você</strong>: nome e endereço de entrega são
            apagados do pedido no mesmo instante.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Seus direitos</h2>
          <p className="detalhe-nota">
            Pela LGPD você pode pedir para ver, corrigir ou apagar seus dados, e saber com quem eles
            foram compartilhados. Nome e foto você mesmo edita em <a href="/conta">Conta</a>; o
            resto, é só pedir por <a href={`mailto:${CONTATO}`}>{CONTATO}</a>, e respondemos.
          </p>
        </section>
      </section>
    </main>
  );
}
