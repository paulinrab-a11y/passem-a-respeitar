// Os e-mails de conta (Issue #183): os textos, a moldura e o guia.
//
// Treze e-mails, uma moldura: um para cada linha do painel do Supabase. Este
// arquivo so monta texto: nao le nem escreve
// nada, e por isso pode ser importado pelos testes. Quem grava os .html e o
// gera.mjs, ao lado.
//
// Onde os .html valem:
//
//   - no Supabase LOCAL, pelo supabase/config.toml — e onde a suite de ponta a
//     ponta le os e-mails
//   - em PRODUCAO, colados no painel do Supabase. O guia.html existe para
//     isso. O painel nao le este repositorio: mudou aqui, tem que colar la.
//
// Sobre o desenho. Cliente de e-mail nao e navegador: nada de folha de estilo,
// nada de fonte de fora, nada de flexbox. Tabela, estilo em cada elemento e
// cor repetida em `bgcolor`, que e o que o Outlook le. E nenhuma imagem: com
// imagem bloqueada, que e o padrao de muita caixa de entrada, o e-mail chega
// inteiro.

export const CONTATO = 'atendimento.paulinrabelo@gmail.com';

/** A paleta do site. As mesmas cores do globals.css, escritas por extenso. */
const COR = {
  preto: '#000000',
  caixa: '#0a0a0a',
  linha: '#1c1d20',
  prata: '#cdd0d5',
  prata2: '#7d8188',
  branco: '#ffffff',
  vermelho: '#e0161f',
};

const TITULO = "Impact,'Arial Narrow Bold','Arial Narrow',Arial,sans-serif";
const TEXTO = 'Arial,Helvetica,sans-serif';

/**
 * Os treze e-mails, NA ORDEM DO PAINEL do Supabase (Authentication, Emails,
 * aba Templates). A ordem importa: e a do guia, e o dono cola de cima para
 * baixo com o painel aberto ao lado.
 *
 *   chave    nome do arquivo e da secao no config.toml
 *   tipo     `template` ou `notification`, que e como o config.toml separa
 *   secao    a secao do painel: Authentication ou Security
 *   painel   o nome da linha no painel, em ingles, como esta la
 *   botao    [rotulo, destino]; sem botao, o e-mail so avisa
 *   codigo   mostra `{{ .Token }}` em destaque
 *   ligar    so em Security: se a chave da linha deve ficar ligada
 *
 * As chaves entre chaves duplas sao do Supabase, e ficam como estao.
 */

/** Por que cinco avisos ficam com a chave desligada. */
const SEM_USO = {
  telefone: 'O site não pede telefone. Com a chave desligada este e-mail nunca sai.',
  login: 'O site só tem login por e-mail e senha. Com a chave desligada este e-mail nunca sai.',
  etapas: 'O site não tem verificação em duas etapas. Com a chave desligada este e-mail nunca sai.',
};

const NAO_FUI_EU = ['Não fui eu', '{{ .SiteURL }}/recuperar-senha'];
const CRIE_SENHA =
  'Não foi você? Alguém está dentro da sua conta. Use o botão acima para criar uma senha nova agora.';

export const EMAILS = [
  // --- Authentication ---
  {
    chave: 'confirmation',
    tipo: 'template',
    secao: 'Authentication',
    painel: 'Confirm sign up',
    assunto: 'Confirme seu e-mail — Passem a Respeitar',
    titulo: 'Confirme seu e-mail',
    texto: [
      'Falta um passo para criar sua conta: confirmar que este endereço é seu.',
      'O link vale por uma hora e só funciona uma vez.',
    ],
    botao: ['Confirmar e-mail', '{{ .ConfirmationURL }}'],
    aviso: 'Não foi você? Ignore este e-mail. Sem o clique, nenhuma conta é criada.',
  },
  {
    chave: 'invite',
    tipo: 'template',
    secao: 'Authentication',
    painel: 'Invite user',
    assunto: 'Você foi convidado — Passem a Respeitar',
    titulo: 'Você foi convidado',
    texto: [
      'Você recebeu um convite para criar uma conta no site do EP Passem a Respeitar.',
      'O link vale por tempo limitado e só funciona uma vez.',
    ],
    botao: ['Aceitar o convite', '{{ .ConfirmationURL }}'],
    aviso: 'Não esperava este convite? Ignore este e-mail.',
  },
  {
    chave: 'magic_link',
    tipo: 'template',
    secao: 'Authentication',
    painel: 'Magic link or OTP',
    assunto: 'Seu acesso — Passem a Respeitar',
    titulo: 'Seu acesso',
    texto: [
      'Use o botão abaixo para entrar na sua conta.',
      'O link e o código valem por uma hora e só funcionam uma vez.',
    ],
    botao: ['Entrar', '{{ .ConfirmationURL }}'],
    // O mesmo modelo serve ao login por link e ao login por codigo.
    codigo: true,
    aviso:
      'Não foi você? Ignore este e-mail. Ninguém entra na conta sem o clique ou sem o código, e o site nunca pede o código por telefone nem por mensagem.',
  },
  {
    chave: 'email_change',
    tipo: 'template',
    secao: 'Authentication',
    painel: 'Change email address',
    assunto: 'Confirme a troca de e-mail — Passem a Respeitar',
    titulo: 'Confirme a troca de e-mail',
    texto: [
      'Pediram para trocar o e-mail desta conta.',
      'De: {{ .Email }}<br>Para: {{ .NewEmail }}',
      'Os dois endereços recebem um link, e a troca só acontece depois que os dois confirmarem. Até lá, o login continua no e-mail atual. O link vale por uma hora.',
    ],
    botao: ['Confirmar a troca', '{{ .ConfirmationURL }}'],
    aviso:
      'Não foi você? Não clique. Alguém com a sua senha fez este pedido: entre na conta, cancele a troca e troque a senha.',
  },
  {
    chave: 'recovery',
    tipo: 'template',
    secao: 'Authentication',
    painel: 'Reset password',
    assunto: 'Criar uma senha nova — Passem a Respeitar',
    titulo: 'Criar uma senha nova',
    texto: [
      'Recebemos um pedido para criar uma senha nova nesta conta.',
      'O link vale por uma hora e só funciona uma vez. Se você pediu mais de um, use o mais recente.',
    ],
    botao: ['Criar senha nova', '{{ .ConfirmationURL }}'],
    aviso: 'Não foi você? Ignore este e-mail. Sua senha continua a mesma.',
  },
  {
    chave: 'reauthentication',
    tipo: 'template',
    secao: 'Authentication',
    painel: 'Reauthentication',
    assunto: 'Seu código de confirmação — Passem a Respeitar',
    titulo: 'Seu código de confirmação',
    texto: ['Digite este código no site para confirmar que é você.'],
    codigo: true,
    aviso:
      'Não foi você? Alguém está dentro da sua conta. Entre e troque a senha. Nunca passe este código a ninguém: o site não pede por telefone nem por mensagem.',
  },

  // --- Security ---
  {
    chave: 'password_changed',
    tipo: 'notification',
    secao: 'Security',
    painel: 'Password changed',
    ligar: true,
    assunto: 'Sua senha foi trocada — Passem a Respeitar',
    titulo: 'Sua senha foi trocada',
    texto: [
      'A senha da conta {{ .Email }} acabou de ser trocada.',
      'Se foi você, não precisa fazer nada.',
    ],
    botao: NAO_FUI_EU,
    aviso:
      'Não foi você? Use o botão acima para criar uma senha nova agora. Isso tira da conta quem trocou a senha.',
  },
  {
    chave: 'email_changed',
    tipo: 'notification',
    secao: 'Security',
    painel: 'Email address changed',
    ligar: true,
    assunto: 'O e-mail da sua conta foi trocado — Passem a Respeitar',
    titulo: 'O e-mail da conta foi trocado',
    texto: [
      'O e-mail da sua conta mudou.',
      'Era: {{ .OldEmail }}<br>Agora é: {{ .Email }}',
      'Se foi você, não precisa fazer nada. Daqui em diante o login é pelo endereço novo.',
    ],
    aviso: `Não foi você? Escreva para ${CONTATO} a partir deste endereço, que era o da conta.`,
  },
  {
    chave: 'phone_changed',
    tipo: 'notification',
    secao: 'Security',
    painel: 'Phone number changed',
    ligar: false,
    semUso: SEM_USO.telefone,
    assunto: 'O telefone da sua conta foi trocado — Passem a Respeitar',
    titulo: 'O telefone da conta foi trocado',
    texto: [
      'O telefone da sua conta mudou.',
      'Era: {{ .OldPhone }}<br>Agora é: {{ .Phone }}',
      'Se foi você, não precisa fazer nada.',
    ],
    botao: NAO_FUI_EU,
    aviso: CRIE_SENHA,
  },
  {
    chave: 'identity_linked',
    tipo: 'notification',
    secao: 'Security',
    painel: 'Sign-in method linked',
    ligar: false,
    semUso: SEM_USO.login,
    assunto: 'Uma forma de entrar foi adicionada — Passem a Respeitar',
    titulo: 'Nova forma de entrar na conta',
    texto: [
      'Sua conta ganhou uma nova forma de entrar: {{ .Provider }}.',
      'Se foi você, não precisa fazer nada.',
    ],
    botao: NAO_FUI_EU,
    aviso: CRIE_SENHA,
  },
  {
    chave: 'identity_unlinked',
    tipo: 'notification',
    secao: 'Security',
    painel: 'Sign-in method removed',
    ligar: false,
    semUso: SEM_USO.login,
    assunto: 'Uma forma de entrar foi removida — Passem a Respeitar',
    titulo: 'Uma forma de entrar foi removida',
    texto: [
      'Uma forma de entrar foi removida da sua conta: {{ .Provider }}.',
      'Se foi você, não precisa fazer nada.',
    ],
    botao: NAO_FUI_EU,
    aviso: CRIE_SENHA,
  },
  {
    chave: 'mfa_factor_enrolled',
    tipo: 'notification',
    secao: 'Security',
    painel: 'MFA method added',
    ligar: false,
    semUso: SEM_USO.etapas,
    assunto: 'A verificação em duas etapas foi ligada — Passem a Respeitar',
    titulo: 'Verificação em duas etapas ligada',
    texto: [
      'Sua conta ganhou um método de verificação em duas etapas: {{ .FactorType }}.',
      'Daqui em diante, entrar na conta pede a senha e esse segundo passo. Se foi você, não precisa fazer nada.',
    ],
    botao: NAO_FUI_EU,
    aviso: CRIE_SENHA,
  },
  {
    chave: 'mfa_factor_unenrolled',
    tipo: 'notification',
    secao: 'Security',
    painel: 'MFA method removed',
    ligar: false,
    semUso: SEM_USO.etapas,
    assunto: 'Um método de verificação foi removido — Passem a Respeitar',
    titulo: 'Método de verificação removido',
    texto: [
      'Um método de verificação em duas etapas foi removido da sua conta: {{ .FactorType }}.',
      'A conta ficou com uma proteção a menos. Se foi você, não precisa fazer nada.',
    ],
    botao: NAO_FUI_EU,
    aviso: CRIE_SENHA,
  },
];

const linha = (estilo, conteudo) => `        <tr>
          <td style="${estilo}">${conteudo}</td>
        </tr>`;

/** O HTML de um e-mail. */
export function html(e) {
  const partes = [];

  partes.push(
    linha(
      `padding:28px 28px 10px;font-family:${TITULO};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${COR.prata2};`,
      'Passem a Respeitar'
    ),
    linha(
      `padding:0 28px;font-family:${TITULO};font-size:30px;line-height:1.05;text-transform:uppercase;color:${COR.branco};`,
      e.titulo
    )
  );

  e.texto.forEach((p, i) => {
    partes.push(
      linha(
        `padding:${i === 0 ? 18 : 12}px 28px 0;font-family:${TEXTO};font-size:15px;line-height:1.55;color:${COR.prata};`,
        p
      )
    );
  });

  const comOsDois = e.codigo && e.botao;

  if (e.codigo && !comOsDois) {
    partes.push(
      linha(
        `padding:22px 28px 0;font-family:'Courier New',Courier,monospace;font-size:32px;letter-spacing:8px;color:${COR.branco};`,
        '{{ .Token }}'
      )
    );
  }

  if (e.botao) {
    const [rotulo, destino] = e.botao;
    partes.push(
      // O botao e uma tabela dentro da tabela: e o unico jeito de a area
      // clicavel ter fundo em todo cliente de e-mail. Preto sobre prata, como
      // o botao cheio do site — 13,6 para 1.
      linha(
        'padding:26px 28px 0;',
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="${COR.prata}" style="background:${COR.prata};">
                <a href="${destino}" style="display:inline-block;padding:14px 24px;font-family:${TEXTO};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;text-decoration:none;color:${COR.preto};">${rotulo}</a>
              </td>
            </tr>
          </table>`
      ),
      // Para quem le em cliente que desmonta botao, ou quer ver para onde vai
      // antes de clicar.
      linha(
        `padding:18px 28px 0;font-family:${TEXTO};font-size:12px;line-height:1.5;color:${COR.prata2};word-break:break-all;`,
        `Se o botão não abrir, copie e cole este endereço no navegador:<br><a href="${destino}" style="color:${COR.prata};">${destino}</a>`
      )
    );
  }

  if (comOsDois) {
    // Link e codigo no mesmo e-mail: o botao primeiro, que e o caminho de
    // quase todo mundo, e o codigo depois, para quem abriu o e-mail em outro
    // aparelho.
    partes.push(
      linha(
        `padding:22px 28px 0;font-family:${TEXTO};font-size:15px;line-height:1.55;color:${COR.prata};`,
        'Ou digite este código no site:'
      ),
      linha(
        `padding:10px 28px 0;font-family:'Courier New',Courier,monospace;font-size:32px;letter-spacing:8px;color:${COR.branco};`,
        '{{ .Token }}'
      )
    );
  }

  partes.push(
    linha(
      `padding:22px 28px 0;font-family:${TEXTO};font-size:13px;line-height:1.55;color:${COR.prata};`,
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="2" bgcolor="${COR.vermelho}" style="background:${COR.vermelho};font-size:0;line-height:0;">&nbsp;</td>
              <td style="padding-left:12px;font-family:${TEXTO};font-size:13px;line-height:1.55;color:${COR.prata};">${e.aviso}</td>
            </tr>
          </table>`
    ),
    linha(
      `padding:26px 28px 28px;font-family:${TEXTO};font-size:12px;line-height:1.6;color:${COR.prata2};`,
      `Passem a Respeitar · Santxx x Ch3fe · Whynot Visuals<br>Dúvidas: <a href="mailto:${CONTATO}" style="color:${COR.prata};">${CONTATO}</a>`
    )
  );

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${e.assunto}</title>
  </head>
  <body bgcolor="${COR.preto}" style="margin:0;padding:0;background:${COR.preto};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COR.preto}" style="background:${COR.preto};">
      <tr>
        <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="${COR.caixa}" style="width:100%;max-width:560px;background:${COR.caixa};border:1px solid ${COR.linha};border-top:3px solid ${COR.vermelho};">
${partes.join('\n')}
      </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const arquivo = (e) => `${e.chave}.html`;

const escapa = (t) =>
  t
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** A pagina que o dono abre para colar os modelos no painel do Supabase. */
/** O que fazer com a chave da linha, nos avisos de Security. */
function onde(e) {
  if (e.tipo !== 'notification') return '';
  return e.ligar
    ? ' · <b class="liga">ligue a chave desta linha</b>'
    : ` · deixe a chave desligada. ${e.semUso}`;
}

export function guia(painel) {
  const ligadas = EMAILS.filter((e) => e.ligar).map((e) => e.painel);

  const cartoes = EMAILS.map(
    (e, i) => `    <section>
      <h2><span>${i + 1} de ${EMAILS.length}</span>${e.painel}</h2>
      <p class="onde">Seção <b>${e.secao}</b>${onde(e)}</p>

      <label for="a${i}">Assunto <small>(Subject)</small></label>
      <div class="campo">
        <input readonly value="${escapa(e.assunto)}" id="a${i}">
        <button type="button" data-de="a${i}">Copiar</button>
      </div>

      <label for="c${i}">Corpo <small>(Body, na visão de código-fonte)</small></label>
      <div class="campo">
        <textarea readonly rows="7" id="c${i}">${escapa(html(e))}</textarea>
        <button type="button" data-de="c${i}">Copiar</button>
      </div>
    </section>`
  ).join('\n\n');

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Guia: e-mails no painel do Supabase</title>
    <style>
      body{margin:0;background:#000;color:#cdd0d5;font:15px/1.55 Arial,Helvetica,sans-serif}
      main{max-width:760px;margin:0 auto;padding:40px 20px 80px}
      h1{font:400 34px/1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;color:#fff;margin:0 0 14px}
      h2{font:400 22px/1.1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;color:#fff;margin:0 0 6px}
      h2 span{display:block;font:12px/1 Arial,sans-serif;letter-spacing:2px;color:#7d8188;margin-bottom:8px}
      a{color:#fff}
      ol{padding-left:20px}
      li{margin:6px 0}
      section{margin-top:28px;padding:22px;border:1px solid #1c1d20;border-left:2px solid #e0161f;background:#0a0a0a}
      .onde{margin:0 0 16px;color:#7d8188;font-size:13px}
      .onde b{color:#cdd0d5}
      .onde .liga{color:#fff}
      label{display:block;margin:14px 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#7d8188}
      small{letter-spacing:0;text-transform:none}
      .campo{display:flex;gap:10px;align-items:flex-start}
      input,textarea{flex:1;min-width:0;background:#000;color:#cdd0d5;border:1px solid #3a3d42;padding:10px;font:12px/1.4 'Courier New',monospace}
      textarea{resize:vertical}
      button{background:#cdd0d5;color:#000;border:0;padding:11px 16px;font:bold 12px/1 Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;cursor:pointer}
      button.feito{background:#7d8188}
      button:focus-visible,input:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid #e0161f;outline-offset:3px}
      .nota{margin-top:28px;padding-left:12px;border-left:2px solid #e0161f;font-size:13px}
    </style>
  </head>
  <body>
    <main>
      <h1>E-mails no painel do Supabase</h1>
      <p>São ${EMAILS.length} modelos, um para cada linha do painel, na mesma ordem da tela: ${EMAILS.filter((e) => e.secao === 'Authentication').length} em Authentication e ${EMAILS.filter((e) => e.secao === 'Security').length} em Security.</p>
      <ol>
        <li>Abra <a href="${painel}" target="_blank" rel="noopener">o painel do Supabase, em Authentication, Emails</a>. Fique na aba <b>Templates</b>.</li>
        <li>Clique na linha com o nome do bloco abaixo. Os nomes estão em inglês, como na tela.</li>
        <li>Copie o assunto daqui e cole no campo do assunto. Copie o corpo daqui e cole no lugar do corpo que está lá, apagando o antigo.</li>
        <li>Se o corpo colado aparecer como código na prévia, procure a opção de editar o código-fonte do modelo e cole ali.</li>
        <li>Salve, volte para a lista e passe para a próxima linha.</li>
        <li>No fim, em <b>Security</b>, ligue só as chaves de ${ligadas.join(' e ')}, e clique em <b>Save changes</b>.</li>
      </ol>

${cartoes}

      <p class="nota">Esta página é gerada por <code>supabase/templates/modelos.mjs</code>. O painel não lê o repositório: se um texto mudar lá, os modelos precisam ser colados de novo.</p>
    </main>
    <script>
      for (const botao of document.querySelectorAll('button[data-de]')) {
        botao.addEventListener('click', async () => {
          const campo = document.getElementById(botao.dataset.de);
          try {
            await navigator.clipboard.writeText(campo.value);
          } catch {
            campo.select();
            document.execCommand('copy');
          }
          botao.textContent = 'Copiado';
          botao.classList.add('feito');
          setTimeout(() => {
            botao.textContent = 'Copiar';
            botao.classList.remove('feito');
          }, 1600);
        });
      }
    </script>
  </body>
</html>
`;
}

const PAINEL = 'https://supabase.com/dashboard/project/kmkhokjkpbysmyohaqag/auth/templates';

/** Tudo que este arquivo escreve: nome do arquivo e conteudo. */
export function saidas() {
  return [...EMAILS.map((e) => [arquivo(e), html(e)]), ['guia.html', guia(PAINEL)]];
}
