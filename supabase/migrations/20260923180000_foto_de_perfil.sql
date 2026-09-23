-- Issues #35 e #26 — foto de perfil.

-- Guarda o CAMINHO no bucket, nao a URL. URL assinada expira; se ficasse
-- gravada aqui, o banco encheria de link morto e alguem acabaria assinando
-- com validade longa "para resolver".
alter table public.profiles add column foto_caminho text
  check (foto_caminho is null or foto_caminho ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');

comment on column public.profiles.foto_caminho is
  'Caminho no bucket avatares: <user_id>/<uuid>.webp. A URL assinada e gerada por request.';

-- O cliente escreve nome e telefone; o caminho da foto e escrito pela rota de
-- upload, que e quem sabe se o arquivo chegou inteiro no storage.
-- (O grant de UPDATE por coluna da migration 20260923120000 ja exclui esta
-- coluna: ela nasce fora da lista, sem precisar de nada a mais.)

-- ---------------------------------------------------------------------------
-- Bucket privado
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', false, 2 * 1024 * 1024, array['image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Privado de proposito. Bucket publico serve por URL adivinhavel: quem
-- descobre o padrao lista a foto de qualquer usuario a partir do id dele.
-- Aqui a leitura sai por URL assinada, gerada no servidor e com validade
-- curta.
--
-- allowed_mime_types so aceita webp porque a rota reescreve tudo em webp com
-- o sharp. Isso e a ultima barreira: mesmo que a validacao da rota falhasse, o
-- storage recusaria qualquer coisa que nao fosse webp.

-- ---------------------------------------------------------------------------
-- Politicas: cada um so alcanca a propria pasta
-- ---------------------------------------------------------------------------

-- O caminho e <user_id>/<uuid>.webp, entao o primeiro segmento e o dono.
-- `storage.foldername(name)` devolve os segmentos; o [1] e a pasta raiz.

create policy avatares_le_o_proprio on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatares_envia_o_proprio on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatares_troca_o_proprio on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatares_apaga_o_proprio on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
