'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useCampos } from '@/app/_ui/campos';
import Rotulo from '@/app/_ui/Rotulo';
import { finalizarCompra } from './acoes';
import { checkoutInicial } from './estado';

/**
 * Formulario de entrega (Issue #106).
 *
 * O unico Client Component do checkout. O resumo, o preco e o total sao
 * servidos prontos pelo servidor — aqui so mora o que precisa de interacao:
 * digitar, receber erro e nao deixar clicar duas vezes.
 *
 * Os campos ocultos carregam a ESCOLHA (slug, tamanho, quantidade), nunca o
 * preco. Adulterar um deles no DevTools muda o que se compra; quanto custa
 * continua vindo do catalogo, dentro da `criaPedido`.
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

export default function Entrega({
  slug,
  tamanho,
  quantidade,
  total,
}: {
  slug: string;
  tamanho: string | null;
  quantidade: number;
  total: string;
}) {
  const [estado, acao, emVoo] = useActionState(finalizarCompra, checkoutInicial);
  // Continua "pendente" enquanto o navegador troca de pagina: soltar o botao
  // entre a resposta e a navegacao e convidar para o segundo clique.
  const pendente = emVoo || Boolean(estado.irPara);
  const form = useRef<HTMLFormElement>(null);
  const { campo: controle } = useCampos(VAZIOS);

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
              maxLength={campo.nome === 'uf' ? 2 : undefined}
              aria-invalid={estado.campo === campo.nome || undefined}
            />
          </label>
        ))}
      </div>

      {estado.recado ? (
        <p className={`conta-recado ${estado.recado.tom}`} role="alert">
          {estado.recado.texto}
        </p>
      ) : null}

      {/* `disabled` enquanto pendente e o que impede o clique duplo virar dois
          pedidos. O React tambem ignora submit de form ja em acao, mas
          desabilitar diz isso para quem esta olhando. */}
      <button
        type="submit"
        className={`btn cheio auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        <Rotulo parado={`Finalizar — ${total}`} agindo="Criando pedido…" ativo={pendente} />
      </button>

      <p className="entrega-nota">O pagamento vem na próxima tela. Nada é cobrado agora.</p>
    </form>
  );
}
