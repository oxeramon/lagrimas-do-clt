-- Cada pessoa pode acessar apenas sua propria foto. O bucket nao e publico.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "perfil_foto_ler" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');

create policy "perfil_foto_enviar" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');

create policy "perfil_foto_atualizar" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar')
  with check (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');

create policy "perfil_foto_remover" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and name = (select auth.uid())::text || '/avatar');

