'use client';

import { useActionState } from 'react';
import AvisoFlutuante from './AvisoFlutuante';
import CriarSenha from './CriarSenha';
import { criarSenha } from './criar-senha';
import { criarSenhaInicial } from './estado-criar-senha';
import TrocarSenha from './TrocarSenha';

/**
 * O bloco de senha de Seguranca: "Criar senha" para a conta que entrou so
 * pelo codigo (#389), "Trocar senha" para as outras.
 *
 * `semSenha` vem do servidor, lido da marca em `app_metadata`. O estado da
 * criacao mora aqui, e nao em `CriarSenha`: a acao grava cookie e redesenha a
 * pagina, e a resposta chega no mesmo quadro em que `semSenha` vira falso.
 * `CriarSenha` sai da tela nesse quadro, antes de qualquer efeito dela rodar;
 * este componente continua montado e mostra o aviso de "senha criada".
 */
export default function Senha({ semSenha }: { semSenha: boolean }) {
  const [estado, cria, criando] = useActionState(criarSenha, criarSenhaInicial);
  const criar = semSenha && !estado.criada;

  return (
    <>
      <p className="auth-sub">{criar ? 'Criar senha' : 'Trocar senha'}</p>
      {criar ? <CriarSenha estado={estado} cria={cria} criando={criando} /> : <TrocarSenha />}
      <AvisoFlutuante recado={estado.criada ? estado.recado : null} id="aviso-da-senha-criada" />
    </>
  );
}
