/**
 * Cancelar uma troca de e-mail pendente (Issue #36).
 *
 * A troca so vale depois de confirmada nos DOIS enderecos ("secure email
 * change" do Supabase). Enquanto isso ela fica pendente em auth.users, com os
 * tokens em auth.one_time_tokens. O Supabase nao oferece cancelamento para o
 * usuario: o pedido so some quando vence ou quando outro pedido o substitui.
 *
 * Esta funcao e o caminho para voltar atras: apaga o pedido e os tokens dele,
 * e os links que ja sairam por e-mail deixam de valer.
 *
 * So mexe na linha de quem chama (`auth.uid()`), e nao recebe parametro: nao
 * ha identificador para adulterar.
 */
create or replace function public.cancela_troca_de_email()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  quem uuid := (select auth.uid());
begin
  if quem is null then
    return false;
  end if;

  update auth.users
     set email_change = '',
         email_change_token_new = '',
         email_change_token_current = '',
         email_change_confirm_status = 0,
         email_change_sent_at = null
   where id = quem
     and coalesce(email_change, '') <> '';

  if not found then
    return false;
  end if;

  delete from auth.one_time_tokens
   where user_id = quem
     and token_type in ('email_change_token_new', 'email_change_token_current');

  return true;
end;
$$;

revoke all on function public.cancela_troca_de_email() from public, anon;
grant execute on function public.cancela_troca_de_email() to authenticated;
