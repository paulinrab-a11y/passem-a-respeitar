import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  COOKIE_CONVITE,
  codigoConfere,
  cookieValido,
  criaCookie,
  teaserEmbed,
} from '@/lib/convite';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, desafioConfere, pareceRobo, RECUSA } from '@/lib/robo';

// Le cookie e variavel de ambiente por request: nada aqui pode ser cacheado.
export const dynamic = 'force-dynamic';

/** 8 tentativas a cada 10 minutos por IP. */
const MAXIMO = 8;
const JANELA_MS = 10 * 60 * 1000;

/**
 * Mensagem unica para codigo errado, codigo ausente e formato invalido.
 * Qualquer diferenca vira oraculo: o atacante aprende o formato do codigo
 * so de ler a resposta.
 */
const ERRO_GENERICO = 'Esse código não abre nada aqui.';

export async function POST(request: Request) {
  const ip = ipDoRequest(request.headers);
  const cota = await limita(`convite:${ip}`, MAXIMO, JANELA_MS);

  if (!cota.permitido) {
    return NextResponse.json(
      { ok: false, erro: 'Muitas tentativas. Espera um pouco.' },
      { status: 429, headers: { 'Retry-After': String(cota.esperarS) } }
    );
  }

  let corpo: { codigo?: unknown; desafio?: unknown; [CAMPO_DA_ISCA]?: unknown };
  try {
    corpo = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ ok: false, erro: ERRO_GENERICO }, { status: 400 });
  }

  // Protecao contra bot (#28), antes de olhar o codigo: a resposta fala do
  // envio, e nao conta nada sobre o que foi digitado.
  const { codigo, desafio } = corpo;
  if (
    (await pareceRobo({ isca: corpo[CAMPO_DA_ISCA], desafio })) ||
    !(await desafioConfere(desafio, 'convite', ip))
  ) {
    return NextResponse.json({ ok: false, erro: RECUSA }, { status: 403 });
  }

  // Validacao de formato antes de hashear. Nao aceita o que nao tem cara de
  // codigo, e limita o tamanho para nao hashear payload gigante.
  if (typeof codigo !== 'string' || codigo.length === 0 || codigo.length > 32) {
    return NextResponse.json({ ok: false, erro: ERRO_GENERICO }, { status: 401 });
  }

  const normalizado = codigo.trim().toUpperCase();

  if (!(await codigoConfere(normalizado))) {
    return NextResponse.json({ ok: false, erro: ERRO_GENERICO }, { status: 401 });
  }

  const cookie = await criaCookie();

  const resposta = NextResponse.json({ ok: true, teaser: teaserEmbed() });

  if (cookie) {
    resposta.cookies.set(COOKIE_CONVITE, cookie.valor, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: cookie.maxAge,
    });
  }

  return resposta;
}

/**
 * Quem ja acertou o codigo carrega o cookie assinado e recebe o conteudo
 * protegido de volta sem digitar nada. E aqui que o cookie ganha sentido: o
 * acesso e decidido pela assinatura no servidor, nao por estado do cliente.
 */
export async function GET() {
  const cookie = (await cookies()).get(COOKIE_CONVITE)?.value;

  if (!(await cookieValido(cookie))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true, teaser: teaserEmbed() });
}
