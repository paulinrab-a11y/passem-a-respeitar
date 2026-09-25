-- Issue #30 — data e hora do aceite da politica de privacidade.
--
-- O aceite e registrado no cadastro e nunca mais muda pelo usuario: nao ha
-- GRANT de update na coluna. Chega pelo mesmo caminho do nome — metadata do
-- signup, lida pela trigger que cria o profile —, entao nasce junto com a
-- conta, na mesma transacao do auth.users. Nao existe janela em que a conta
-- exista sem o aceite gravado.
--
-- A trigger e substituida (create or replace), e o comportamento para quem
-- nao manda o campo continua o mesmo: null.

alter table public.profiles
  add column if not exists termos_aceitos_em timestamptz;

comment on column public.profiles.termos_aceitos_em is
  'Quando a pessoa aceitou a politica de privacidade, no cadastro. Nao editavel.';

create or replace function public.cria_profile_no_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aceite timestamptz;
begin
  -- O valor vem do servidor do site (a acao de cadastro carimba a hora), nao
  -- do formulario. Texto invalido vira null em vez de derrubar o cadastro.
  begin
    v_aceite := nullif(trim(new.raw_user_meta_data ->> 'termos_aceitos_em'), '')::timestamptz;
  exception when others then
    v_aceite := null;
  end;

  insert into public.profiles (id, nome, termos_aceitos_em)
  values (
    new.id,
    left(nullif(trim(new.raw_user_meta_data ->> 'nome'), ''), 80),
    v_aceite
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
