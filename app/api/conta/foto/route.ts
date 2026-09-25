import { NextResponse } from 'next/server';
import { caminhoDaFoto, normalizaFoto, TAMANHO_MAX, validaFoto } from '@/lib/conta/foto';
import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

// Le cookie e fala com o storage: nada cacheavel.
export const dynamic = 'force-dynamic';
// sharp e binario nativo: precisa do runtime Node, nao do edge.
export const runtime = 'nodejs';

/**
 * Upload da foto de perfil.
 *
 * E rota de API, e nao Server Action, por um motivo unico: a barra de
 * progresso. XHR no cliente da `upload.onprogress`; Server Action nao expoe
 * nada durante o envio, e um arquivo de 2 MB em rede ruim ficaria parado sem
 * sinal nenhum.
 *
 * A sessao continua sendo lida do cookie httpOnly aqui no servidor — o
 * navegador nao precisa (nem consegue) provar quem e.
 */

/** Generoso para quem erra a foto, apertado contra quem enche o storage. */
const MAXIMO = 10;
const JANELA_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const usuario = await usuarioDaSessao();
  if (!usuario) {
    return NextResponse.json({ ok: false, erro: 'Sessão expirada.' }, { status: 401 });
  }

  // Por usuario, e nao so por IP: quem ja esta logado nao precisa de botnet
  // para encher o bucket, basta um laco.
  const cota = await limita(`foto:${usuario.id}`, MAXIMO, JANELA_MS);
  if (!cota.permitido) {
    return NextResponse.json(
      { ok: false, erro: 'Muitas trocas de foto seguidas. Espere um pouco.' },
      { status: 429, headers: { 'Retry-After': String(cota.esperarS) } }
    );
  }

  // Corta antes de ler o corpo. Sem isso, um POST de 500 MB seria lido
  // inteiro na memoria so para ser recusado no fim.
  const declarado = Number(request.headers.get('content-length') ?? 0);
  if (declarado > TAMANHO_MAX * 1.1) {
    return NextResponse.json({ ok: false, erro: 'A imagem passa de 2 MB.' }, { status: 413 });
  }

  let arquivo: File | null = null;
  try {
    arquivo = (await request.formData()).get('foto') as File | null;
  } catch {
    return NextResponse.json({ ok: false, erro: 'Envio inválido.' }, { status: 400 });
  }

  if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
    return NextResponse.json({ ok: false, erro: 'Nenhuma imagem foi enviada.' }, { status: 400 });
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const veredito = validaFoto({ nome: arquivo.name, tamanho: bytes.byteLength, bytes });

  if (!veredito.ok) {
    return NextResponse.json({ ok: false, erro: veredito.motivo }, { status: 400 });
  }

  let normalizada: Buffer;
  try {
    normalizada = await normalizaFoto(bytes);
  } catch {
    // Passou pelos bytes magicos mas o decodificador recusou: arquivo
    // truncado, ou imagem montada para quebrar decodificador.
    return NextResponse.json({ ok: false, erro: 'Não consegui ler essa imagem.' }, { status: 400 });
  }

  const supabase = await clienteServidor();
  const caminho = caminhoDaFoto(usuario.id);

  const { error: erroUpload } = await supabase.storage
    .from('avatares')
    .upload(caminho, normalizada, { contentType: 'image/webp', upsert: false });

  if (erroUpload) {
    return NextResponse.json(
      { ok: false, erro: 'Não consegui guardar a imagem.' },
      { status: 502 }
    );
  }

  // O caminho antigo e lido antes de sobrescrever, para apagar o arquivo que
  // fica orfao. Sem isso o bucket cresce para sempre a cada troca de foto.
  const { data: antes } = await supabase
    .from('profiles')
    .select('foto_caminho')
    .eq('id', usuario.id)
    .maybeSingle();

  // Aqui, e so aqui, entra o client admin. `foto_caminho` esta fora do
  // `grant update (nome, telefone)` de proposito: quem decide o caminho e esta
  // rota, que acabou de ver o arquivo chegar no bucket, nao o navegador.
  //
  // O `eq('id', ...)` continua obrigatorio. O admin ignora RLS, entao o filtro
  // deixa de ser segunda barreira e passa a ser a unica: sem ele, um erro de
  // digitacao aqui reescreveria a tabela inteira.
  const { error: erroPerfil } = await clienteAdmin()
    .from('profiles')
    .update({ foto_caminho: caminho })
    .eq('id', usuario.id);

  if (erroPerfil) {
    // Nao deixa o arquivo sozinho no bucket sem ninguem apontando para ele.
    await supabase.storage.from('avatares').remove([caminho]);
    return NextResponse.json({ ok: false, erro: 'Não consegui salvar a foto.' }, { status: 500 });
  }

  if (antes?.foto_caminho && antes.foto_caminho !== caminho) {
    await supabase.storage.from('avatares').remove([antes.foto_caminho]);
  }

  const { data: assinada } = await supabase.storage
    .from('avatares')
    .createSignedUrl(caminho, 60 * 10);

  return NextResponse.json({ ok: true, url: assinada?.signedUrl ?? null });
}
