'use client';

import { useState } from 'react';
import AvisoFlutuante from './AvisoFlutuante';
import CriarSenha from './CriarSenha';
import TrocarSenha from './TrocarSenha';

type Recado = { tom: 'ok' | 'erro'; texto: string };

/**
 * O bloco de senha de Seguranca: "Criar senha" para a conta que entrou so
 * pelo codigo (#389), "Trocar senha" para as outras.
 *
 * `semSenha` vem do servidor, lido da marca em `app_metadata`. Criada a
 * senha, a acao redesenha a pagina e `semSenha` chega falso; ate la a troca
 * acontece aqui, na hora. O aviso de "senha criada" mora neste componente, e
 * nao no de criar: este continua montado quando aquele sai da tela.
 */
export default function Senha({ semSenha }: { semSenha: boolean }) {
  const [criada, setCriada] = useState<Recado | null>(null);
  const criar = semSenha && !criada;

  return (
    <>
      <p className="auth-sub">{criar ? 'Criar senha' : 'Trocar senha'}</p>
      {criar ? <CriarSenha aoCriar={setCriada} /> : <TrocarSenha />}
      <AvisoFlutuante recado={criada} id="aviso-da-senha-criada" />
    </>
  );
}
