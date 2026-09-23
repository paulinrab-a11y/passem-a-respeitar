// Leitura das variaveis do Supabase, em um lugar so.
//
// Falha fechada: variavel faltando derruba o modulo no import, com o nome dela
// no erro. A alternativa comum (`process.env.X!`) entrega `undefined` ao
// cliente e o erro aparece tres camadas adiante, como "Invalid API key".

function obrigatoria(nome: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(
      `Variavel de ambiente ${nome} nao definida. Veja .env.example e rode ` +
        '`npx vercel env pull .env.local --environment=development`.'
    );
  }
  return valor;
}

// Escritas por extenso de proposito. O Next substitui `process.env.NEXT_PUBLIC_X`
// por texto no bundle durante o build, e so reconhece a forma literal —
// `process.env[nome]` com nome em variavel nao e substituido e chega undefined.
export const SUPABASE_URL = obrigatoria(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL
);

// Publica de proposito: vai para o bundle e qualquer visitante le. Sozinha ela
// nao abre nada — quem decide o que cada usuario alcanca e a RLS (#18).
export const SUPABASE_PUBLISHABLE_KEY = obrigatoria(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);
