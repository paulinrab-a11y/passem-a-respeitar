'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useCampos } from '@/app/_ui/campos';
import Mensagem from '@/app/_ui/Mensagem';
import Rotulo from '@/app/_ui/Rotulo';
import { reais } from '@/lib/conta/pedidos';
import type { OpcaoDeFrete, Servico } from '@/lib/loja/frete';
import { cotarFrete, finalizarCompra, type RespostaDoFrete } from './acoes';
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
  const { campo: controle, valores } = useCampos(VAZIOS);

  const [frete, setFrete] = useState<Frete>({ cep: '', resposta: null });
  const [escolhido, setEscolhido] = useState<Servico | null>(null);
  const [cotando, comecaCotacao] = useTransition();

  // O CEP completo, so digitos. Cotar a cada tecla seria gastar consulta com
  // CEP pela metade; cotar so no fim do campo faria a pessoa sair dele para
  // ver o preco.
  const cep = valores.cep.replace(/\D/g, '');
  const completo = cep.length === 8;

  useEffect(() => {
    if (!completo || cep === frete.cep) return;

    // Guardado antes da chamada: a resposta de um CEP velho, chegando depois
    // da de um novo, nao pode tomar o lugar dela.
    setFrete({ cep, resposta: null });
    comecaCotacao(async () => {
      const resposta = await cotarFrete({ slug, tamanho, quantidade, cep });
      setFrete((atual) => (atual.cep === cep ? { cep, resposta } : atual));
    });
  }, [cep, completo, frete.cep, slug, tamanho, quantidade]);

  // O que vale agora e a cotacao do CEP que esta no campo. Apagar um digito
  // tira o frete da tela: preco de outro CEP nao pode ficar parecendo deste.
  const atual = completo && frete.cep === cep ? frete.resposta : null;
  const opcoes = atual?.ok ? atual.opcoes : [];

  // A escolha sobrevive a troca de CEP quando o servico continua existindo.
  // Quando nao, vale o mais barato: e o primeiro da lista.
  const servico = opcoes.find((o) => o.servico === escolhido)?.servico ?? opcoes[0]?.servico;
  const opcao = opcoes.find((o) => o.servico === servico);
  const total = opcao ? subtotalCentavos + opcao.precoCentavos : null;
  const calculando = cotando || (completo && frete.cep === cep && frete.resposta === null);

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
              aria-invalid={estado.campo === campo.nome || undefined}
            />
          </label>
        ))}
      </div>

      <fieldset className="frete" aria-busy={cotando || undefined}>
        <legend>Frete</legend>
        <Opcoes
          cep={cep}
          completo={completo}
          cotando={calculando}
          resposta={atual}
          servico={servico}
          escolhe={setEscolhido}
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

      <Mensagem
        texto={estado.recado?.texto}
        chave={estado.recado?.texto ?? ''}
        classe={`conta-recado ${estado.recado?.tom ?? 'erro'}`}
        papel="alert"
      />

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
  bloqueado,
  invalido,
}: {
  cep: string;
  completo: boolean;
  cotando: boolean;
  resposta: RespostaDoFrete | null;
  servico: Servico | undefined;
  escolhe: (s: Servico) => void;
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
            aria-invalid={invalido || undefined}
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
