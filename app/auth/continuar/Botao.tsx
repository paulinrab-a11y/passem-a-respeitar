'use client';

import { useFormStatus } from 'react-dom';
import Rotulo from '@/app/_ui/Rotulo';

/** O botao do link (#348), com o estado de envio que todo botao do site tem. */
export default function Botao({ texto }: { texto: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={`btn auth-enviar${pending ? ' carregando' : ''}`}
      disabled={pending}
    >
      <Rotulo parado={texto} agindo="Conferindo…" ativo={pending} />
    </button>
  );
}
