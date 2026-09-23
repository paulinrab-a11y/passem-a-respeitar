/**
 * Leitura de user-agent. Fica fora de `server-only` so por ser pura e
 * testavel; quem chama e o servidor.
 *
 * Sem biblioteca de propósito. As de mercado carregam centenas de regras para
 * distinguir navegador de robo de TV; aqui a pergunta e outra e bem mais
 * simples: "isto aqui e o aparelho que eu estou usando agora, ou outro?". Um
 * nome aproximado responde isso, e um errado nao causa dano — a pessoa olha a
 * data e a rede tambem.
 */

type Aparelho = { navegador: string; sistema: string };

const NAVEGADORES: [RegExp, string][] = [
  // Ordem importa: Edge e Opera anunciam "Chrome" no proprio user-agent, e
  // Chrome anuncia "Safari". Quem testar Chrome antes marca todo mundo errado.
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SISTEMAS: [RegExp, string][] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bWindows NT\b/, 'Windows'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

export function leAparelho(agente: string | null): Aparelho {
  if (!agente) return { navegador: 'Desconhecido', sistema: '' };

  const navegador = NAVEGADORES.find(([r]) => r.test(agente))?.[1] ?? 'Desconhecido';
  const sistema = SISTEMAS.find(([r]) => r.test(agente))?.[1] ?? '';

  return { navegador, sistema };
}

/** `189.6.0.0` vira `189.6.x.x` — o banco ja zerou o resto. */
export function redeLegivel(rede: string | null): string | null {
  if (!rede) return null;

  if (rede.includes(':')) return `${rede.split(':').slice(0, 2).join(':')}:…`;

  const partes = rede.split('.');
  if (partes.length !== 4) return null;
  return `${partes[0]}.${partes[1]}.x.x`;
}

export type Sessao = {
  identificador: string;
  navegador: string;
  sistema: string;
  rede: string | null;
  ultimoAcesso: string;
  atual: boolean;
};

type LinhaDoBanco = {
  identificador: string;
  ultimo_acesso: string;
  agente: string | null;
  rede: string | null;
  e_a_atual: boolean;
};

/**
 * Mapper explicito (#20). `criada_em` vem da funcao e e descartado aqui: a
 * tela mostra o ultimo acesso, e dois campos de data lado a lado so confundem.
 */
export function mapeiaSessoes(linhas: LinhaDoBanco[]): Sessao[] {
  return linhas.map((l) => {
    const { navegador, sistema } = leAparelho(l.agente);
    return {
      identificador: l.identificador,
      navegador,
      sistema,
      rede: redeLegivel(l.rede),
      ultimoAcesso: l.ultimo_acesso,
      atual: l.e_a_atual,
    };
  });
}
