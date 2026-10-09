'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useCepLembrado } from '@/app/_home/cep-lembrado';
import { comErro, useCampos } from '@/app/_ui/campos';
import Mensagem from '@/app/_ui/Mensagem';
import Rotulo from '@/app/_ui/Rotulo';
import { reais } from '@/lib/conta/pedidos';
import { cepLegivel } from '@/lib/loja/endereco';
import type { OpcaoDeFrete, Servico } from '@/lib/loja/frete';
import { RECADOS_DO_FRETE } from '@/lib/loja/recados-do-frete';
import { buscarEndereco, cotarFrete, finalizarCompra, type RespostaDoFrete } from './acoes';
import { checkoutInicial } from './estado';

/**
 * Formulario de entrega (Issue #106), com o frete (#199).
 *
 * O unico Client Component do checkout. O resumo e o preco dos produtos sao
 * servidos prontos pelo servidor — aqui so mora o que precisa de interacao:
 * digitar, ver o frete do CEP, escolher PAC ou SEDEX, receber erro e nao
 * deixar clicar duas vezes.
 *
 * Os campos ocultos carregam a ESCOLHA (slug, tamanho, quantidade), nunca o
 * preco. O frete segue a mesma regra: o que vai no formulario e o servico
 * escolhido. O preco que aparece aqui e para a pessoa decidir; o que entra no
 * total e cotado de novo pelo servidor, ao criar o pedido.
 */

const CAMPOS = [
  { nome: 'nome', rotulo: 'Quem recebe', auto: 'name', largura: 'inteiro' },
  { nome: 'cep', rotulo: 'CEP', auto: 'postal-code', largura: 'terco', modo: 'numeric' },
  { nome: 'logradouro', rotulo: 'Rua', auto: 'address-line1', largura: 'dois-tercos' },
  { nome: 'numero', rotulo: 'Número', auto: 'address-line2', largura: 'terco' },
  { nome: 'complemento', rotulo: 'Complemento', auto: 'address-line3', largura: 'dois-tercos' },
  { nome: 'bairro', rotulo: 'Bairro', auto: 'address-level3', largura: 'inteiro' },
  { nome: 'cidade', rotulo: 'Cidade', auto: 'address-level2', largura: 'dois-tercos' },
  { nome: 'uf', rotulo: 'UF', auto: 'address-level1', largura: 'terco' },
] as const;

/** Só o complemento é opcional — os outros sete o banco exige. */
const OPCIONAIS = new Set(['complemento']);

/**
 * O recado do servidor. O campo que errou aponta para ele (#47): sem a
 * ligacao, o leitor de tela diz "invalido" e nao diz por que.
 */
const ID_DO_ERRO = 'erro-entrega';

/**
 * Os oito comecam vazios e ficam no cliente. Controlados porque o React 19
 * apagaria todos quando a acao respondesse com erro: errar o CEP virava
 * redigitar o endereco inteiro (#130).
 */
const VAZIOS = {
  nome: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
};

/** O frete de um CEP: ainda nao pedido, a caminho, ou a resposta. */
type Frete = { cep: string; resposta: RespostaDoFrete | null };

/** Nenhum CEP cotado: o comeco, e o "cota de novo" (#240). */
const NENHUM: Frete = { cep: '', resposta: null };

/**
 * A chamada que nem chegou a responder: rede que caiu, deploy no meio, 5xx da
 * funcao. Para a pessoa e o mesmo "fora do ar" que o servidor devolve quando o
 * Melhor Envio nao responde — e passa, entao vale tentar de novo.
 */
const SEM_RESPOSTA: RespostaDoFrete = {
  ok: false,
  texto: RECADOS_DO_FRETE['frete-fora-do-ar'],
  transitorio: true,
};

export default function Entrega({
  slug,
  tamanho,
  quantidade,
  subtotalCentavos,
}: {
  slug: string;
  tamanho: string | null;
  quantidade: number;
  subtotalCentavos: number;
}) {
  const [estado, acao, emVoo] = useActionState(finalizarCompra, checkoutInicial);
  // Continua "pendente" enquanto o navegador troca de pagina: soltar o botao
  // entre a resposta e a navegacao e convidar para o segundo clique.
  const pendente = emVoo || Boolean(estado.irPara);
  const form = useRef<HTMLFormElement>(null);
  const { campo: controle, valores, preencher } = useCampos(VAZIOS);

  // O CEP que a pessoa digitou na ficha da camiseta (#205) ja vem preenchido,
  // e com ele vem o frete e o endereco. Uma vez so, na chegada: depois o
  // campo e dela.
  const lembrado = useCepLembrado();
  const [lembradoAplicado, setLembradoAplicado] = useState(false);
  useEffect(() => {
    if (lembradoAplicado || !lembrado) return;
    setLembradoAplicado(true);
    preencher({ cep: cepLegivel(lembrado) });
  }, [lembrado, lembradoAplicado, preencher]);

  const [frete, setFrete] = useState<Frete>(NENHUM);
  const [escolhido, setEscolhido] = useState<Servico | null>(null);

  // O CEP completo, so digitos. Cotar a cada tecla seria gastar consulta com
  // CEP pela metade; cotar so no fim do campo faria a pessoa sair dele para
  // ver o preco.
  const cep = valores.cep.replace(/\D/g, '');
  const completo = cep.length === 8;

  // O ultimo CEP para o qual o endereco foi pedido. Em ref: nao e tela, e
  // um "ja pedi este".
  const enderecoPedido = useRef('');

  useEffect(() => {
    if (!completo || cep === frete.cep) return;

    // Guardado antes da chamada: a resposta de um CEP velho, chegando depois
    // da de um novo, nao pode tomar o lugar dela.
    setFrete({ cep, resposta: null });
    // Sem `useTransition`: o pendente dele valia para QUALQUER cotacao no ar,
    // e a do CEP errado, lenta, segurava o esqueleto depois de a do CEP certo
    // ja ter chegado (#31). Quem diz "calculando" e a resposta do CEP atual
    // ainda nao ter vindo. E a chamada que rejeita — rede, 5xx, deploy no
    // meio — vira uma resposta como as outras: dentro da transition, ela
    // derrubava o checkout inteiro no global-error, com o endereco digitado
    // junto (#27).
    cotarFrete({ slug, tamanho, quantidade, cep })
      .catch(() => SEM_RESPOSTA)
      .then((resposta) => setFrete((atual) => (atual.cep === cep ? { cep, resposta } : atual)));
  }, [cep, completo, frete.cep, slug, tamanho, quantidade]);

  // Falha passageira nao e resposta do CEP. Enquanto ele esta no campo, ela
  // fica — cotar de novo sozinho seria o loop. Quando o CEP sai do campo, ela
  // sai junto, e o mesmo CEP de volta cota de novo: antes, apagar e redigitar
  // o ultimo digito nao fazia nada (#28). A recusa definitiva — CEP que nao
  // existe, trecho sem servico — fica, como fica o sucesso.
  useEffect(() => {
    if (completo || !frete.resposta || frete.resposta.ok || !frete.resposta.transitorio) return;
    setFrete(NENHUM);
  }, [completo, frete.resposta]);

  /** O botao da falha passageira: esquecer a resposta e o efeito cota de novo. */
  const tentaDeNovo = () => setFrete(NENHUM);

  // Rua, bairro, cidade e UF pelo CEP (#204), junto com o frete. A resposta
  // so entra se o CEP no campo ainda for o mesmo: trocar o CEP no meio da
  // busca nao pode encher o formulario com o endereco do CEP anterior. E so
  // o que veio preenchido entra: CEP geral de cidade pequena vem sem rua, e
  // apagar o que a pessoa escreveu para por nada seria pior que nao ajudar.
  useEffect(() => {
    if (!completo || cep === enderecoPedido.current) return;
    enderecoPedido.current = cep;

    let vale = true;
    // A busca que rejeita (rede) e a que volta `null`: a pessoa digita.
    buscarEndereco(cep)
      .catch(() => null)
      .then((endereco) => {
        if (!vale || !endereco) return;
        const parcial: Partial<typeof VAZIOS> = {};
        if (endereco.logradouro) parcial.logradouro = endereco.logradouro;
        if (endereco.bairro) parcial.bairro = endereco.bairro;
        if (endereco.cidade) parcial.cidade = endereco.cidade;
        if (endereco.uf) parcial.uf = endereco.uf;
        preencher(parcial);

        // A pessoa estava no CEP e o resto se preencheu: o proximo campo que
        // falta e o numero. So se ela ainda estiver no CEP — se ja foi para
        // outro lugar, roubar o foco e pior que ajudar.
        const campoDoCep = form.current?.elements.namedItem('cep');
        const numero = form.current?.elements.namedItem('numero');
        if (document.activeElement === campoDoCep && numero instanceof HTMLInputElement) {
          numero.focus();
        }
      });
    return () => {
      vale = false;
    };
  }, [cep, completo, preencher]);

  // O que vale agora e a cotacao do CEP que esta no campo. Apagar um digito
  // tira o frete da tela: preco de outro CEP nao pode ficar parecendo deste.
  const atual = completo && frete.cep === cep ? frete.resposta : null;
  const opcoes = atual?.ok ? atual.opcoes : [];

  // A escolha sobrevive a troca de CEP quando o servico continua existindo.
  // Quando nao, vale o mais barato: e o primeiro da lista.
  const servico = opcoes.find((o) => o.servico === escolhido)?.servico ?? opcoes[0]?.servico;
  const opcao = opcoes.find((o) => o.servico === servico);
  const total = opcao ? subtotalCentavos + opcao.precoCentavos : null;
  // "Calculando" e CEP completo sem a resposta DELE: antes de a chamada sair
  // e enquanto ela nao volta. Nao e o pendente de uma transition, que valia
  // para qualquer chamada no ar (#31).
  const calculando = completo && (frete.cep !== cep || frete.resposta === null);

  // O botao diz por que nao da para finalizar, sem repetir a mensagem de
  // cima: falta CEP, o frete esta a caminho, ou nao ha frete para este CEP.
  // Sem reticencias: quem esta trabalhando e a caixa do frete, nao o botao.
  // As reticencias sao do `agindo` do Rotulo, quando o botao age. O botao
  // ocupa a largura do formulario, e trocar o texto nao muda a largura dele.
  const parado =
    total !== null
      ? `Finalizar — ${reais(total)}`
      : !completo
        ? 'Informe o CEP'
        : calculando
          ? 'Aguardando o frete'
          : 'Frete indisponível';

  // Sucesso: navegacao COMPLETA, nao `router.push`. A tela de pagamento tem
  // CSP propria (hosts do Mercado Pago) e so a recebe como documento novo;
  // numa navegacao suave o Brick nasceria sob a CSP do /checkout e nao
  // montaria. (#118)
  useEffect(() => {
    if (estado.irPara) window.location.assign(estado.irPara);
  }, [estado.irPara]);

  // Foco no campo que errou. Sem isto a pessoa recebe "confira os dados" e
  // tem que caçar qual dos oito esta errado.
  useEffect(() => {
    if (!estado.campo) return;
    const alvo = form.current?.elements.namedItem(estado.campo);
    if (alvo instanceof HTMLInputElement) alvo.focus();
    // O servico e um grupo de radios: o foco vai para o primeiro.
    if (alvo instanceof RadioNodeList) (alvo[0] as HTMLInputElement | undefined)?.focus();
  }, [estado.campo]);

  return (
    <form action={acao} ref={form} className="entrega">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="tamanho" value={tamanho ?? ''} />
      <input type="hidden" name="quantidade" value={quantidade} />

      <div className="entrega-campos">
        {CAMPOS.map((campo) => (
          <label key={campo.nome} className={`auth-campo campo-${campo.largura}`}>
            <span>{campo.rotulo}</span>
            <input
              {...controle(campo.nome)}
              type="text"
              autoComplete={campo.auto}
              required={!OPCIONAIS.has(campo.nome)}
              disabled={pendente}
              inputMode={'modo' in campo ? campo.modo : undefined}
              maxLength={campo.nome === 'uf' ? 2 : campo.nome === 'cep' ? 9 : undefined}
              {...comErro(estado.campo === campo.nome, ID_DO_ERRO)}
            />
          </label>
        ))}
      </div>

      <fieldset className="frete" aria-busy={calculando || undefined}>
        <legend>Frete</legend>
        <Opcoes
          cep={cep}
          completo={completo}
          cotando={calculando}
          resposta={atual}
          servico={servico}
          escolhe={setEscolhido}
          tentaDeNovo={tentaDeNovo}
          bloqueado={pendente}
          invalido={estado.campo === 'servico'}
        />
        {/* #197: a camiseta e fabricada depois do pedido. O prazo dos
            Correios comeca a contar dali. */}
        <p className="frete-nota">O transporte começa depois da produção, de pelo menos 30 dias.</p>
      </fieldset>

      <dl className="resumo">
        <div>
          <dt>Frete</dt>
          <dd>{opcao ? `${opcao.nome} · ${reais(opcao.precoCentavos)}` : '—'}</dd>
        </div>
        <div className="resumo-total">
          <dt>Total</dt>
          <dd>{reais(total ?? subtotalCentavos)}</dd>
        </div>
      </dl>

      {/* Lugar reservado (#47), como nos formularios da conta (#51). Antes o
          recado so existia com erro: entrava entre o total e o botao e
          empurrava o Finalizar no instante em que a pessoa ia clicar. Com o
          lugar fixo, o erro do envio anterior pode sair ja no reenvio. */}
      <div className="erro-vaga">
        <Mensagem
          id={ID_DO_ERRO}
          texto={estado.recado?.texto}
          chave={estado.recado?.texto ?? ''}
          classe={`conta-recado ${estado.recado?.tom ?? 'erro'}`}
          papel="alert"
          enviando={pendente}
        />
      </div>

      {/* `disabled` enquanto pendente e o que impede o clique duplo virar dois
          pedidos. Sem frete escolhido nao ha total, e sem total nao ha o que
          finalizar. */}
      <button
        type="submit"
        className={`btn cheio auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente || !opcao}
      >
        <Rotulo parado={parado} agindo="Criando pedido…" ativo={pendente} />
      </button>

      <p className="entrega-nota">O pagamento vem na próxima tela. Nada é cobrado agora.</p>
    </form>
  );
}

/**
 * O conteudo da caixa do frete. A caixa tem a altura de duas opcoes em todos
 * os estados — vazia, calculando, com erro ou com as opcoes —, entao nada
 * abaixo dela anda quando a cotacao chega.
 */
function Opcoes({
  cep,
  completo,
  cotando,
  resposta,
  servico,
  escolhe,
  tentaDeNovo,
  bloqueado,
  invalido,
}: {
  cep: string;
  completo: boolean;
  cotando: boolean;
  resposta: RespostaDoFrete | null;
  servico: Servico | undefined;
  escolhe: (s: Servico) => void;
  tentaDeNovo: () => void;
  bloqueado: boolean;
  invalido: boolean;
}) {
  if (!completo) {
    return <p className="frete-vazio">Digite o CEP para ver o preço do PAC e do SEDEX.</p>;
  }

  if (cotando || !resposta) {
    return (
      <div className="frete-opcoes" aria-hidden="true">
        {[0, 1].map((i) => (
          // A mesma grade da opcao de verdade, peca por peca: o lugar do radio,
          // o nome, o prazo e o preco. Com outra estrutura a altura muda, e o
          // botao anda quando a cotacao chega. Medido na #199.
          <div key={i} className="frete-opcao frete-esqueleto">
            <span className="esq-radio" />
            <span className="frete-nome">
              <span className="esq-linha">SEDEX</span>
            </span>
            <span className="frete-prazo">
              <span className="esq-linha">até 00 dias úteis</span>
            </span>
            <span className="frete-preco">
              <span className="esq-linha">R$ 00,00</span>
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (!resposta.ok) {
    return (
      <div className="frete-erro">
        <Mensagem texto={resposta.texto} chave={resposta.texto} classe="auth-erro" papel="alert" />
        {/* So quando a falha passa sozinha. Para CEP que nao existe o botao
            prometeria o que nao vem: o que resolve e corrigir o CEP. O clique
            troca a caixa pelo esqueleto — esse e o "carregando" dele. */}
        {resposta.transitorio && (
          <button
            type="button"
            className="auth-link frete-tentar"
            onClick={tentaDeNovo}
            disabled={bloqueado}
          >
            Tentar de novo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="frete-opcoes" role="radiogroup" aria-label="Tipo de envio">
      {resposta.opcoes.map((o: OpcaoDeFrete) => (
        // A chave leva o CEP: as opcoes de outro CEP sao radios novos, e nao
        // herdam a marcacao dos de antes.
        <label key={`${cep}-${o.servico}`} className="frete-opcao">
          {/* `defaultChecked`, e nao `checked`: o React 19 reseta o
              formulario quando a acao responde, e o reset devolve o radio ao
              padrao do DOM. Com o padrao igual ao estado, o reset nao desmarca
              nada — o mesmo caminho da caixinha, em app/_ui/campos.ts. */}
          <input
            type="radio"
            name="servico"
            value={o.servico}
            defaultChecked={servico === o.servico}
            onChange={() => escolhe(o.servico)}
            disabled={bloqueado}
            {...comErro(invalido, ID_DO_ERRO)}
          />
          <span className="frete-nome">{o.nome}</span>
          <span className="frete-prazo">
            até {o.prazoDias} {o.prazoDias === 1 ? 'dia útil' : 'dias úteis'}
          </span>
          <span className="frete-preco">{reais(o.precoCentavos)}</span>
        </label>
      ))}
    </div>
  );
}
