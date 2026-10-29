-- Sports Leaderboard update: event branding (logos, page background, theme color).
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.

alter table public.competitions
  add column if not exists logo_url text,
  add column if not exists background_url text,
  add column if not exists accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');

alter table public.teams
  add column if not exists logo_url text;

-- Public image storage for logos and backgrounds. Anyone can view the images;
-- only admins can upload, replace or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins upload branding" on storage.objects;
drop policy if exists "admins update branding" on storage.objects;
drop policy if exists "admins delete branding" on storage.objects;

create policy "admins upload branding" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.my_role() = 'admin');
create policy "admins update branding" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.my_role() = 'admin')
  with check (bucket_id = 'branding' and public.my_role() = 'admin');
create policy "admins delete branding" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.my_role() = 'admin');
